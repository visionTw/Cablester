# Godot approved tuning semantic landing map

Status: implementation handoff. The conservative runtime audit currently finds 35/97 approved values on executable Godot runtime lines; this document maps the remaining 62 values to behavior, state, and evidence. A quoted key is not completion: every row below requires its described state transition and an observable test.

## Landing rules

- Read values through the approved `values` object and keep the canonical fallback beside the read. Do not copy the number into an unrelated no-op expression.
- Run gameplay integration in `_physics_process`; render-only springs may use a delta clamped by `maxFrameDelta`, but gameplay physics must remain fixed at 120 Hz.
- Add compact telemetry only where it proves behavior: attachment IDs/lengths, mechanism event ticks, camera/gravity state, resource timers, and soft-body/tail draw state. Do not make telemetry drive gameplay.
- Match Web coordinate semantics: canonical space is +Y down and rotation is clockwise-positive. A rotation trigger animates camera angle while world gravity remains screen-down via the inverse camera rotation.
- Recommended ownership split: `player.gd` for physics/resource state, `world_runtime.gd` for camera/rotation/respawn orchestration, and a small player visual-state helper for soft-body/tail/rope drawing. This avoids turning `_draw()` into the physics source of truth.

## Runtime timing, camera, rotation, and recovery (13)

| Approved value | Web semantic | Godot landing and behavioral evidence |
| --- | --- | --- |
| `fixedStep = 0.008333` | Simulation consumes exact `1 / 120`; the stored decimal is the canonical rounded representation. | Keep `Engine.physics_ticks_per_second == 120`, use physics `delta`, and reject a replay whose `fixedDelta` differs from `1.0 / 120.0`. Test 601 physics steps for ticks 0–600 without accumulated rounded-step drift. |
| `maxFrameDelta = 0.1` | A long render frame contributes at most 0.1 s to the Web accumulator. | Clamp only `_process`-side camera/visual animation delta to this value; never enlarge or skip fixed physics ticks. Test a synthetic 0.5 s render delta advances visual timers by at most 0.1 s while physics remains 120 Hz. |
| `cameraFollow = 7.5` | Camera position follows with exponential blend `1 - exp(-follow * dt)`. | Replace the hard-coded Camera2D smoothing speed with an explicit top-level/sibling camera state using the same exponential formula. Test one-step and one-second convergence against the Web formula. |
| `cameraLookAhead = 0.18` | Desired camera is `player + velocity * 0.18`; vertical look-ahead is multiplied by 0.45, and look-ahead is zero during rotation. | Compute desired camera global position each visual tick; do not inherit player position directly from a child Camera2D. Telemetry should expose desired/current camera positions. Test horizontal/vertical look-ahead and zero look-ahead during a rotation tween. |
| `rotationDuration = 1.25` | Rotation trigger eases camera from current to target angle with cubic ease-in-out over 1.25 s. Gravity is `inverseRotate(DOWN, cameraAngle)` throughout. | Emit a rotation request from the contact handler; let `WorldRuntime` own `from/to/elapsed`. Tween Camera2D rotation and derive player gravity from inverse camera angle every physics tick. Test midpoint is eased rather than snapped, completion is exact, and screen-space gravity remains down. |
| `goalActivationPadding = 26` | Goal activates within `player.radius + goal.radius + 26`; the visible activation ring uses the same padding. | Expand goal contact distance independently of its raw canonical bounds. Test just-inside and just-outside distances, including a rotated/scaled chunk. |
| `respawnDelay = 0.45` | Death starts a 0.45 s hidden/noninteractive phase, then restores checkpoint state. | Split `begin_death()` from `finish_respawn()`. Disable input/contact while pending, retain the checkpoint, and emit one death event. Test no early teleport at 53 ticks and exact restoration by 54 ticks at 120 Hz. |
| `damageRecoveryWindow = 0.9` | On damage, recovery-jump permission lasts 0.9 s; Space during the window performs a 0.92× jump once. | Add `damage_recovery_timer` and a one-shot boolean. Decrement in physics, consume on recovery jump, clear on expiry/respawn. Test jump inside/outside the window and single consumption. |
| `damageLiftSpeed = 370` | Damage cancels positive falling speed, then adds 370 units/s opposite gravity. | In `_take_damage(source)`, project velocity onto gravity, remove only positive down speed, and subtract `gravity_direction * 370`. Test while falling, rising, and under rotated gravity. |
| `damageAwaySpeed = 150` | Source-to-player away vector is projected onto the screen tangent; that signed component adds 150 units/s along tangent. | Pass the actual hazard/contact source into damage handling, compute `awayAlongSurface = away.dot(tangent)`, and add `tangent * awayAlongSurface * 150`. Test left/right hazards and rotated gravity. |
| `bashTargetCooldown = 0.55` | A successfully bashed target cannot be selected again for 0.55 s. | Maintain per-target cooldown seconds, decrement at fixed step, exclude positive cooldowns in bash selection, and set 0.55 on release. Test immediate re-bash fails and tick 66 at 120 Hz becomes selectable. |
| `groundFriction = 2900` | Grounded, unconstrained, non-dashing player with zero horizontal input moves tangent speed toward zero at 2900 units/s². | Separate no-input ground friction from `runAcceleration`; do not apply it in air or while attached. Test stopping distance and that air velocity is preserved. |
| `hardBarThickness = 10` | Default segment collision radius uses half this thickness, and the hard-bar line is drawn 10 px wide. | Use it for generated/default hard-bar or slope segment thickness and player draw width; authored explicit thickness still wins. Test render state reports 10 and a fallback segment contacts at `playerRadius + 5`. |

## Glide and updraft state machine (5)

| Approved value | Web semantic | Godot landing and behavioral evidence |
| --- | --- | --- |
| `glideMaximumFallSpeed = 190` | While gliding, the velocity projection along gravity is capped at +190 without changing tangent velocity. | After gravity/liquid/wind forces, remove only down-speed above 190. Test tangent preservation and terminal glide fall speed. |
| `glideUpdraftEntrySpeed = 300` | On first gliding tick in a lifting wind, falling/down speed is immediately corrected to at least -300. | Track prior glide/wind IDs; on entry into an updraft set gravity-axis speed to `min(current, -300)`. Test entry from a fall and no repeated impulse while remaining inside. |
| `glideUpdraftMaximumSpeed = 520` | Active gliding updraft cannot accelerate upward beyond -520 along gravity. | Clamp only the gravity-axis component after wind accumulation. Test multiple overlapping winds still cap at 520 while tangent force remains. |
| `glideUpdraftExitDampingDuration = 1.05` | Leaving an active updraft while still gliding starts a 1.05 s lift-recovery timer. Re-entry or stopping glide clears it. | Add `updraft_exit_timer`; start only on active→inactive edge, clear on re-entry/not gliding. Expose timer in diagnostic telemetry. Test edge behavior rather than continuous reset. |
| `glideUpdraftExitDeceleration = 220` | During that timer, negative gravity-axis speed moves toward zero at 220 units/s². | Apply `move_toward(up_speed, 0, 220 * dt)` without touching tangent velocity. Test one-second delta is 220 and damping stops when the timer expires. |

## Safe energy floor (3)

| Approved value | Web semantic | Godot landing and behavioral evidence |
| --- | --- | --- |
| `safeEnergyDelay = 0.65` | Recovery begins only while grounded, not rope-attached, and 0.65 s after the last rope/hard-bar/bash spend. | Add `time_since_energy_use`; reset on every successful energy spend, increment in physics, and gate regen. Test no regen at tick 77 and regen beginning at/after tick 78. |
| `safeEnergyFloor = 2` | Automatic recovery applies only below 2 and never raises energy above 2. | Clamp automatic recovery to this floor, not maximum energy. Pickups/checkpoints remain allowed to restore above it. Test values 0, 1.99, 2, and 5. |
| `safeEnergyRegen = 1.35` | Eligible grounded player regenerates 1.35 energy per second until the floor. | Add `1.35 * delta` under the exact eligibility predicate. Test deterministic fixed-step accumulation and final clamp. |

## Rope lifecycle, winch, swing, and draw state (22)

| Approved value | Web semantic | Godot landing and behavioral evidence |
| --- | --- | --- |
| `ropeLaunchSpeed = 2200` | Rope begins in `firing`; its visual tip moves from player to selected target at 2200 units/s and attaches only after arrival plus a line-of-sight recheck. | Add rope phase/tip state separate from the selected target. Test travel duration, no constraint before arrival, and obstruction during flight causes retract. |
| `ropeRetractSpeed = 2800` | Released/failed rope enters `retracting`; tip travels back to the moving player at 2800 units/s before state is removed. | Preserve tip during retract instead of instant `detach()`. Test moving-player target and removal only on arrival. |
| `ropeAnimationSagRatio = 0.14` | Firing/retracting rope adds temporary sag capped by `ropeVisualMaximumSag`: `displayLength * 0.14`. | Feed phase sag into rope draw-state target, separate from physical slack sag. Test attached phase adds zero animation sag and flight phase adds the capped amount. |
| `ropePullStrength = 13` | Attached soft rope becomes taut near 96% length; stretch beyond that adds inward acceleration `stretch * 13` before hard length projection. | Apply an inward force while taut, then enforce maximum length. Test slack rope adds no pull and two different stretches scale linearly. |
| `ropeReelAcceleration = 1050` | Holding up accelerates reel speed toward `ropeReelMaximumSpeed` at 1050 units/s². | Store `reel_speed` per active rope and increment by `1050 * dt`, clamped to the already-consumed maximum. Test ramp rather than instant maximum. |
| `ropeReelDeceleration = 1000` | Releasing up moves reel speed toward zero at 1000 units/s² without detaching. | Decelerate stored reel speed when not winching. Test continuity across release/re-hold. |
| `ropeWinchAcceleration = 360` | Winching adds inward acceleration base `360 * dt`. | Apply along negative radial direction only while attached rope + up held. Test no effect for hard bar or released up. |
| `ropeWinchSpeedFactor = 1.15` | Additional inward acceleration is `reelSpeed * 1.15`. | Add to the base winch acceleration using current ramped reel speed. Test two reel speeds produce the expected delta. |
| `ropeWinchCompletionBoost = 240` | Crossing the minimum rope length grants one extra inward velocity impulse of 240. | Track `reel_boost_applied`; fire only on the crossing frame, never every frame at minimum. Reset on a new rope. Test exactly one boost. |
| `maximumSwingSpeed = 930` | Attached rope caps total player speed at 930; it also normalizes soft-body swing/tail tension. | Clamp attached velocity magnitude after forces/constraints. Reuse the same value in visual-state normalization. Test diagonal speed cap, not separate axis caps. |
| `swingInputSmoothing = 11` | Control strength approaches requested projected input by `1 - exp(-11 * dt)`. | Store `swing_control` on rope/hard bar. Project screen-horizontal input onto the circle tangent before smoothing. Test sign reversal and convergence. |
| `swingPumpFullSpeed = 240` | Pump/brake strength scales with `abs(tangentialSpeed) / 240`, clamped 0–1. | Compute a speed factor; do not give full continuous acceleration from rest. A discrete start kick handles rest. Test 0, 120, and 240 speeds. |
| `swingStartKickSpeed = 82` | A fresh direction press below 82 tangential speed sets signed tangential speed to 82 once. | Detect just-pressed left/right while attached, projected onto tangent. Test held input does not reapply the kick. |
| `swingTargetSpeed = 720` | Same-direction pumping moves tangential speed toward signed 720. | Use `move_toward` with scaled swing acceleration; retain radial velocity handling separately. Test it never overshoots. |
| `swingBraking = 1480` | Opposite-direction input moves tangential speed toward zero at scaled 1480, rather than instantly reversing. | Branch on sign of existing tangential velocity versus requested direction. Test braking to zero precedes acceleration in the new direction. |
| `ropeSwingDamping = 0.14` | When a soft rope is near taut (distance ≥ 90% length), tangential speed decays exponentially by `exp(-0.14 * dt)`. Slack rope is not damped. | Apply after input pumping and before constraint. Test taut/slack predicates and one-second retained ratio. |
| `hardBarSwingDamping = 0.48` | Hard-bar tangential speed always decays exponentially by `exp(-0.48 * dt)`. | Apply to bar constraint every fixed step. Test it damps faster than rope while preserving radial component until bar projection. |
| `ropeVisualMinimumSag = 2` | Rope visual sag never goes below 2. | Store `visual_sag` in draw state and use the canonical curved rope renderer rather than a straight `draw_line`. Test taut bottom state still has minimum sag. |
| `ropeVisualMaximumSag = 72` | Physical plus animation sag is capped at 72. | Clamp both slack sag and phase animation sag. Test very long slack rope. |
| `ropeVisualSagRatio = 0.18` | Maximum slack sag candidate is `ropeLength * 0.18` before min/max clamp. | Use authored attachment length, not current straight-line distance, to derive the limit. Test 82, 300, and 470 lengths. |
| `ropeVisualSmoothing = 7.5` | Sag, tension, and bend direction approach targets by exponential blend `1 - exp(-7.5 * dt)`. | Persist visual values across frames; normalize bend after interpolation. Test no one-frame snap and stable normalized bend. |
| `hardBarThickness = 10` | Also defines the rigid connector’s rendered thickness. | This second landing is intentional: one approved value governs collision fallback and draw width. One test should assert both consumers so the implementations cannot drift. |

`hardBarThickness` appears in two semantic groups but remains one of the 62 missing keys; the unique-key total is unchanged.

## Soft-body draw state (13)

The Godot collision capsule must remain stable. These values drive a render-only ellipse whose long radius is `radius * (1 + stretch)` and cross radius is `radius / (1 + stretch)`, preserving projected area. State updates at fixed step; `_draw()` only consumes the resulting pose.

| Approved value | Web semantic | Godot landing and behavioral evidence |
| --- | --- | --- |
| `softBodySpringFrequency = 18` | Stretch uses a damped spring with acceleration `(target-value)*18² - velocity*2*damping*18`. | Store `stretch` and `stretch_velocity`; integrate at fixed step. Unit-test one and many steps against the Web equation. |
| `softBodySpringDamping = 0.72` | Damping ratio for that stretch spring. | Use in the same spring equation, not a generic lerp. Test bounded overshoot/settling. |
| `softBodyAxisFollow = 15` | Body long-axis approaches target via shortest ellipse-axis delta with exponential rate 15; dash adds 16 to the rate. | Store `axis_angle` modulo π and use shortest-axis interpolation. Test crossing ±π/2 takes the short path. |
| `softBodyDashStretch = 0.42` | Dashing targets +0.42 stretch aligned to velocity. | Trigger dash visual state from successful dash, not button press. Test long/cross radii and area ratio 1. |
| `softBodySwingStretch = 0.34` | Attached speed >45 targets `0.055 + clamp(speed/930)*0.34`, aligned to velocity. | Feed actual attachment mode and velocity to visual state. Test low/high swing values. |
| `softBodyAirStretch = 0.24` | Airborne non-gliding stretch is gravity-speed/jump-speed scaled to a maximum 0.24, aligned to gravity. | Use gravity-axis speed magnitude; exclude gliding. Test rising/falling symmetry and cap. |
| `softBodyJumpDuration = 0.17` | Successful jump starts a 0.17 s visual timer and clears landing timer. | Trigger from `_jump()`, not raw input. Decrement fixed step. Test coyote/double/wall jump all trigger it. |
| `softBodyJumpSquashDuration = 0.035` | First 0.035 s of the jump timer is squash; remainder is stretch. | Compare remaining timer to `duration - squashDuration`. Test phase boundary ticks. |
| `softBodyJumpSquash = 0.12` | Jump’s initial target stretch is -0.12. | Render cross-axis widening through area preservation. Test negative stretch is not applied to collision. |
| `softBodyJumpStretch = 0.3` | After initial squash, jump target stretch is +0.3 along gravity. | Test target transition occurs without resetting the spring. |
| `softBodyLandingThreshold = 120` | Landing animation triggers only if pre-contact down speed is at least 120. Impact amount scales from `(speed-120)/720`. | Capture velocity before `move_and_slide`, detect airborne→floor edge, and trigger once. Test 119/120 and high impact. |
| `softBodyLandingDuration = 0.075` | Qualifying landing holds a squash target for 0.075 s. | Store landing timer and squash amount, clear jump timer. Test one-shot edge and timer expiry. |
| `maximumSwingSpeed = 930` | Soft-body swing normalization shares the physics cap. | This is the same unique key already counted above; assert render normalization and physics clamp use one read path. |

`maximumSwingSpeed` is likewise shown twice for its two required consumers; it is one unique missing key.

## Tail spring and inertia draw state (9)

Tail state is render-only but physics-derived: `tail_facing`, `tail_offset`, their velocities, and prior player velocity. Draw a tapered curve from the body opposite the current tail offset. Never mutate player velocity from tail state.

| Approved value | Web semantic | Godot landing and behavioral evidence |
| --- | --- | --- |
| `tailRestLength = 42` | Desired tail length starts at 42 and adds up to 10 based on swing speed. Initial offset is 42 behind facing. | Initialize/reset tail offset behind tangent/facing. Test respawn and facing ±1. |
| `tailMaximumLength = 58` | Tail offset magnitude is capped at 58; outward radial tail velocity is removed at the cap. | Clamp offset vector, project away positive radial velocity only. Test cap under a dash impulse. |
| `tailPhysicsFrequency = 10.5` | Tail offset spring frequency toward desired motion/gravity target. | Use `frequency²` stiffness at fixed step. Test deterministic lag trajectory. |
| `tailPhysicsDamping = 0.64` | Tail damping term is `2 * 0.64 * 10.5`. | Use velocity damping in the spring, not position lerp. Test settling without runaway oscillation. |
| `tailInertia = 0.18` | Relative force is `(-clampedBodyAcceleration + gravity*1550) * 0.18`. | Derive body acceleration from current minus prior velocity over fixed delta. Test jump acceleration makes tail lag below/opposite motion. |
| `tailMaximumBodyAcceleration = 4200` | Body acceleration supplied to tail inertia is vector-magnitude capped at 4200. | Clamp the vector, not each component. Test diagonal acceleration magnitude. |
| `tailTurnSpringFrequency = 16` | Scalar `tail_facing` springs toward ±1 at frequency 16. | Preserve continuous turn state rather than flipping the tail path. Test facing reversal crosses smoothly. |
| `tailTurnSpringDamping = 0.86` | Damping ratio for the facing spring. | Use the same second-order spring equation; clamp facing to Web range -1.08…1.08. Test overshoot bound. |
| `maximumSwingSpeed = 930` | Tail desired length adds `clamp(speed/930)*10`. | Reuse the shared normalized swing speed; a test should compare rest and capped-speed lengths. |

## Coverage accounting and implementation order

The tables contain 62 unique approved keys. Three shared keys are intentionally repeated at their second semantic consumer: `hardBarThickness`, `maximumSwingSpeed` in soft-body, and `maximumSwingSpeed` in tail. Static coverage should therefore report 97/97 only after executable runtime consumers exist, while behavioral acceptance should be grouped as follows:

1. Fixed-step physics and replay evidence: friction, damage recovery, glide/updraft, energy floor, goal padding, delayed respawn.
2. Constraint mechanics: rope lifecycle, winch, swing input/damping, exact target IDs and length samples.
3. Camera/rotation: exponential follow, look-ahead, eased rotation, screen-down gravity.
4. Render state: rope curve, soft-body pose, and tail springs with collision shape unchanged.

Required evidence for acceptance:

- Static audit: `node scripts/audit-godot-tuning-coverage.mjs` reports 97/97.
- Headless tests perturb representative values and observe changed results; changing a key must fail its behavior test.
- Ten replay cases retain exact content hash and emit actual mechanism evidence, not just input presses.
- Telemetry includes attachment target/length, mechanism event ticks, resource/death counters, and enough camera/visual state for deterministic assertions without using telemetry as game logic.
