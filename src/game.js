import { ABILITIES, KNOWN_ABILITY_IDS, TUNING, VIEWPORT } from "./config.js";
import { syncCanvasBackingStore } from "./display.js";
import {
  BUILTIN_PROCEDURAL_ASSET_ID,
  DEFAULT_ASSET_REGISTRY,
  DEFAULT_VISUAL_CONFIG
} from "./asset-library.js";
import { createLevelEditor } from "./level-editor.js";
import { LEVELS } from "./levels.js";
import { validateLevel } from "./level-validator.js";
import { resolveLevelStartingAbilities } from "./level-support.js";
import { boundaryWallSegments, resolvePlayerAgainstBoundaryWall } from "./boundary-wall.js";
import { ReferenceLevelLibrary, ReferenceRunState } from "./reference-level-library.js";
import { applyRightwardReferenceAutoplayInput, clearReferenceAutoplayInput } from "./reference-autoplay.js";
import {
  createDashRefillState,
  leaveDashRefill,
  resetDashRefillState,
  tryCollectDashRefill,
  updateDashRefillState
} from "./dash-refill.js";
import {
  advanceMotionState,
  createMotionState,
  isPlayerStandingOnMovingPlatform,
  movingRectSweepContact,
  resetMotionState,
  resolvePlayerAgainstMovingRect
} from "./motion.js";
import {
  applyLiquidForces,
  activateStateTrigger,
  createFragilePlatformState,
  createGateState,
  createLauncherState,
  createStateTriggerState,
  evaluateGateState,
  resetFragilePlatformState,
  resetGateState,
  resetStateTrigger,
  touchFragilePlatform,
  tryActivateLauncher,
  updateFragilePlatformState,
  updateLauncherState
} from "./reference-mechanisms.js";
import {
  computeSoftBodyPose,
  createPlayerAnimation,
  triggerDashAnimation,
  triggerJumpAnimation,
  triggerLandingAnimation,
  updatePlayerAnimation
} from "./player-animation.js";
import {
  circleIntersectsRect,
  clamp,
  closestPointOnSegment,
  closestPointsBetweenSegments,
  dot,
  easeInOutCubic,
  formatNumber,
  inverseRotate,
  length,
  lerp,
  moveToward,
  normalize,
  pointInRect,
  rotate,
  TAU
} from "./math.js";
import { advancePointTowards, applyConstraintDamping, applyMinimumUpdraftLift, applyRopeWinch, applySwingInput, applyWindForce, computeDamageRecoveryVelocity, computeDashVelocity, computeRopeVisualTarget, constrainRigidBar, decelerateUpdraftLift, grantAbility, hasClearLineOfSight, hazardBaseSegment, hazardHardBarSurface, isGoalReached, limitSpeedAlongDirection, limitUpdraftLiftSpeed, resolveHazardBaseCollision, restoreResource, shouldReleaseBash, shouldUseRopeWinch, spendEnergy, takeDamage } from "./rules.js";
import { LatestRequestCoordinator, PreparedVisualLoadCoordinator, VisualRuntime, isObjectVisualVisible, stableSortRenderQueue } from "./visual-runtime.js";

const canvas = typeof document === "undefined" ? null : document.querySelector("#game");
const context = canvas?.getContext("2d") || null;
const startCard = typeof document === "undefined" ? null : document.querySelector("#start-card");
const levelGrid = typeof document === "undefined" ? null : document.querySelector("#level-grid");
const levelEditorRoot = typeof document === "undefined" ? null : document.querySelector("#level-editor");
const openLevelEditorButton = typeof document === "undefined" ? null : document.querySelector("#open-level-editor");

// Game.renderHud() is defined at module scope and is also exercised by the
// headless Web replay runner. Keep the reference-library state in the same
// lexical scope instead of hiding it inside the browser bootstrap block.
let referenceCollections = [];
let referenceRunState = null;

for (const level of LEVELS) {
  const levelErrors = validateLevel(level);
  if (levelErrors.length > 0) throw new Error(`${level.id}:\n${levelErrors.join("\n")}`);
}

export class Input {
  constructor(target) {
    this.target = target;
    this.keys = new Set();
    this.keyPresses = new Set();
    this.keyReleases = new Set();
    this.mouse = { x: VIEWPORT.width * 0.68, y: VIEWPORT.height * 0.45, left: false };
    this.mousePresses = new Set();

    window.addEventListener("keydown", (event) => {
      const captured = [
        "KeyA", "KeyD", "KeyW", "KeyS", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
        "ControlLeft", "ControlRight", "KeyE", "KeyF", "KeyP", "KeyQ", "KeyR",
        "ShiftLeft", "ShiftRight", "Space", "Backspace", "Backquote", "Escape"
      ];
      if (captured.includes(event.code)) event.preventDefault();
      if (!this.keys.has(event.code)) this.keyPresses.add(event.code);
      this.keys.add(event.code);
    });

    window.addEventListener("keyup", (event) => {
      if (this.keys.has(event.code)) this.keyReleases.add(event.code);
      this.keys.delete(event.code);
    });
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.mouse.left = false;
    });

    target.addEventListener("pointermove", (event) => this.updatePointer(event));
    target.addEventListener("pointerdown", (event) => {
      this.updatePointer(event);
      target.focus();
      if (event.button === 0) {
        if (!this.mouse.left) this.mousePresses.add("left");
        this.mouse.left = true;
      }
    });
    window.addEventListener("pointerup", (event) => {
      if (event.button === 0) this.mouse.left = false;
    });
    target.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  updatePointer(event) {
    const bounds = this.target.getBoundingClientRect();
    this.mouse.x = (event.clientX - bounds.left) * VIEWPORT.width / bounds.width;
    this.mouse.y = (event.clientY - bounds.top) * VIEWPORT.height / bounds.height;
  }

  down(...codes) {
    return codes.some((code) => this.keys.has(code));
  }

  pressed(...codes) {
    return codes.some((code) => this.keyPresses.has(code));
  }

  released(...codes) {
    return codes.some((code) => this.keyReleases.has(code));
  }

  mousePressed(button) {
    return this.mousePresses.has(button);
  }

  finishSimulationStep() {
    this.keyPresses.clear();
    this.keyReleases.clear();
    this.mousePresses.clear();
  }
}

class ParticleField {
  constructor() {
    this.items = [];
  }

  burst(x, y, color, count = 12, speed = 180) {
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * TAU;
      const velocity = speed * (0.35 + Math.random() * 0.65);
      this.items.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life: 0.35 + Math.random() * 0.45,
        maximumLife: 0.8,
        size: 2 + Math.random() * 4,
        color
      });
    }
  }

  trail(x, y, vx, vy) {
    if (this.items.length > 260) return;
    this.items.push({
      x: x + (Math.random() - 0.5) * 12,
      y: y + (Math.random() - 0.5) * 12,
      vx: -vx * 0.04 + (Math.random() - 0.5) * 22,
      vy: -vy * 0.04 + (Math.random() - 0.5) * 22,
      life: 0.26,
      maximumLife: 0.26,
      size: 2 + Math.random() * 3,
      color: "#7cf7eb"
    });
  }

  windTrail(x, y, forceX, forceY) {
    if (this.items.length > 260) return;
    const direction = normalize(forceX, forceY, 0, -1);
    const speed = clamp(Math.hypot(forceX, forceY) * 0.24, 110, 260);
    this.items.push({
      x: x - direction.x * 34 + (Math.random() - 0.5) * 44,
      y: y - direction.y * 34 + (Math.random() - 0.5) * 44,
      vx: direction.x * speed + (Math.random() - 0.5) * 28,
      vy: direction.y * speed + (Math.random() - 0.5) * 28,
      life: 0.32,
      maximumLife: 0.32,
      size: 2.5 + Math.random() * 3.5,
      color: "#83dcff"
    });
  }

  update(deltaTime) {
    for (const particle of this.items) {
      particle.life -= deltaTime;
      particle.x += particle.vx * deltaTime;
      particle.y += particle.vy * deltaTime;
      particle.vx *= Math.pow(0.08, deltaTime);
      particle.vy *= Math.pow(0.08, deltaTime);
    }
    this.items = this.items.filter((particle) => particle.life > 0);
  }

  render(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const particle of this.items) {
      const alpha = clamp(particle.life / particle.maximumLife, 0, 1);
      ctx.globalAlpha = alpha * 0.7;
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size * alpha, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

export class Game {
  constructor(ctx, input, levels, { autoFrame = true, preloadVisuals = true } = {}) {
    this.ctx = ctx;
    this.input = input;
    this.levels = levels;
    this.running = false;
    this.paused = false;
    this.debug = false;
    this.elapsed = 0;
    this.accumulator = 0;
    this.lastTimestamp = 0;
    this.toast = { text: "", time: 0, tone: "normal" };
    this.particles = new ParticleField();
    this.visualRuntime = new VisualRuntime({ registry: DEFAULT_ASSET_REGISTRY });
    this.visualLoadCoordinator = new PreparedVisualLoadCoordinator(this.visualRuntime);
    this.onRoomExit = null;
    this.frameMetrics = { samples: [], averageFps: 0, averageMs: 0, p95Ms: 0, worstMs: 0 };
    this.debugStats = { activeObjects: 0, renderedObjects: 0, collisionCandidates: 0 };
    this.loadLevel(levels[0], { visualsPrepared: !preloadVisuals });
    this.frameRequest = autoFrame ? requestAnimationFrame((timestamp) => this.frame(timestamp)) : null;
  }

  loadLevel(level, options = {}) {
    this.level = level;
    this.elapsed = 0;
    this.accumulator = 0;
    this.toast = { text: "", time: 0, tone: "normal" };
    this.particles = new ParticleField();
    const entrance = options.entranceId
      ? (level.roomEntrances || []).find((item) => item.id === options.entranceId)
      : null;
    const initialSpawn = entrance?.spawn || options.spawn || level.spawn;
    this.camera = {
      x: initialSpawn.x,
      y: initialSpawn.y - 30,
      angle: 0,
      rotation: null
    };
    this.runtime = {
      energyOrbs: level.energyOrbs.map((orb) => ({ ...orb, available: true, respawnTimer: 0 })),
      dashRefills: (level.dashRefills || []).map(createDashRefillState),
      movingObjects: (level.movingObjects || []).map((item) => ({
        ...createMotionState(item),
        type: item.anchorType,
        cooldown: 0
      })),
      launchers: (level.launchers || []).map(createLauncherState),
      fragilePlatforms: (level.fragilePlatforms || []).map(createFragilePlatformState),
      gates: (level.gates || []).map(createGateState),
      stateTriggers: (level.stateTriggers || []).map(createStateTriggerState),
      flags: new Set(options.flags || []),
      abilityPickups: level.abilityPickups.map((pickup) => ({ ...pickup, collected: false })),
      bashTargets: level.bashTargets.map((target) => ({ ...target, cooldown: 0 })),
      bashAim: null,
      rotationTriggers: level.rotationTriggers.map((trigger) => ({ ...trigger, activated: false })),
      goalReached: false,
      hardBar: null,
      transitioning: false,
      exitCooldown: entrance ? 0.35 : 0.2
    };
    const startingAbilities = resolveLevelStartingAbilities(level, options.abilities);
    this.abilities = new Set(startingAbilities);
    this.runtime.gates = this.runtime.gates.map((gate) => evaluateGateState(gate, this.abilities, this.runtime.flags));
    const configuredCheckpoint = options.checkpointId
      ? level.checkpoints.find((checkpoint) => checkpoint.id === options.checkpointId)
      : null;
    this.currentCheckpoint = configuredCheckpoint || {
      ...level.checkpoints[0],
      ...(entrance ? { spawn: { ...initialSpawn } } : {})
    };
    this.blockingSurfaces = this.buildBlockingSurfaces();
    this.grappleSurfaces = this.blockingSurfaces.filter((surface) => surface.grapple);
    this.hardBarSurfaces = [...this.grappleSurfaces, ...this.buildHazardAttachmentSurfaces()];
    this.player = this.createPlayer(initialSpawn);
    this.ropeTarget = null;
    this.hardBarTarget = null;
    this.bashTarget = null;
    this.ropeWinching = false;
    this.debugStats.activeObjects = this.countLevelObjects();
    this.debugStats.renderedObjects = 0;
    this.debugStats.collisionCandidates = 0;
    if (!options.visualsPrepared) void this.visualRuntime.preloadLevel(level);
  }

  setRoomExitHandler(handler) {
    this.onRoomExit = typeof handler === "function" ? handler : null;
  }

  countLevelObjects() {
    return [
      "backgroundSeeds", "boundaryWalls", "platforms", "slopes", "hazards", "anchors", "energyOrbs",
      "dashRefills", "movingObjects", "launchers", "fragilePlatforms", "gates", "stateTriggers", "abilityPickups", "bashTargets", "windZones", "liquidZones", "darknessZones", "checkpoints", "roomEntrances",
      "roomExits", "rotationTriggers", "signs"
    ].reduce((sum, collection) => sum + (this.level[collection]?.length || 0), this.level.goal ? 1 : 0);
  }

  createPlayer(spawn) {
    const maximumDashCharges = this.abilities?.has("dash") ? (this.level.dashCapacity ?? 1) : 0;
    return {
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      radius: TUNING.playerRadius,
      health: TUNING.maximumHealth,
      energy: TUNING.maximumEnergy,
      grounded: false,
      wallNormal: null,
      coyoteTimer: 0,
      jumpBufferTimer: 0,
      airJumps: this.abilities?.has("doubleJump") ? 1 : 0,
      rope: null,
      invulnerability: 0,
      damageRecoveryTimer: 0,
      damageRecoveryJump: false,
      gliding: false,
      wind: null,
      liquid: null,
      updraftExitTimer: 0,
      maximumDashCharges,
      dashCharges: maximumDashCharges,
      dashAvailable: maximumDashCharges > 0,
      dashTimer: 0,
      dashDirectionX: 0,
      dashDirectionY: 0,
      timeSinceEnergyUse: 99,
      respawnTimer: 0,
      visible: true,
      facing: 1,
      animation: createPlayerAnimation(1),
      distanceTravelled: 0,
      previousX: spawn.x,
      previousY: spawn.y
    };
  }

  start(level, options = {}) {
    if (level) this.loadLevel(level, options);
    this.running = true;
    this.paused = false;
    this.lastTimestamp = performance.now();
    this.showToast(`${levelDisplayName(this.level)} · 先观察，再连续通过`, 3.2);
  }

  async startPrepared(level, options = {}, adjacentLevels = []) {
    if (!level) throw new Error("A level is required before starting a prepared load");
    this.running = false;
    this.paused = false;
    const prepared = await this.visualLoadCoordinator.prepare(level, adjacentLevels);
    if (!prepared.current) return false;
    this.loadLevel(level, { ...options, visualsPrepared: true });
    this.running = true;
    this.paused = false;
    this.lastTimestamp = performance.now();
    this.showToast(`${levelDisplayName(this.level)} · 当前与相邻场景已准备`, 3.2);
    return true;
  }

  openLevelMenu() {
    globalThis.cablesterCancelPendingLevelStart?.();
    this.visualLoadCoordinator.invalidate();
    this.running = false;
    this.paused = false;
    this.input.keys.clear();
    startCard.classList.remove("is-hidden");
  }

  frame(timestamp) {
    const rawDelta = this.lastTimestamp ? (timestamp - this.lastTimestamp) / 1000 : 0;
    this.lastTimestamp = timestamp;
    this.recordFrameMetric(rawDelta * 1000);
    const frameDelta = clamp(rawDelta, 0, TUNING.maxFrameDelta);

    if (this.running && !this.paused) {
      this.accumulator += frameDelta;
      while (this.accumulator >= TUNING.fixedStep) {
        this.update(TUNING.fixedStep);
        this.accumulator -= TUNING.fixedStep;
        this.input.finishSimulationStep();
      }
    } else {
      if (this.input.pressed("KeyP") && this.running) this.paused = !this.paused;
      this.input.finishSimulationStep();
    }

    this.render();
    this.frameRequest = requestAnimationFrame((nextTimestamp) => this.frame(nextTimestamp));
  }

  recordFrameMetric(frameMs) {
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 250) return;
    const samples = this.frameMetrics.samples;
    samples.push(frameMs);
    if (samples.length > 240) samples.shift();
    if (samples.length < 2) return;
    const sorted = [...samples].sort((left, right) => left - right);
    const averageMs = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    this.frameMetrics.averageMs = averageMs;
    this.frameMetrics.averageFps = 1000 / averageMs;
    this.frameMetrics.p95Ms = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    this.frameMetrics.worstMs = sorted[sorted.length - 1];
  }

  update(deltaTime) {
    this.debugStats.collisionCandidates = 0;
    if (this.input.pressed("Escape")) {
      this.openLevelMenu();
      return;
    }

    if (this.input.pressed("KeyP")) {
      this.paused = true;
      return;
    }
    if (this.input.pressed("Backquote")) this.debug = !this.debug;

    if (this.runtime.bashAim) {
      this.toast.time = Math.max(0, this.toast.time - deltaTime);
      this.updateBashAim(deltaTime);
      this.updateCamera(deltaTime);
      return;
    }

    this.elapsed += deltaTime;
    this.toast.time = Math.max(0, this.toast.time - deltaTime);
    this.updateRotation(deltaTime);

    if (this.input.pressed("Backspace")) this.beginRespawn("返回最近安全点");
    if (this.input.pressed("KeyR")) this.startRotation(Math.PI / 2, "手动旋转测试");

    this.updateRuntimeItems(deltaTime);
    if (this.player.respawnTimer > 0) {
      this.player.respawnTimer -= deltaTime;
      if (this.player.respawnTimer <= 0) this.respawn();
      this.updateCamera(deltaTime);
      return;
    }

    this.updateTargets();
    if (this.handleBashInput()) {
      this.updateCamera(deltaTime);
      return;
    }
    this.updatePlayer(deltaTime);
    this.updateInteractions();
    this.updateCamera(deltaTime);
    this.particles.update(deltaTime);
  }

  gravityDirection() {
    return inverseRotate(0, 1, this.camera.angle);
  }

  screenRightDirection() {
    return inverseRotate(1, 0, this.camera.angle);
  }

  updatePlayer(deltaTime) {
    const player = this.player;
    const gravity = this.gravityDirection();
    const tangent = this.screenRightDirection();
    const wasGrounded = player.grounded;
    const wasGliding = player.gliding;
    const previousWind = player.wind;
    const previousWindIds = previousWind?.ids || [];
    const previousWall = player.wallNormal;

    player.previousX = player.x;
    player.previousY = player.y;
    player.wind = null;
    player.invulnerability = Math.max(0, player.invulnerability - deltaTime);
    player.damageRecoveryTimer = Math.max(0, player.damageRecoveryTimer - deltaTime);
    if (player.damageRecoveryTimer <= 0) player.damageRecoveryJump = false;
    player.timeSinceEnergyUse += deltaTime;
    player.coyoteTimer = wasGrounded ? TUNING.coyoteTime : Math.max(0, player.coyoteTimer - deltaTime);
    player.jumpBufferTimer = Math.max(0, player.jumpBufferTimer - deltaTime);

    if (wasGrounded && this.abilities.has("dash")) {
      player.dashCharges = player.maximumDashCharges;
      player.dashAvailable = player.dashCharges > 0;
    }

    let moveAxis = 0;
    if (this.input.down("KeyA", "ArrowLeft")) moveAxis -= 1;
    if (this.input.down("KeyD", "ArrowRight")) moveAxis += 1;
    let verticalAxis = 0;
    if (this.input.down("KeyW", "ArrowUp")) verticalAxis -= 1;
    if (this.input.down("KeyS", "ArrowDown")) verticalAxis += 1;
    if (moveAxis !== 0) player.facing = moveAxis;
    const liquid = (this.level.liquidZones || []).find((zone) => circleIntersectsRect(player.x, player.y, player.radius, zone)) || null;
    player.liquid = liquid;

    this.handleDashInput(moveAxis, verticalAxis);
    const dashing = player.dashTimer > 0;
    player.dashTimer = Math.max(0, player.dashTimer - deltaTime);

    this.ropeWinching = shouldUseRopeWinch(
      this.isRopeAttached(),
      this.input.down("KeyW", "ArrowUp")
    );
    if (this.input.pressed("Space")) player.jumpBufferTimer = TUNING.jumpBufferTime;

    const constrainedMovement = Boolean(this.isRopeAttached() || this.runtime.hardBar);
    if (!constrainedMovement && !dashing) {
      let tangentSpeed = dot(player.vx, player.vy, tangent.x, tangent.y);
      const acceleration = wasGrounded ? TUNING.runAcceleration : TUNING.airAcceleration;
      if (moveAxis !== 0) {
        const nextTangentSpeed = moveToward(tangentSpeed, moveAxis * TUNING.runSpeed, acceleration * deltaTime);
        const tangentDelta = nextTangentSpeed - tangentSpeed;
        player.vx += tangent.x * tangentDelta;
        player.vy += tangent.y * tangentDelta;
        tangentSpeed = nextTangentSpeed;
      } else if (wasGrounded) {
        const nextTangentSpeed = moveToward(tangentSpeed, 0, TUNING.groundFriction * deltaTime);
        const tangentDelta = nextTangentSpeed - tangentSpeed;
        player.vx += tangent.x * tangentDelta;
        player.vy += tangent.y * tangentDelta;
      }
    }

    if (!dashing && player.jumpBufferTimer > 0) {
      if (wasGrounded || player.coyoteTimer > 0) {
        this.performJump(gravity, TUNING.jumpSpeed);
        player.coyoteTimer = 0;
      } else if (previousWall && this.abilities.has("wallGrab")) {
        player.vx = previousWall.x * TUNING.wallJumpAwaySpeed - gravity.x * TUNING.wallJumpUpSpeed;
        player.vy = previousWall.y * TUNING.wallJumpAwaySpeed - gravity.y * TUNING.wallJumpUpSpeed;
        player.jumpBufferTimer = 0;
        triggerJumpAnimation(player.animation);
        this.particles.burst(player.x, player.y, "#87f5ef", 8, 100);
      } else if (player.damageRecoveryJump && player.damageRecoveryTimer > 0) {
        this.performJump(gravity, TUNING.jumpSpeed * 0.92);
        player.damageRecoveryJump = false;
        this.particles.burst(player.x, player.y, "#ff91a8", 14, 145);
      } else if (this.abilities.has("doubleJump") && player.airJumps > 0) {
        this.performJump(gravity, TUNING.jumpSpeed * 0.94);
        player.airJumps -= 1;
        this.particles.burst(player.x, player.y, "#d8a6ff", 16, 150);
      }
    }

    let gravityScale = dashing ? 0 : 1;
    const fallingSpeed = dot(player.vx, player.vy, gravity.x, gravity.y);
    const wantsGlide = !dashing && !this.isRopeAttached() && this.abilities.has("glide") && this.input.down("Space");
    player.gliding = !wasGrounded && wantsGlide && (wasGliding || fallingSpeed > 40);
    if (player.gliding) gravityScale = TUNING.glideGravityScale;
    if (previousWall && this.abilities.has("wallGrab") && this.input.down("ShiftLeft", "ShiftRight")) {
      gravityScale = 0.1;
      const wallFallSpeed = dot(player.vx, player.vy, gravity.x, gravity.y);
      if (wallFallSpeed > TUNING.wallSlideSpeed) {
        player.vx -= gravity.x * (wallFallSpeed - TUNING.wallSlideSpeed);
        player.vy -= gravity.y * (wallFallSpeed - TUNING.wallSlideSpeed);
      }
    }
    if (liquid) gravityScale *= liquid.gravityScale;

    player.vx += gravity.x * TUNING.gravity * gravityScale * deltaTime;
    player.vy += gravity.y * TUNING.gravity * gravityScale * deltaTime;

    if (liquid && !dashing) {
      const fluidVelocity = applyLiquidForces(player, liquid, deltaTime, { x: moveAxis, y: verticalAxis });
      player.vx = fluidVelocity.vx;
      player.vy = fluidVelocity.vy;
    }

    if (player.gliding) {
      const limited = limitSpeedAlongDirection(player, gravity, TUNING.glideMaximumFallSpeed);
      player.vx = limited.vx;
      player.vy = limited.vy;
    }

    this.handleRopeInput(deltaTime);
    this.handleHardBarInput();
    this.applySwingMovement(dashing ? 0 : moveAxis, deltaTime);
    this.applyPassiveConstraintDamping(deltaTime);
    this.applyRopeForces(deltaTime);

    for (const wind of dashing ? [] : this.level.windZones) {
      if (!circleIntersectsRect(player.x, player.y, player.radius, wind)) continue;
      const multiplier = player.gliding ? TUNING.glideWindMultiplier : 1;
      const updraftStrength = -dot(wind.forceX, wind.forceY, gravity.x, gravity.y);
      const liftActive = player.gliding && updraftStrength > 0;
      const enteredUpdraft = liftActive
        && (!wasGliding || !previousWindIds.includes(wind.id));
      if (enteredUpdraft) {
        const lifted = applyMinimumUpdraftLift(player, gravity, TUNING.glideUpdraftEntrySpeed);
        player.vx = lifted.vx;
        player.vy = lifted.vy;
        this.particles.burst(player.x, player.y, "#a9edff", 18, 155);
        this.showToast("上升气流托举 · 保持滑翔继续上升", 1.1, "ability");
      }
      const accelerated = applyWindForce(player, wind, deltaTime, multiplier);
      player.vx = accelerated.vx;
      player.vy = accelerated.vy;
      if (liftActive) {
        const limitedLift = limitUpdraftLiftSpeed(player, gravity, TUNING.glideUpdraftMaximumSpeed);
        player.vx = limitedLift.vx;
        player.vy = limitedLift.vy;
      }
      if (!player.wind) player.wind = { forceX: 0, forceY: 0, multiplier, ids: [], updraft: false, liftActive: false };
      player.wind.forceX += wind.forceX * multiplier;
      player.wind.forceY += wind.forceY * multiplier;
      player.wind.multiplier = multiplier;
      player.wind.ids.push(wind.id);
      player.wind.updraft ||= updraftStrength > 0;
      player.wind.liftActive ||= liftActive;
    }

    if (previousWind?.liftActive && !player.wind?.liftActive && player.gliding) {
      player.updraftExitTimer = TUNING.glideUpdraftExitDampingDuration;
      this.showToast("离开上升气流 · 约 1 秒恢复普通滑翔", 1.0);
    }
    if (!player.gliding || player.wind?.liftActive) {
      player.updraftExitTimer = 0;
    } else if (player.updraftExitTimer > 0) {
      const dampedLift = decelerateUpdraftLift(
        player,
        gravity,
        TUNING.glideUpdraftExitDeceleration,
        deltaTime
      );
      player.vx = dampedLift.vx;
      player.vy = dampedLift.vy;
      player.updraftExitTimer = Math.max(0, player.updraftExitTimer - deltaTime);
    }

    if (player.wind && Math.random() < 0.2) {
      this.particles.windTrail(player.x, player.y, player.wind.forceX, player.wind.forceY);
    }

    const speed = length(player.vx, player.vy);
    const speedLimit = this.isRopeAttached() ? TUNING.maximumSwingSpeed : TUNING.terminalSpeed;
    if (speed > speedLimit) {
      player.vx = player.vx / speed * speedLimit;
      player.vy = player.vy / speed * speedLimit;
    }

    const impactSpeed = Math.max(0, dot(player.vx, player.vy, gravity.x, gravity.y));
    player.x += player.vx * deltaTime;
    player.y += player.vy * deltaTime;
    this.constrainRope();
    this.constrainHardBar();
    this.resolveCollisions();
    this.constrainHardBar();
    // A hard-bar projection may move the player back across an invisible
    // boundary after the first collision pass. Re-resolve boundaries last so
    // authored level edges remain authoritative without turning them into
    // grappleable platform surfaces.
    for (const wall of this.level.boundaryWalls || []) {
      const contact = resolvePlayerAgainstBoundaryWall(this.player, wall);
      if (!contact) continue;
      Object.assign(this.player, {
        x: contact.x,
        y: contact.y,
        vx: contact.vx,
        vy: contact.vy
      });
    }
    this.updateRopeVisual(deltaTime);

    if (!wasGrounded && player.grounded) {
      triggerLandingAnimation(player.animation, gravity, impactSpeed);
    }
    updatePlayerAnimation(player.animation, {
      vx: player.vx,
      vy: player.vy,
      gravity,
      tangent,
      grounded: player.grounded,
      gliding: player.gliding,
      constrained: Boolean(this.isRopeAttached() || this.runtime.hardBar),
      dashing,
      facing: player.facing,
      distanceTravelled: player.distanceTravelled
    }, deltaTime);

    player.distanceTravelled += length(player.x - player.previousX, player.y - player.previousY);
    if (player.grounded) {
      player.airJumps = this.abilities.has("doubleJump") ? 1 : 0;
      player.dashCharges = this.abilities.has("dash") ? player.maximumDashCharges : 0;
      player.dashAvailable = player.dashCharges > 0;
    }

    if (player.grounded && !this.isRopeAttached() && player.timeSinceEnergyUse >= TUNING.safeEnergyDelay && player.energy < TUNING.safeEnergyFloor) {
      player.energy = Math.min(TUNING.safeEnergyFloor, player.energy + TUNING.safeEnergyRegen * deltaTime);
    }

    if (length(player.vx, player.vy) > 420 && Math.random() < 0.48) {
      this.particles.trail(player.x, player.y, player.vx, player.vy);
    }

    if (!pointInRect(player.x, player.y, this.level.bounds)) this.beginRespawn("坠落 · 返回安全点");
  }

  performJump(gravity, speed) {
    const player = this.player;
    const fallingSpeed = dot(player.vx, player.vy, gravity.x, gravity.y);
    if (fallingSpeed > 0) {
      player.vx -= gravity.x * fallingSpeed;
      player.vy -= gravity.y * fallingSpeed;
    }
    player.vx -= gravity.x * speed;
    player.vy -= gravity.y * speed;
    player.jumpBufferTimer = 0;
    player.grounded = false;
    triggerJumpAnimation(player.animation);
  }

  handleDashInput(horizontalAxis, verticalAxis) {
    const player = this.player;
    if (!this.input.pressed("ControlLeft") && !this.input.pressed("ControlRight")) return false;
    if (!this.abilities.has("dash") || player.dashCharges <= 0) {
      if (this.abilities.has("dash")) this.showToast("冲刺尚未恢复 · 落地后重置", 0.9, "warning");
      return false;
    }
    const dash = computeDashVelocity(
      horizontalAxis,
      verticalAxis,
      player.facing,
      this.screenRightDirection(),
      this.gravityDirection(),
      TUNING.dashSpeed
    );
    player.vx = dash.vx;
    player.vy = dash.vy;
    player.dashDirectionX = dash.directionX;
    player.dashDirectionY = dash.directionY;
    player.dashTimer = TUNING.dashDuration;
    player.dashCharges = Math.max(0, player.dashCharges - 1);
    player.dashAvailable = player.dashCharges > 0;
    player.grounded = false;
    player.gliding = false;
    triggerDashAnimation(player.animation, dash.directionX, dash.directionY);
    this.particles.burst(player.x, player.y, "#a5eeff", 18, 220);
    this.showToast("冲刺 · 可在途中连接软绳或硬杆继承速度", 1.05, "ability");
    return true;
  }

  isRopeAttached() {
    return this.player.rope?.phase === "attached";
  }

  handleRopeInput(deltaTime) {
    const wantsRope = this.input.mouse.left || this.input.down("KeyE");
    const startedRope = this.input.mousePressed("left") || this.input.pressed("KeyE");
    if (startedRope && this.player.rope?.phase === "retracting") this.detachRope(false);
    if (startedRope && !this.player.rope && this.abilities.has("rope")) this.attachRope();
    if (!wantsRope && this.player.rope?.phase !== "retracting") this.detachRope(true);

    this.updateRopeLifecycle(deltaTime);
  }

  attachRope() {
    if (!this.ropeTarget) {
      this.showToast("没有可锁定的软绳支点", 1.1, "warning");
      return;
    }
    const payment = spendEnergy(this.player.energy, TUNING.ropeCost);
    if (!payment.ok) {
      this.showToast("蓝量不足 · 在安全地面恢复保底能量", 1.8, "warning");
      return;
    }
    this.player.energy = payment.value;
    this.player.timeSinceEnergyUse = 0;
    this.detachHardBar(false);
    const distance = length(this.player.x - this.ropeTarget.x, this.player.y - this.ropeTarget.y);
    this.player.rope = {
      anchorId: this.ropeTarget.id,
      x: this.ropeTarget.x,
      y: this.ropeTarget.y,
      tipX: this.player.x,
      tipY: this.player.y,
      phase: "firing",
      length: clamp(distance, TUNING.ropeMinimumLength, TUNING.ropeMaximumLength),
      reelSpeed: 0,
      reelBoostApplied: false,
      swingControl: 0,
      visualSag: 0,
      visualTension: 0,
      bendX: 0,
      bendY: 1
    };
    this.particles.burst(this.player.x, this.player.y, "#74fff3", 8, 115);
  }

  detachRope(animated = true) {
    if (!this.player.rope) return;
    if (animated) {
      const rope = this.player.rope;
      if (rope.phase !== "retracting") {
        rope.tipX = rope.phase === "attached" ? rope.x : rope.tipX;
        rope.tipY = rope.phase === "attached" ? rope.y : rope.tipY;
        rope.phase = "retracting";
        rope.swingControl = 0;
        this.particles.burst(this.player.x, this.player.y, "#8ff9f0", 5, 60);
      }
      return;
    }
    this.particles.burst(this.player.x, this.player.y, "#8ff9f0", 5, 60);
    this.player.rope = null;
  }

  updateRopeLifecycle(deltaTime) {
    const rope = this.player.rope;
    if (!rope || rope.phase === "attached") return;
    const target = rope.phase === "firing"
      ? { x: rope.x, y: rope.y }
      : { x: this.player.x, y: this.player.y };
    const speed = rope.phase === "firing" ? TUNING.ropeLaunchSpeed : TUNING.ropeRetractSpeed;
    const advanced = advancePointTowards({ x: rope.tipX, y: rope.tipY }, target, speed, deltaTime);
    rope.tipX = advanced.x;
    rope.tipY = advanced.y;
    if (!advanced.reached) return;
    if (rope.phase === "firing") {
      if (!this.isReachableTarget(rope.x, rope.y)) {
        rope.phase = "retracting";
        this.showToast("出绳途中目标被遮挡 · 自动回收", 1.1, "warning");
        return;
      }
      rope.phase = "attached";
      rope.tipX = rope.x;
      rope.tipY = rope.y;
      this.particles.burst(rope.x, rope.y, "#74fff3", 12, 105);
      return;
    }
    this.player.rope = null;
  }

  applyRopeForces(deltaTime) {
    const rope = this.player.rope;
    if (!rope || rope.phase !== "attached") return;
    const dx = this.player.x - rope.x;
    const dy = this.player.y - rope.y;
    const distance = length(dx, dy);
    const radial = normalize(dx, dy);
    if (distance > rope.length * 0.96) {
      const stretch = distance - rope.length * 0.96;
      const inwardAcceleration = stretch * TUNING.ropePullStrength;
      this.player.vx -= radial.x * inwardAcceleration * deltaTime;
      this.player.vy -= radial.y * inwardAcceleration * deltaTime;
    }

    if (this.ropeWinching) {
      const winched = applyRopeWinch(
        {
          length: rope.length,
          reelSpeed: rope.reelSpeed || 0,
          vx: this.player.vx,
          vy: this.player.vy,
          boostApplied: rope.reelBoostApplied || false
        },
        radial,
        deltaTime,
        {
          minimumLength: TUNING.ropeMinimumLength,
          maximumReelSpeed: TUNING.ropeReelMaximumSpeed,
          reelAcceleration: TUNING.ropeReelAcceleration,
          acceleration: TUNING.ropeWinchAcceleration,
          speedAccelerationFactor: TUNING.ropeWinchSpeedFactor,
          completionBoost: TUNING.ropeWinchCompletionBoost
        }
      );
      rope.length = winched.length;
      rope.reelSpeed = winched.reelSpeed;
      rope.reelBoostApplied = winched.boostApplied;
      this.player.vx = winched.vx;
      this.player.vy = winched.vy;
      if (winched.completed) {
        this.particles.burst(this.player.x, this.player.y, "#c5fff8", 18, 210);
        this.showToast("收绳到底 · 获得额外拉力", 1.05, "ability");
      }
    } else {
      rope.reelSpeed = moveToward(rope.reelSpeed || 0, 0, TUNING.ropeReelDeceleration * deltaTime);
    }
  }

  updateRopeVisual(deltaTime) {
    const rope = this.player.rope;
    if (!rope) return;
    const endpoint = rope.phase === "attached"
      ? { x: rope.x, y: rope.y }
      : { x: rope.tipX, y: rope.tipY };
    const displayLength = Math.max(
      TUNING.ropeMinimumLength,
      length(this.player.x - endpoint.x, this.player.y - endpoint.y)
    );
    const target = computeRopeVisualTarget(
      { x: this.player.x, y: this.player.y, vx: this.player.vx, vy: this.player.vy },
      endpoint,
      this.gravityDirection(),
      rope.phase === "attached" ? rope.length : displayLength,
      {
        minimumSag: TUNING.ropeVisualMinimumSag,
        maximumSag: TUNING.ropeVisualMaximumSag,
        sagRatio: TUNING.ropeVisualSagRatio,
        maximumSwingSpeed: TUNING.maximumSwingSpeed
      }
    );
    const animationSag = rope.phase === "attached"
      ? 0
      : Math.min(TUNING.ropeVisualMaximumSag, displayLength * TUNING.ropeAnimationSagRatio);
    const blend = 1 - Math.exp(-TUNING.ropeVisualSmoothing * deltaTime);
    rope.visualSag = lerp(rope.visualSag, target.sag + animationSag, blend);
    rope.visualTension = lerp(
      rope.visualTension,
      rope.phase === "attached" ? target.tension : target.tension * 0.2,
      blend
    );
    const bendX = lerp(rope.bendX, target.bendX, blend);
    const bendY = lerp(rope.bendY, target.bendY, blend);
    const bend = normalize(bendX, bendY, target.bendX, target.bendY);
    rope.bendX = bend.x;
    rope.bendY = bend.y;
  }

  applySwingMovement(moveAxis, deltaTime) {
    const constraint = this.runtime.hardBar || (this.isRopeAttached() ? this.player.rope : null);
    if (!constraint) return;
    const pivot = this.runtime.hardBar
      ? { x: constraint.pivotX, y: constraint.pivotY }
      : { x: constraint.x, y: constraint.y };
    const result = applySwingInput(
      {
        x: this.player.x,
        y: this.player.y,
        vx: this.player.vx,
        vy: this.player.vy,
        controlStrength: constraint.swingControl || 0,
        kick: moveAxis !== 0 && this.input.pressed("KeyA", "KeyD", "ArrowLeft", "ArrowRight")
      },
      pivot,
      this.screenRightDirection(),
      moveAxis,
      deltaTime,
      {
        smoothing: TUNING.swingInputSmoothing,
        acceleration: TUNING.swingAcceleration,
        braking: TUNING.swingBraking,
        targetSpeed: TUNING.swingTargetSpeed,
        startKickSpeed: TUNING.swingStartKickSpeed,
        pumpFullSpeed: TUNING.swingPumpFullSpeed
      }
    );
    this.player.vx = result.vx;
    this.player.vy = result.vy;
    constraint.swingControl = result.controlStrength;
  }

  applyPassiveConstraintDamping(deltaTime) {
    const bar = this.runtime.hardBar;
    const rope = this.isRopeAttached() ? this.player.rope : null;
    if (!bar && !rope) return;
    if (rope) {
      const distanceToAnchor = length(this.player.x - rope.x, this.player.y - rope.y);
      if (distanceToAnchor < rope.length * 0.9) return;
    }
    const pivot = bar
      ? { x: bar.pivotX, y: bar.pivotY }
      : { x: rope.x, y: rope.y };
    const damped = applyConstraintDamping(
      { x: this.player.x, y: this.player.y, vx: this.player.vx, vy: this.player.vy },
      pivot,
      bar ? TUNING.hardBarSwingDamping : TUNING.ropeSwingDamping,
      deltaTime
    );
    this.player.vx = damped.vx;
    this.player.vy = damped.vy;
  }

  constrainRope() {
    const rope = this.player.rope;
    if (!rope || rope.phase !== "attached") return;
    const dx = this.player.x - rope.x;
    const dy = this.player.y - rope.y;
    const distance = length(dx, dy);
    if (distance <= rope.length || distance < 0.0001) return;
    const radialX = dx / distance;
    const radialY = dy / distance;
    this.player.x = rope.x + radialX * rope.length;
    this.player.y = rope.y + radialY * rope.length;
    const outwardSpeed = dot(this.player.vx, this.player.vy, radialX, radialY);
    if (outwardSpeed > 0) {
      this.player.vx -= radialX * outwardSpeed;
      this.player.vy -= radialY * outwardSpeed;
    }
  }

  handleHardBarInput() {
    if (!this.input.pressed("KeyF")) return;
    if (!this.abilities.has("hardBar")) return;
    if (this.runtime.hardBar) {
      this.detachHardBar(true);
      return;
    }
    if (!this.hardBarTarget) {
      this.showToast("指向范围内墙壁、地面、斜面或伤害区底部碰撞面后连接硬杆", 1.4, "warning");
      return;
    }
    const payment = spendEnergy(this.player.energy, TUNING.hardBarCost);
    if (!payment.ok) {
      this.showToast("蓝量不足，无法生成硬杆", 1.4, "warning");
      return;
    }
    const fixedLength = length(
      this.player.x - this.hardBarTarget.x,
      this.player.y - this.hardBarTarget.y
    );
    this.detachRope();
    this.runtime.hardBar = {
      anchorId: this.hardBarTarget.id,
      pivotX: this.hardBarTarget.x,
      pivotY: this.hardBarTarget.y,
      length: fixedLength,
      surfaceKind: this.hardBarTarget.kind,
      surfaceAttachment: this.hardBarTarget.surface.attachment || null,
      swingControl: 0
    };
    this.player.energy = payment.value;
    this.player.timeSinceEnergyUse = 0;
    this.particles.burst(this.player.x, this.player.y, "#ffc86e", 10, 100);
    this.particles.burst(this.hardBarTarget.x, this.hardBarTarget.y, "#ffc86e", 18, 160);
    if (this.hardBarTarget.kind === "hazard") {
      this.showToast("硬杆已撑在伤害区底部碰撞面 · Space起跳", 1.5, "ability");
    }
  }

  detachHardBar(withImpulse = false) {
    const bar = this.runtime.hardBar;
    if (!bar) return;
    if (withImpulse) {
      this.particles.burst(this.player.x, this.player.y, "#ffc86e", 12, 150);
      this.showToast("硬杆释放 · 保留切向速度", 1.1);
    }
    this.runtime.hardBar = null;
  }

  constrainHardBar() {
    const bar = this.runtime.hardBar;
    if (!bar) return;
    const constrained = constrainRigidBar(
      { x: this.player.x, y: this.player.y, vx: this.player.vx, vy: this.player.vy },
      { x: bar.pivotX, y: bar.pivotY },
      bar.length
    );
    this.player.x = constrained.x;
    this.player.y = constrained.y;
    this.player.vx = constrained.vx;
    this.player.vy = constrained.vy;
  }

  handleBashInput() {
    if (!this.input.pressed("KeyQ") || !this.abilities.has("bash")) return false;
    if (!this.bashTarget) {
      this.showToast("靠近紫色六边支点后才能猛击", 1.2, "warning");
      return false;
    }
    const payment = spendEnergy(this.player.energy, TUNING.bashCost);
    if (!payment.ok) {
      this.showToast("蓝量不足，无法猛击", 1.2, "warning");
      return false;
    }
    this.player.energy = payment.value;
    this.player.timeSinceEnergyUse = 0;
    this.runtime.bashAim = {
      target: this.bashTarget,
      direction: this.currentBashDirection(this.bashTarget),
      remaining: TUNING.bashAimDuration
    };
    this.showToast("按住 Q 时停选方向 · 松开立即猛击 · 超时自动释放", TUNING.bashAimDuration, "ability");
    if (this.input.released("KeyQ")) this.finishBashAim();
    return true;
  }

  currentBashDirection(target) {
    const pointer = this.screenToWorld(this.input.mouse.x, this.input.mouse.y);
    const fallback = this.screenRightDirection();
    return normalize(pointer.x - target.x, pointer.y - target.y, fallback.x, fallback.y);
  }

  updateBashAim(deltaTime) {
    const aim = this.runtime.bashAim;
    if (!aim) return;
    aim.direction = this.currentBashDirection(aim.target);
    aim.remaining = Math.max(0, aim.remaining - deltaTime);
    if (!shouldReleaseBash(this.input.released("KeyQ"), aim.remaining)) return;
    this.finishBashAim();
  }

  finishBashAim() {
    const aim = this.runtime.bashAim;
    if (!aim) return;
    this.runtime.bashAim = null;
    this.detachRope();
    this.detachHardBar(false);
    this.player.vx = aim.direction.x * TUNING.bashSpeed;
    this.player.vy = aim.direction.y * TUNING.bashSpeed;
    aim.target.cooldown = TUNING.bashTargetCooldown;
    this.particles.burst(aim.target.x, aim.target.y, "#d99cff", 26, 260);
    this.showToast("猛击释放", 0.7, "ability");
  }

  updateTargets() {
    const pointer = this.screenToWorld(this.input.mouse.x, this.input.mouse.y);
    const aim = normalize(pointer.x - this.player.x, pointer.y - this.player.y, this.player.facing, -0.2);
    const rayEnd = {
      x: this.player.x + aim.x * TUNING.ropeRange,
      y: this.player.y + aim.y * TUNING.ropeRange
    };
    const candidates = [];
    const hardBarCandidates = [];

    for (const surface of this.grappleSurfaces) {
      const match = closestPointsBetweenSegments(
        this.player.x,
        this.player.y,
        rayEnd.x,
        rayEnd.y,
        surface.ax,
        surface.ay,
        surface.bx,
        surface.by
      );
      const targetDistance = length(match.second.x - this.player.x, match.second.y - this.player.y);
      if (match.distance > TUNING.ropeSurfaceAssist || targetDistance < TUNING.ropeMinimumTargetDistance || targetDistance > TUNING.ropeRange) continue;
      if (!this.isReachableTarget(match.second.x, match.second.y)) continue;
      candidates.push({
        id: surface.id,
        kind: "surface",
        x: match.second.x,
        y: match.second.y,
        surface,
        score: match.firstT * TUNING.ropeRange + match.distance * 2.2
      });
    }

    const hardBarAimDistance = clamp(
      length(pointer.x - this.player.x, pointer.y - this.player.y),
      TUNING.hardBarMinimumLength,
      TUNING.hardBarMaximumLength
    );
    for (const surface of this.hardBarSurfaces) {
      const surfacePoint = closestPointOnSegment(pointer.x, pointer.y, surface.ax, surface.ay, surface.bx, surface.by);
      const offsetX = surfacePoint.x - this.player.x;
      const offsetY = surfacePoint.y - this.player.y;
      const forward = dot(offsetX, offsetY, aim.x, aim.y);
      const targetDistance = length(offsetX, offsetY);
      const perpendicular = Math.sqrt(Math.max(0, targetDistance * targetDistance - forward * forward));
      if (
        forward < TUNING.hardBarMinimumLength ||
        perpendicular > TUNING.ropeSurfaceAssist ||
        targetDistance < TUNING.hardBarMinimumLength ||
        targetDistance > TUNING.hardBarMaximumLength ||
        !this.isReachableTarget(surfacePoint.x, surfacePoint.y)
      ) continue;
      hardBarCandidates.push({
        id: surface.id,
        kind: surface.kind,
        x: surfacePoint.x,
        y: surfacePoint.y,
        surface,
        score: perpendicular * 2.6 + Math.abs(targetDistance - hardBarAimDistance) * 0.35
      });
    }

    const movingAnchors = this.runtime.movingObjects.filter((item) => item.objectKind === "anchor");
    for (const anchor of [...this.level.anchors, ...movingAnchors]) {
      const offsetX = anchor.x - this.player.x;
      const offsetY = anchor.y - this.player.y;
      const targetDistance = length(offsetX, offsetY);
      const forward = dot(offsetX, offsetY, aim.x, aim.y);
      if (forward < TUNING.ropeMinimumTargetDistance || forward > TUNING.ropeRange) continue;
      const perpendicular = Math.sqrt(Math.max(0, offsetX * offsetX + offsetY * offsetY - forward * forward));
      if (perpendicular > TUNING.ropeAnchorAssist) continue;
      if (!this.isReachableTarget(anchor.x, anchor.y)) continue;
      candidates.push({
        ...anchor,
        kind: "anchor",
        score: forward + perpendicular * 1.8 - 26
      });
      if ((anchor.type || anchor.anchorType) === "both"
        && targetDistance >= TUNING.hardBarMinimumLength
        && targetDistance <= TUNING.hardBarMaximumLength) {
        hardBarCandidates.push({
          id: anchor.id,
          kind: "anchor",
          x: anchor.x,
          y: anchor.y,
          surface: { attachment: "anchor" },
          score: perpendicular * 2.6 + Math.abs(targetDistance - hardBarAimDistance) * 0.35 - 18
        });
      }
    }

    candidates.sort((left, right) => left.score - right.score || left.id.localeCompare(right.id));
    this.ropeTarget = this.abilities.has("rope") ? candidates[0] || null : null;

    hardBarCandidates.sort((left, right) => left.score - right.score || left.id.localeCompare(right.id));
    this.hardBarTarget = this.abilities.has("hardBar") ? hardBarCandidates[0] || null : null;

    const pointerScreen = this.input.mouse;
    const movingBashTargets = this.runtime.movingObjects.filter((item) => item.objectKind === "bashTarget");
    const bashCandidates = [...this.runtime.bashTargets, ...movingBashTargets]
      .filter((target) => target.cooldown <= 0 && length(target.x - this.player.x, target.y - this.player.y) <= TUNING.bashRange)
      .map((target) => {
        const screen = this.worldToScreen(target.x, target.y);
        const pointerDistance = length(screen.x - pointerScreen.x, screen.y - pointerScreen.y);
        const playerDistance = length(target.x - this.player.x, target.y - this.player.y);
        return { target, score: playerDistance + pointerDistance * 0.16 };
      })
      .sort((left, right) => left.score - right.score || left.target.id.localeCompare(right.target.id));
    this.bashTarget = this.abilities.has("bash") ? bashCandidates[0]?.target || null : null;
  }

  isReachableTarget(x, y) {
    return hasClearLineOfSight(
      { x: this.player.x, y: this.player.y },
      { x, y },
      this.blockingSurfaces
    );
  }

  buildBlockingSurfaces() {
    const surfaces = [];
    const movingPlatforms = this.runtime?.movingObjects?.filter((item) => item.objectKind === "platform") || [];
    const fragilePlatforms = this.runtime?.fragilePlatforms?.filter((item) => item.phase !== "gone") || [];
    const closedGates = this.runtime?.gates?.filter((item) => !item.open) || [];
    for (const platform of [...this.level.platforms, ...movingPlatforms, ...fragilePlatforms, ...closedGates]) {
      surfaces.push(
        { id: `${platform.id}:top`, kind: "platform", grapple: platform.grapple !== false, ax: platform.x, ay: platform.y, bx: platform.x + platform.w, by: platform.y },
        { id: `${platform.id}:right`, kind: "platform", grapple: platform.grapple !== false, ax: platform.x + platform.w, ay: platform.y, bx: platform.x + platform.w, by: platform.y + platform.h },
        { id: `${platform.id}:bottom`, kind: "platform", grapple: platform.grapple !== false, ax: platform.x + platform.w, ay: platform.y + platform.h, bx: platform.x, by: platform.y + platform.h },
        { id: `${platform.id}:left`, kind: "platform", grapple: platform.grapple !== false, ax: platform.x, ay: platform.y + platform.h, bx: platform.x, by: platform.y }
      );
    }
    for (const slope of this.level.slopes || []) {
      surfaces.push({ ...slope, kind: "slope", grapple: Boolean(slope.grapple) });
    }
    for (const wall of this.level.boundaryWalls || []) surfaces.push(...boundaryWallSegments(wall));
    return surfaces;
  }

  buildHazardAttachmentSurfaces() {
    const movingHazards = this.runtime?.movingObjects?.filter((item) => item.objectKind === "hazard") || [];
    return [...this.level.hazards, ...movingHazards].map(hazardHardBarSurface);
  }

  resolveCollisions() {
    const player = this.player;
    const gravity = this.gravityDirection();
    const tangent = this.screenRightDirection();
    player.grounded = false;
    player.wallNormal = null;

    for (let pass = 0; pass < 3; pass += 1) {
      let resolvedAny = false;
      const movingPlatforms = this.runtime.movingObjects.filter((item) => item.objectKind === "platform");
      const fragilePlatforms = this.runtime.fragilePlatforms.filter((item) => item.phase !== "gone");
      const closedGates = this.runtime.gates.filter((item) => !item.open);
      for (const wall of this.level.boundaryWalls || []) {
        this.debugStats.collisionCandidates += 1;
        const contact = resolvePlayerAgainstBoundaryWall(this.player, wall);
        if (!contact) continue;
        Object.assign(this.player, {
          x: contact.x,
          y: contact.y,
          vx: contact.vx,
          vy: contact.vy
        });
        resolvedAny = true;
      }
      for (const platform of [...this.level.platforms, ...movingPlatforms, ...fragilePlatforms, ...closedGates]) {
        this.debugStats.collisionCandidates += 1;
        let contact = this.resolveCircleRect(platform);
        if (!contact && platform.objectKind === "platform") {
          const swept = resolvePlayerAgainstMovingRect(this.player, platform);
          if (swept) {
            this.player.x = swept.x;
            this.player.y = swept.y;
            this.player.vx = swept.vx;
            this.player.vy = swept.vy;
            contact = swept.normal;
          }
        }
        if (!contact) continue;
        resolvedAny = true;
        this.recordContact(contact, gravity, tangent);
      }
      for (const slope of this.level.slopes || []) {
        this.debugStats.collisionCandidates += 1;
        const contact = this.resolveCircleSegment(slope);
        if (!contact) continue;
        resolvedAny = true;
        this.recordContact(contact, gravity, tangent);
      }
      const movingHazards = this.runtime.movingObjects.filter((item) => item.objectKind === "hazard");
      for (const hazard of [...this.level.hazards, ...movingHazards]) {
        this.debugStats.collisionCandidates += 1;
        const contact = this.resolveHazardBase(hazard);
        if (!contact) continue;
        resolvedAny = true;
        this.recordContact(contact, gravity, tangent);
      }
      if (!resolvedAny) break;
    }
  }

  recordContact(normal, gravity, tangent) {
    const groundAlignment = dot(normal.x, normal.y, -gravity.x, -gravity.y);
    if (groundAlignment > 0.56) this.player.grounded = true;
    const wallAlignment = Math.abs(dot(normal.x, normal.y, tangent.x, tangent.y));
    if (wallAlignment > 0.66 && groundAlignment < 0.55) this.player.wallNormal = normal;
  }

  resolveCircleRect(rect) {
    const player = this.player;
    const closestX = clamp(player.x, rect.x, rect.x + rect.w);
    const closestY = clamp(player.y, rect.y, rect.y + rect.h);
    let dx = player.x - closestX;
    let dy = player.y - closestY;
    let distance = length(dx, dy);
    let normal;
    let penetration;

    if (distance >= player.radius) return null;
    if (distance > 0.00001) {
      normal = { x: dx / distance, y: dy / distance };
      penetration = player.radius - distance;
    } else {
      const edges = [
        { distance: player.x - rect.x, normal: { x: -1, y: 0 } },
        { distance: rect.x + rect.w - player.x, normal: { x: 1, y: 0 } },
        { distance: player.y - rect.y, normal: { x: 0, y: -1 } },
        { distance: rect.y + rect.h - player.y, normal: { x: 0, y: 1 } }
      ].sort((left, right) => left.distance - right.distance);
      normal = edges[0].normal;
      penetration = player.radius + edges[0].distance;
    }

    player.x += normal.x * penetration;
    player.y += normal.y * penetration;
    const intoSurface = dot(player.vx, player.vy, normal.x, normal.y);
    if (intoSurface < 0) {
      player.vx -= normal.x * intoSurface;
      player.vy -= normal.y * intoSurface;
    }
    return normal;
  }

  resolveCircleSegment(segment) {
    const player = this.player;
    const closest = closestPointOnSegment(player.x, player.y, segment.ax, segment.ay, segment.bx, segment.by);
    const dx = player.x - closest.x;
    const dy = player.y - closest.y;
    const distance = length(dx, dy);
    const collisionRadius = player.radius + (segment.thickness ?? TUNING.hardBarThickness) * 0.5;
    if (distance >= collisionRadius) return null;
    const gravity = this.gravityDirection();
    const normal = normalize(dx, dy, -gravity.x, -gravity.y);
    const penetration = collisionRadius - distance;
    player.x += normal.x * penetration;
    player.y += normal.y * penetration;
    const intoSurface = dot(player.vx, player.vy, normal.x, normal.y);
    if (intoSurface < 0) {
      player.vx -= normal.x * intoSurface;
      player.vy -= normal.y * intoSurface;
    }
    return normal;
  }

  resolveHazardBase(hazard) {
    const player = this.player;
    const base = hazardBaseSegment(hazard);
    const collision = resolveHazardBaseCollision(
      {
        x: player.x,
        y: player.y,
        previousX: player.previousX,
        previousY: player.previousY,
        vx: player.vx,
        vy: player.vy
      },
      base,
      player.radius
    );
    if (!collision) return null;
    player.x = collision.x;
    player.y = collision.y;
    player.vx = collision.vx;
    player.vy = collision.vy;
    return collision.normal;
  }

  updateInteractions() {
    const player = this.player;
    const movingHazards = this.runtime.movingObjects.filter((item) => item.objectKind === "hazard");
    for (const hazard of [...this.level.hazards, ...movingHazards]) {
      if (circleIntersectsRect(player.x, player.y, player.radius, hazard) || (hazard.objectKind === "hazard" && movingRectSweepContact(player, hazard))) {
        this.damagePlayer(hazard.damage, hazard);
      }
    }
    for (const liquid of this.level.liquidZones || []) {
      if (liquid.contactDamage <= 0 || !circleIntersectsRect(player.x, player.y, player.radius, liquid)) continue;
      this.damagePlayer(liquid.contactDamage, liquid);
    }

    for (const orb of this.runtime.energyOrbs) {
      if (!orb.available || length(player.x - orb.x, player.y - orb.y) > player.radius + 16) continue;
      orb.available = false;
      orb.respawnTimer = 7;
      player.energy = restoreResource(player.energy, orb.amount, TUNING.maximumEnergy);
      this.particles.burst(orb.x, orb.y, "#63bfff", 14, 145);
    }

    for (let index = 0; index < this.runtime.dashRefills.length; index += 1) {
      const refill = this.runtime.dashRefills[index];
      const touching = length(player.x - refill.x, player.y - refill.y) <= player.radius + refill.radius;
      if (!touching) {
        this.runtime.dashRefills[index] = leaveDashRefill(refill);
        continue;
      }
      const result = tryCollectDashRefill(refill, {
        dashCharges: player.dashCharges,
        maximumDashCharges: player.maximumDashCharges
      });
      this.runtime.dashRefills[index] = result.state;
      if (!result.collected) continue;
      player.dashCharges = result.dashCharges;
      player.dashAvailable = player.dashCharges > 0;
      this.showToast(`冲刺已恢复 · ${player.dashCharges}/${player.maximumDashCharges}`, 1.0, "ability");
      this.particles.burst(refill.x, refill.y, "#9be7ff", 24, 210);
    }

    for (let index = 0; index < this.runtime.launchers.length; index += 1) {
      const launcher = this.runtime.launchers[index];
      const touching = circleIntersectsRect(player.x, player.y, player.radius, launcher);
      const result = tryActivateLauncher(launcher, touching, { vx: player.vx, vy: player.vy });
      this.runtime.launchers[index] = result.state;
      if (!result.activated) continue;
      player.vx = result.velocity.vx;
      player.vy = result.velocity.vy;
      player.grounded = false;
      this.particles.burst(launcher.x + launcher.w / 2, launcher.y + launcher.h / 2, "#ffc36f", 22, 240);
    }

    for (let index = 0; index < this.runtime.fragilePlatforms.length; index += 1) {
      const fragile = this.runtime.fragilePlatforms[index];
      if (fragile.phase === "gone" || !circleIntersectsRect(player.x, player.y, player.radius + 3, fragile)) continue;
      this.runtime.fragilePlatforms[index] = touchFragilePlatform(fragile);
    }

    for (let index = 0; index < this.runtime.stateTriggers.length; index += 1) {
      const trigger = this.runtime.stateTriggers[index];
      const touching = circleIntersectsRect(player.x, player.y, player.radius, trigger);
      const result = activateStateTrigger(trigger, touching, this.runtime.flags);
      this.runtime.stateTriggers[index] = result.state;
      if (result.changed) {
        this.runtime.gates = this.runtime.gates.map((gate) => evaluateGateState(gate, this.abilities, this.runtime.flags));
        this.showToast("世界状态已更新", 1.1, "ability");
        this.particles.burst(trigger.x + trigger.w / 2, trigger.y + trigger.h / 2, "#c5a6ff", 18, 180);
      }
    }

    for (const pickup of this.runtime.abilityPickups) {
      if (pickup.collected || length(player.x - pickup.x, player.y - pickup.y) > player.radius + 24) continue;
      pickup.collected = true;
      const result = grantAbility(this.abilities, pickup.abilityId, KNOWN_ABILITY_IDS);
      if (result.granted) {
        player.airJumps = pickup.abilityId === "doubleJump" ? 1 : player.airJumps;
        if (pickup.abilityId === "dash") {
          player.maximumDashCharges = this.level.dashCapacity ?? 1;
          player.dashCharges = player.maximumDashCharges;
          player.dashAvailable = true;
        }
        this.runtime.gates = this.runtime.gates.map((gate) => evaluateGateState(gate, this.abilities, this.runtime.flags));
        this.showToast(`获得能力：${ABILITIES[pickup.abilityId].name}`, 3, "ability");
        this.particles.burst(pickup.x, pickup.y, "#d5a4ff", 34, 240);
      }
    }

    for (const checkpoint of this.level.checkpoints) {
      if (!circleIntersectsRect(player.x, player.y, player.radius, checkpoint)) continue;
      if (this.currentCheckpoint.id !== checkpoint.id) {
        this.currentCheckpoint = checkpoint;
        player.health = TUNING.maximumHealth;
        player.energy = TUNING.maximumEnergy;
        this.showToast("安全点已记录 · 血蓝恢复", 2.2);
        this.particles.burst(checkpoint.x + checkpoint.w / 2, checkpoint.y + checkpoint.h / 2, "#74fff3", 22, 170);
      }
    }

    for (const trigger of this.runtime.rotationTriggers) {
      if (trigger.activated || !circleIntersectsRect(player.x, player.y, player.radius, trigger)) continue;
      trigger.activated = true;
      this.startRotation(trigger.delta, "空间正在重构");
    }

    if (!this.runtime.transitioning && this.runtime.exitCooldown <= 0) {
      for (const exit of this.level.roomExits || []) {
        if (!circleIntersectsRect(player.x, player.y, player.radius, exit)) continue;
        if (exit.requiredAbility && !this.abilities.has(exit.requiredAbility)) {
          this.runtime.exitCooldown = 0.8;
          this.showToast(`出口需要能力：${exit.requiredAbility}`, 1.2, "warning");
          break;
        }
        this.runtime.transitioning = true;
        if (!this.onRoomExit) {
          this.runtime.transitioning = false;
          this.runtime.exitCooldown = 0.8;
          this.showToast("目标房间加载器尚未连接", 1.2, "warning");
          break;
        }
        Promise.resolve(this.onRoomExit(exit, this.level, this))
          .catch((error) => {
            console.error(error);
            this.runtime.transitioning = false;
            this.runtime.exitCooldown = 0.8;
            this.showToast("房间切换失败，请检查本地数据", 1.6, "warning");
          });
        break;
      }
    }

    if (this.level.goal && !this.runtime.goalReached && isGoalReached(player, this.level.goal, TUNING.goalActivationPadding)) {
      this.runtime.goalReached = true;
      this.showToast(`完成：${levelDisplayName(this.level)} · Esc选择其他关卡`, 5, "ability");
      this.particles.burst(this.level.goal.x, this.level.goal.y, "#fff0a4", 46, 280);
    }
  }

  damagePlayer(amount, source) {
    const result = takeDamage(this.player.health, amount, this.player.invulnerability);
    if (!result.applied) return;
    this.player.health = result.health;
    this.player.invulnerability = TUNING.damageInvulnerability;
    this.player.damageRecoveryTimer = TUNING.damageRecoveryWindow;
    this.player.damageRecoveryJump = true;
    const gravity = this.gravityDirection();
    const tangent = this.screenRightDirection();
    const away = normalize(
      this.player.x - (source.x + source.w / 2),
      this.player.y - (source.y + source.h / 2),
      0,
      -1
    );
    const recoveryVelocity = computeDamageRecoveryVelocity(
      { vx: this.player.vx, vy: this.player.vy },
      gravity,
      tangent,
      away,
      { liftSpeed: TUNING.damageLiftSpeed, awaySpeed: TUNING.damageAwaySpeed }
    );
    this.player.vx = recoveryVelocity.vx;
    this.player.vy = recoveryVelocity.vy;
    this.particles.burst(this.player.x, this.player.y, "#ff6f8e", 20, 210);
    this.showToast(`受伤 －${amount} 血 · 按 Space 脱离`, 1.25, "warning");
    if (result.defeated) this.beginRespawn("生命耗尽");
  }

  updateRuntimeItems(deltaTime) {
    this.runtime.exitCooldown = Math.max(0, this.runtime.exitCooldown - deltaTime);
    for (const orb of this.runtime.energyOrbs) {
      if (orb.available) continue;
      orb.respawnTimer -= deltaTime;
      if (orb.respawnTimer <= 0) orb.available = true;
    }
    this.runtime.dashRefills = this.runtime.dashRefills.map((refill) => updateDashRefillState(refill, deltaTime));
    this.runtime.launchers = this.runtime.launchers.map((launcher) => updateLauncherState(launcher, deltaTime));
    this.runtime.fragilePlatforms = this.runtime.fragilePlatforms.map((fragile) => updateFragilePlatformState(fragile, deltaTime));
    this.runtime.gates = this.runtime.gates.map((gate) => evaluateGateState(gate, this.abilities, this.runtime.flags));
    for (const target of this.runtime.bashTargets) {
      target.cooldown = Math.max(0, target.cooldown - deltaTime);
    }
    for (let index = 0; index < this.runtime.movingObjects.length; index += 1) {
      const item = this.runtime.movingObjects[index];
      const pointLike = ["anchor", "bashTarget"].includes(item.objectKind);
      const touching = pointLike
        ? length(this.player.x - item.x, this.player.y - item.y) <= this.player.radius + 28
        : circleIntersectsRect(this.player.x, this.player.y, this.player.radius, item);
      const carryingPlayer = isPlayerStandingOnMovingPlatform(this.player, item);
      const next = advanceMotionState(item, deltaTime, {
        triggered: item.trigger === "touch" ? touching : Boolean(item.switchActive),
        offscreen: this.isMovingObjectOffscreen(item)
      });
      next.cooldown = Math.max(0, (item.cooldown || 0) - deltaTime);
      next.type = next.anchorType;
      if (carryingPlayer) {
        this.player.x += next.deltaX;
        this.player.y += next.deltaY;
      }
      if (this.player.rope && (this.player.rope.anchorId === item.id || this.player.rope.anchorId.startsWith(`${item.id}:`))) {
        this.player.rope.x += next.deltaX;
        this.player.rope.y += next.deltaY;
      }
      if (this.runtime.hardBar
        && (this.runtime.hardBar.anchorId === item.id || this.runtime.hardBar.anchorId.startsWith(`${item.id}:`))) {
        this.runtime.hardBar.pivotX += next.deltaX;
        this.runtime.hardBar.pivotY += next.deltaY;
      }
      this.runtime.movingObjects[index] = next;
    }
    this.blockingSurfaces = this.buildBlockingSurfaces();
    this.grappleSurfaces = this.blockingSurfaces.filter((surface) => surface.grapple);
    this.hardBarSurfaces = [...this.grappleSurfaces, ...this.buildHazardAttachmentSurfaces()];
  }

  isMovingObjectOffscreen(item) {
    const centerX = item.x + (["platform", "hazard"].includes(item.objectKind) ? item.w / 2 : 0);
    const centerY = item.y + (["platform", "hazard"].includes(item.objectKind) ? item.h / 2 : 0);
    const screen = this.worldToScreen(centerX, centerY);
    const padding = Math.max(item.w || 0, item.h || 0, 120);
    return screen.x < -padding || screen.x > VIEWPORT.width + padding || screen.y < -padding || screen.y > VIEWPORT.height + padding;
  }

  beginRespawn(reason) {
    if (this.player.respawnTimer > 0) return;
    this.runtime.bashAim = null;
    this.player.respawnTimer = TUNING.respawnDelay;
    this.player.visible = false;
    this.detachRope(false);
    this.detachHardBar(false);
    this.showToast(reason, 1.2, "warning");
    this.particles.burst(this.player.x, this.player.y, "#f4fbff", 28, 230);
  }

  respawn() {
    const spawn = this.currentCheckpoint.spawn;
    Object.assign(this.player, {
      x: spawn.x,
      y: spawn.y,
      previousX: spawn.x,
      previousY: spawn.y,
      vx: 0,
      vy: 0,
      health: TUNING.maximumHealth,
      energy: TUNING.maximumEnergy,
      grounded: false,
      wallNormal: null,
      coyoteTimer: 0,
      jumpBufferTimer: 0,
      airJumps: this.abilities.has("doubleJump") ? 1 : 0,
      rope: null,
      invulnerability: 0.5,
      damageRecoveryTimer: 0,
      damageRecoveryJump: false,
      gliding: false,
      wind: null,
      liquid: null,
      updraftExitTimer: 0,
      maximumDashCharges: this.abilities.has("dash") ? (this.level.dashCapacity ?? 1) : 0,
      dashCharges: this.abilities.has("dash") ? (this.level.dashCapacity ?? 1) : 0,
      dashAvailable: this.abilities.has("dash"),
      dashTimer: 0,
      dashDirectionX: 0,
      dashDirectionY: 0,
      timeSinceEnergyUse: 99,
      respawnTimer: 0,
      visible: true
    });
    this.player.animation = createPlayerAnimation(this.player.facing);
    this.runtime.dashRefills = this.runtime.dashRefills.map((refill) => resetDashRefillState(refill, "death"));
    this.runtime.launchers = this.runtime.launchers.map((launcher) => ({ ...launcher, cooldownTimer: 0, touching: false }));
    this.runtime.fragilePlatforms = this.runtime.fragilePlatforms.map((fragile) => resetFragilePlatformState(fragile, "death"));
    this.runtime.gates = this.runtime.gates.map((gate) => evaluateGateState(resetGateState(gate, "death"), this.abilities, this.runtime.flags));
    this.runtime.stateTriggers = this.runtime.stateTriggers.map((trigger) => resetStateTrigger(trigger, "death"));
    this.runtime.movingObjects = this.runtime.movingObjects.map((item) => {
      if (item.resetPolicy !== "death") return item;
      const reset = resetMotionState(item);
      reset.cooldown = 0;
      reset.type = reset.anchorType;
      return reset;
    });
    this.blockingSurfaces = this.buildBlockingSurfaces();
    this.grappleSurfaces = this.blockingSurfaces.filter((surface) => surface.grapple);
    this.hardBarSurfaces = [...this.grappleSurfaces, ...this.buildHazardAttachmentSurfaces()];
    this.detachHardBar(false);
    this.camera.x = spawn.x;
    this.camera.y = spawn.y - 30;
  }

  startRotation(delta, message) {
    if (this.camera.rotation) return;
    this.camera.rotation = {
      from: this.camera.angle,
      to: this.camera.angle + delta,
      elapsed: 0,
      duration: TUNING.rotationDuration
    };
    this.showToast(`${message} · 重力保持屏幕向下`, TUNING.rotationDuration + 1.2, "ability");
  }

  updateRotation(deltaTime) {
    const rotationState = this.camera.rotation;
    if (!rotationState) return;
    rotationState.elapsed += deltaTime;
    const progress = clamp(rotationState.elapsed / rotationState.duration, 0, 1);
    this.camera.angle = lerp(rotationState.from, rotationState.to, easeInOutCubic(progress));
    if (progress >= 1) {
      this.camera.angle = rotationState.to;
      this.camera.rotation = null;
    }
  }

  updateCamera(deltaTime) {
    const player = this.player;
    const lookAhead = this.camera.rotation ? 0 : TUNING.cameraLookAhead;
    const desiredX = player.x + player.vx * lookAhead;
    const desiredY = player.y + player.vy * lookAhead * 0.45;
    const amount = 1 - Math.exp(-TUNING.cameraFollow * deltaTime);
    this.camera.x = lerp(this.camera.x, desiredX, amount);
    this.camera.y = lerp(this.camera.y, desiredY, amount);
  }

  worldToScreen(x, y) {
    const rotated = rotate(x - this.camera.x, y - this.camera.y, this.camera.angle);
    return { x: VIEWPORT.width / 2 + rotated.x, y: VIEWPORT.height / 2 + rotated.y };
  }

  screenToWorld(x, y) {
    const unrotated = inverseRotate(x - VIEWPORT.width / 2, y - VIEWPORT.height / 2, this.camera.angle);
    return { x: this.camera.x + unrotated.x, y: this.camera.y + unrotated.y };
  }

  showToast(text, time = 2, tone = "normal") {
    this.toast = { text, time, tone };
  }

  render() {
    const ctx = this.ctx;
    this.displayMetrics = syncCanvasBackingStore(canvas, ctx, VIEWPORT);
    this.visualRuntime.beginFrame();
    const sceneCamera = {
      x: this.camera.x,
      y: this.camera.y,
      width: VIEWPORT.width,
      height: VIEWPORT.height
    };
    this.renderBackground(ctx);
    this.visualRuntime.renderScenePass(ctx, this.level.scene, "background", sceneCamera);
    this.visualRuntime.renderScenePass(ctx, this.level.scene, "midground", sceneCamera);
    this.visualRuntime.renderScenePass(ctx, this.level.scene, "player", sceneCamera);
    this.renderInWorld(ctx, () => this.renderWorld(ctx));
    this.renderPlayer(ctx);
    this.visualRuntime.renderScenePass(ctx, this.level.scene, "foreground", sceneCamera);
    this.renderInWorld(ctx, () => this.renderGameplayCues(ctx));
    this.renderBashAimOverlay(ctx);
    this.renderHud(ctx);
    if (this.paused) this.renderPause(ctx);
  }

  renderInWorld(ctx, renderer) {
    ctx.save();
    ctx.translate(VIEWPORT.width / 2, VIEWPORT.height / 2);
    ctx.rotate(this.camera.angle);
    ctx.translate(-this.camera.x, -this.camera.y);
    renderer();
    ctx.restore();
  }

  renderBackground(ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, VIEWPORT.height);
    gradient.addColorStop(0, "#071a25");
    gradient.addColorStop(0.58, "#08202a");
    gradient.addColorStop(1, "#041017");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, VIEWPORT.width, VIEWPORT.height);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let index = 0; index < 36; index += 1) {
      const x = (index * 193 + Math.sin(index * 8.1) * 80 - this.camera.x * 0.035) % (VIEWPORT.width + 100);
      const y = (index * 97 + Math.cos(index * 4.7) * 60 - this.camera.y * 0.025) % (VIEWPORT.height + 80);
      const pulse = 0.35 + Math.sin(this.elapsed * 1.2 + index) * 0.16;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = index % 3 === 0 ? "#6ef5e9" : "#2b8d9d";
      ctx.beginPath();
      ctx.arc((x + VIEWPORT.width + 100) % (VIEWPORT.width + 100), (y + VIEWPORT.height + 80) % (VIEWPORT.height + 80), 1.2 + index % 3, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  renderWorld(ctx) {
    const commands = [];
    let defaultOrder = 0;
    const visibleInViewport = (type, item, visual) => {
      if (type === "boundaryWall" && visual.assetId === BUILTIN_PROCEDURAL_ASSET_ID) return false;
      return isObjectVisualVisible(item, type, visual, {
        x: this.camera.x,
        y: this.camera.y,
        angle: this.camera.angle,
        width: VIEWPORT.width,
        height: VIEWPORT.height
      });
    };
    const append = (type, items, fallback, visible = () => true) => {
      const order = defaultOrder++;
      (items || []).forEach((item, index) => {
        if (!visible(item, index)) return;
        const visual = this.runtimeVisualForObject(type, item, index);
        if (!visibleInViewport(type, item, visual)) return;
        commands.push({
          type,
          item,
          visual,
          drawLayer: visual.drawLayer,
          defaultOrder: order,
          fallback: typeof fallback === "function" ? () => fallback(item, index) : null,
          overlay: () => this.renderAssetSemanticCue(ctx, type, item)
        });
      });
    };

    append("backgroundSeed", this.level.backgroundSeeds, (seed) => this.renderBackgroundSeed(ctx, seed));
    append("spawn", this.level.spawn ? [this.level.spawn] : [], null);
    append("windZone", this.level.windZones, (wind) => this.renderWindZone(ctx, wind));
    append("liquidZone", this.level.liquidZones, (liquid) => this.renderLiquidZone(ctx, liquid));
    append("boundaryWall", this.level.boundaryWalls, null);
    append("platform", this.level.platforms, (platform) => this.renderPlatform(ctx, platform));
    append("movingObject", this.runtime.movingObjects, (item) => this.renderMovingObject(ctx, item), (item) => item.objectKind === "platform");
    append(
      "fragilePlatform",
      this.runtime.fragilePlatforms,
      (fragile) => this.renderFragilePlatform(ctx, fragile),
      (fragile) => fragile.phase !== "gone" || fragile.offsetY <= 520
    );
    append("gate", this.runtime.gates, (gate) => this.renderGate(ctx, gate));
    append("slope", this.level.slopes, (slope) => this.renderSlope(ctx, slope));
    append("hazard", this.level.hazards, (hazard) => this.renderHazard(ctx, hazard));
    append("movingObject", this.runtime.movingObjects, (item) => this.renderMovingObject(ctx, item), (item) => item.objectKind === "hazard");
    append("checkpoint", this.level.checkpoints, (checkpoint) => this.renderCheckpoint(ctx, checkpoint));
    append("roomEntrance", this.level.roomEntrances, this.debug ? (entrance) => this.renderRoomEntrance(ctx, entrance) : null);
    append("roomExit", this.level.roomExits, (exit) => this.renderRoomExit(ctx, exit));
    append("sign", this.level.signs, (sign) => this.renderSign(ctx, sign));
    append("energyOrb", this.runtime.energyOrbs, (orb) => this.renderEnergyOrb(ctx, orb), (orb) => orb.available);
    append("dashRefill", this.runtime.dashRefills, (refill) => this.renderDashRefill(ctx, refill));
    append("launcher", this.runtime.launchers, (launcher) => this.renderLauncher(ctx, launcher));
    append("stateTrigger", this.runtime.stateTriggers, (trigger) => this.renderStateTrigger(ctx, trigger));
    append("abilityPickup", this.runtime.abilityPickups, (pickup) => this.renderAbilityPickup(ctx, pickup), (pickup) => !pickup.collected);
    append("bashTarget", this.runtime.bashTargets, (target) => this.renderBashTarget(ctx, target));
    append("movingObject", this.runtime.movingObjects, (item) => this.renderMovingObject(ctx, item), (item) => item.objectKind === "bashTarget");
    append("goal", this.level.goal ? [this.level.goal] : [], () => this.renderGoal(ctx));
    append("anchor", this.level.anchors, (anchor) => this.renderAnchor(ctx, anchor));
    append("movingObject", this.runtime.movingObjects, (item) => this.renderMovingObject(ctx, item), (item) => item.objectKind === "anchor");
    append("rotationTrigger", this.runtime.rotationTriggers, null);
    append("darknessZone", this.level.darknessZones, null);

    const renderQueue = stableSortRenderQueue(commands);
    this.debugStats.renderedObjects = renderQueue.length;
    this.visualRuntime.frameStats.cullCount += Math.max(0, this.debugStats.activeObjects - renderQueue.length);
    for (const command of renderQueue) this.visualRuntime.renderObject(ctx, command);
    // Darkness affects gameplay readability, so its semantic mask remains even when a decorative image is assigned.
    for (const darkness of this.level.darknessZones || []) this.renderDarknessZone(ctx, darkness);
    this.particles.render(ctx);

    if (this.debug) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
      ctx.lineWidth = 1;
      ctx.strokeRect(this.level.bounds.x, this.level.bounds.y, this.level.bounds.w, this.level.bounds.h);
      ctx.save();
      ctx.strokeStyle = "rgba(255, 132, 224, 0.82)";
      ctx.fillStyle = "rgba(255, 132, 224, 0.08)";
      ctx.lineWidth = 2;
      ctx.setLineDash([12, 8]);
      for (const wall of this.level.boundaryWalls || []) {
        ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
        ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);
      }
      ctx.restore();
    }
  }

  visualForObject(type, item, index) {
    const objectId = item?.id || this.level.visualOrder?.[type]?.[index];
    return this.level.visuals?.[objectId] || DEFAULT_VISUAL_CONFIG;
  }

  runtimeVisualForObject(type, item, index) {
    const visual = this.visualForObject(type, item, index);
    const semanticType = type === "movingObject" ? item?.objectKind : type;
    let opacityScale = 1;
    if (semanticType === "goal" && this.runtime.goalReached) opacityScale = 0.35;
    else if (semanticType === "checkpoint") opacityScale = item?.id === this.currentCheckpoint?.id ? 0.95 : 0.32;
    else if (semanticType === "dashRefill" && !item?.available) opacityScale = 0.16;
    else if (semanticType === "bashTarget" && item?.cooldown > 0) opacityScale = 0.2;
    else if (semanticType === "gate" && item?.open) opacityScale = 0.2;
    else if (semanticType === "fragilePlatform" && item?.phase === "gone") opacityScale = 0.42;
    else if (semanticType === "stateTrigger" && item?.used) opacityScale = 0.35;
    else if (semanticType === "launcher" && item?.cooldownTimer > 0) opacityScale = 0.72;
    return opacityScale === 1 ? visual : { ...visual, opacity: clamp(visual.opacity * opacityScale, 0, 1) };
  }

  renderAssetSemanticCue(ctx, type, item) {
    const semanticType = type === "movingObject" ? item?.objectKind : type;
    const offsetY = semanticType === "fragilePlatform" ? item.offsetY || 0 : 0;
    ctx.save();
    ctx.translate(0, offsetY);
    if (semanticType === "hazard") {
      const base = hazardBaseSegment(item);
      ctx.strokeStyle = "rgba(255, 105, 131, 0.88)";
      ctx.lineWidth = 3;
      ctx.strokeRect(item.x, item.y, item.w, item.h);
      ctx.strokeStyle = "rgba(92, 22, 48, 0.92)";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(base.ax, base.ay);
      ctx.lineTo(base.bx, base.by);
      ctx.stroke();
    } else if (semanticType === "slope") {
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(137, 250, 238, 0.72)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(item.ax, item.ay);
      ctx.lineTo(item.bx, item.by);
      ctx.stroke();
    } else if (semanticType === "checkpoint" && item.id === this.currentCheckpoint?.id) {
      ctx.strokeStyle = "rgba(154, 255, 239, 0.9)";
      ctx.lineWidth = 3;
      ctx.shadowColor = "#74fff3";
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(item.x + item.w / 2, item.y + item.h / 2, 24, 0, TAU);
      ctx.stroke();
    } else if (semanticType === "goal") {
      ctx.strokeStyle = this.runtime.goalReached ? "rgba(255, 233, 154, 0.35)" : "rgba(255, 233, 154, 0.9)";
      ctx.lineWidth = 3;
      ctx.setLineDash([7, 9]);
      ctx.beginPath();
      ctx.arc(item.x, item.y, item.radius + TUNING.goalActivationPadding, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (semanticType === "anchor") {
      const selected = this.ropeTarget?.kind === "anchor" && this.ropeTarget.id === item.id;
      if (selected) {
        ctx.strokeStyle = "#e6fffb";
        ctx.lineWidth = 4;
        ctx.shadowColor = "#70fff2";
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(item.x, item.y, 20, 0, TAU);
        ctx.stroke();
      }
    } else if (semanticType === "bashTarget") {
      const activeAim = this.runtime.bashAim;
      const selected = activeAim?.target.id === item.id || (!activeAim && this.bashTarget?.id === item.id);
      if (selected) {
        ctx.strokeStyle = "#f3dcff";
        ctx.lineWidth = 4;
        ctx.shadowColor = "#cc86ff";
        ctx.shadowBlur = 22;
        ctx.beginPath();
        ctx.arc(item.x, item.y, 28, 0, TAU);
        ctx.stroke();
      }
    } else if (semanticType === "dashRefill") {
      ctx.strokeStyle = item.available ? "rgba(185, 239, 255, 0.92)" : "rgba(121, 170, 184, 0.38)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(item.x, item.y, item.radius + 4, 0, TAU);
      ctx.stroke();
      if (item.available) {
        ctx.fillStyle = "#e2f9ff";
        ctx.font = "700 11px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(item.charges), item.x, item.y + 1);
      }
    } else if (semanticType === "gate") {
      ctx.globalAlpha = item.open ? 0.4 : 0.92;
      ctx.strokeStyle = item.open ? "rgba(216, 181, 255, 0.62)" : "#d8aeff";
      ctx.lineWidth = item.open ? 2 : 4;
      ctx.setLineDash(item.open ? [12, 12] : []);
      ctx.strokeRect(item.x, item.y, item.w, item.h);
      ctx.setLineDash([]);
    } else if (semanticType === "fragilePlatform" && item.phase === "cracking") {
      ctx.strokeStyle = "rgba(255, 224, 154, 0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      const shardWidth = Math.max(30, item.w / 5);
      for (let x = item.x + shardWidth; x < item.x + item.w; x += shardWidth) {
        ctx.moveTo(x, item.y);
        ctx.lineTo(x - 12, item.y + item.h);
      }
      ctx.stroke();
    } else if (semanticType === "launcher") {
      const direction = normalize(item.launchX, item.launchY, 0, -1);
      const centerX = item.x + item.w / 2;
      const centerY = item.y + item.h / 2;
      ctx.strokeStyle = item.cooldownTimer > 0 ? "rgba(255, 205, 145, 0.42)" : "#ffd293";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(centerX - direction.x * 8, centerY - direction.y * 8);
      ctx.lineTo(centerX + direction.x * 26, centerY + direction.y * 26);
      ctx.stroke();
    } else if (semanticType === "roomExit") {
      const direction = {
        left: { x: -1, y: 0 },
        right: { x: 1, y: 0 },
        up: { x: 0, y: -1 },
        down: { x: 0, y: 1 }
      }[item.direction] || { x: 1, y: 0 };
      const centerX = item.x + item.w / 2;
      const centerY = item.y + item.h / 2;
      const locked = Boolean(item.requiredAbility && !this.abilities.has(item.requiredAbility));
      ctx.strokeStyle = locked ? "rgba(255, 119, 143, 0.88)" : "rgba(255, 223, 137, 0.88)";
      ctx.fillStyle = locked ? "#ff8da4" : "#ffe49a";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(centerX - direction.x * 18, centerY - direction.y * 18);
      ctx.lineTo(centerX + direction.x * 18, centerY + direction.y * 18);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(centerX + direction.x * 22, centerY + direction.y * 22);
      ctx.lineTo(centerX + direction.x * 8 - direction.y * 8, centerY + direction.y * 8 + direction.x * 8);
      ctx.lineTo(centerX + direction.x * 8 + direction.y * 8, centerY + direction.y * 8 - direction.x * 8);
      ctx.closePath();
      ctx.fill();
      if (locked) {
        ctx.setLineDash([8, 7]);
        ctx.strokeRect(item.x, item.y, item.w, item.h);
        ctx.setLineDash([]);
      }
    } else if (semanticType === "windZone") {
      const direction = normalize(item.forceX, item.forceY, 0, -1);
      const centerX = item.x + item.w / 2;
      const centerY = item.y + item.h / 2;
      const active = this.player.wind?.ids.includes(item.id);
      ctx.strokeStyle = active ? "rgba(157, 236, 255, 0.88)" : "rgba(128, 222, 255, 0.62)";
      ctx.lineWidth = active ? 4 : 3;
      ctx.beginPath();
      ctx.moveTo(centerX - direction.x * 26, centerY - direction.y * 26);
      ctx.lineTo(centerX + direction.x * 30, centerY + direction.y * 30);
      ctx.stroke();
      if (active) ctx.strokeRect(item.x, item.y, item.w, item.h);
    } else if (semanticType === "liquidZone" && this.player.liquid?.id === item.id) {
      ctx.strokeStyle = "rgba(133, 216, 255, 0.82)";
      ctx.lineWidth = 4;
      ctx.strokeRect(item.x, item.y, item.w, item.h);
    } else if (semanticType === "sign" && item.text) {
      ctx.font = "650 13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(4, 16, 23, 0.86)";
      ctx.fillStyle = "rgba(231, 255, 252, 0.94)";
      ctx.strokeText(item.text, item.x, item.y);
      ctx.fillText(item.text, item.x, item.y);
    }
    ctx.restore();
  }

  renderGameplayCues(ctx) {
    this.renderHardBar(ctx);
    this.renderRope(ctx);
    this.renderSurfaceTarget(ctx);
    this.renderHardBarTarget(ctx);
  }

  renderBackgroundSeed(ctx, seed) {
    const pulse = 1 + Math.sin(this.elapsed * 0.3 + seed.x * 0.01) * 0.04;
    ctx.save();
    ctx.translate(seed.x, seed.y);
    ctx.scale(pulse, pulse);
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#1e8290";
    ctx.beginPath();
    ctx.arc(0, 0, seed.size, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.13;
    ctx.strokeStyle = "#83fff4";
    ctx.lineWidth = 2;
    for (let ring = 0.42; ring <= 0.9; ring += 0.18) {
      ctx.beginPath();
      ctx.arc(0, 0, seed.size * ring, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  renderWindZone(ctx, wind) {
    const active = this.player.wind?.ids.includes(wind.id);
    ctx.save();
    ctx.fillStyle = active ? "rgba(91, 207, 255, 0.16)" : "rgba(91, 188, 255, 0.07)";
    ctx.strokeStyle = active ? "rgba(157, 236, 255, 0.72)" : "rgba(116, 215, 255, 0.28)";
    ctx.lineWidth = active ? 4 : 2;
    ctx.shadowColor = "#63cfff";
    ctx.shadowBlur = active ? 24 : 0;
    ctx.setLineDash([10, 16]);
    ctx.fillRect(wind.x, wind.y, wind.w, wind.h);
    ctx.strokeRect(wind.x, wind.y, wind.w, wind.h);
    ctx.setLineDash([]);
    const direction = normalize(wind.forceX, wind.forceY, 0, -1);
    for (let x = wind.x + 34; x < wind.x + wind.w; x += 64) {
      for (let y = wind.y + 40; y < wind.y + wind.h; y += 82) {
        const pulse = (this.elapsed * 90 + x + y) % 24;
        const cx = x + direction.x * pulse;
        const cy = y + direction.y * pulse;
        ctx.strokeStyle = active ? "rgba(190, 244, 255, 0.82)" : "rgba(128, 222, 255, 0.4)";
        ctx.lineWidth = active ? 3 : 1.5;
        ctx.beginPath();
        ctx.moveTo(cx - direction.x * 12, cy - direction.y * 12);
        ctx.lineTo(cx + direction.x * 12, cy + direction.y * 12);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  renderLiquidZone(ctx, liquid) {
    const palette = liquid.liquidType === "lava"
      ? { fill: "rgba(255, 93, 55, 0.24)", stroke: "rgba(255, 175, 91, 0.72)", line: "#ff9b58" }
      : liquid.liquidType === "toxic"
        ? { fill: "rgba(104, 210, 114, 0.2)", stroke: "rgba(169, 255, 157, 0.62)", line: "#8be995" }
        : { fill: "rgba(68, 145, 205, 0.18)", stroke: "rgba(133, 216, 255, 0.52)", line: "#84d6ff" };
    ctx.save();
    ctx.fillStyle = palette.fill;
    ctx.strokeStyle = palette.stroke;
    ctx.lineWidth = this.player.liquid?.id === liquid.id ? 4 : 2;
    ctx.fillRect(liquid.x, liquid.y, liquid.w, liquid.h);
    ctx.beginPath();
    const waveStep = 48;
    ctx.moveTo(liquid.x, liquid.y);
    for (let x = liquid.x; x <= liquid.x + liquid.w; x += waveStep) {
      ctx.quadraticCurveTo(x + waveStep * 0.25, liquid.y - 7, x + waveStep * 0.5, liquid.y);
      ctx.quadraticCurveTo(x + waveStep * 0.75, liquid.y + 7, x + waveStep, liquid.y);
    }
    ctx.strokeStyle = palette.line;
    ctx.stroke();
    ctx.strokeStyle = palette.stroke;
    ctx.strokeRect(liquid.x, liquid.y, liquid.w, liquid.h);
    ctx.restore();
  }

  renderDarknessZone(ctx, darkness) {
    if (darkness.clearedByFlag && this.runtime.flags.has(darkness.clearedByFlag)) return;
    const inside = circleIntersectsRect(this.player.x, this.player.y, this.player.radius, darkness);
    ctx.save();
    ctx.beginPath();
    ctx.rect(darkness.x, darkness.y, darkness.w, darkness.h);
    ctx.clip();
    if (inside) {
      const gradient = ctx.createRadialGradient(
        this.player.x,
        this.player.y,
        darkness.revealRadius * 0.35,
        this.player.x,
        this.player.y,
        darkness.revealRadius
      );
      gradient.addColorStop(0, "rgba(1, 4, 12, 0)");
      gradient.addColorStop(0.72, `rgba(1, 4, 12, ${darkness.opacity * 0.45})`);
      gradient.addColorStop(1, `rgba(1, 4, 12, ${darkness.opacity})`);
      ctx.fillStyle = gradient;
    } else {
      ctx.fillStyle = `rgba(1, 4, 12, ${darkness.opacity})`;
    }
    ctx.fillRect(darkness.x, darkness.y, darkness.w, darkness.h);
    ctx.restore();
  }

  renderPlatform(ctx, platform) {
    const gradient = ctx.createLinearGradient(platform.x, platform.y, platform.x, platform.y + Math.min(platform.h, 160));
    gradient.addColorStop(0, "#173c43");
    gradient.addColorStop(0.08, "#123138");
    gradient.addColorStop(1, "#081c25");
    ctx.fillStyle = gradient;
    ctx.fillRect(platform.x, platform.y, platform.w, platform.h);
    ctx.fillStyle = "rgba(121, 241, 224, 0.35)";
    ctx.fillRect(platform.x, platform.y, platform.w, 3);
    ctx.fillStyle = "rgba(100, 204, 194, 0.06)";
    for (let x = platform.x + 18; x < platform.x + platform.w; x += 52) {
      ctx.fillRect(x, platform.y + 14, 2, Math.max(0, platform.h - 22));
    }
  }

  renderFragilePlatform(ctx, platform) {
    if (platform.phase === "gone" && platform.offsetY > 520) return;
    ctx.save();
    ctx.translate(0, platform.offsetY || 0);
    ctx.globalAlpha = platform.phase === "gone" ? 0.42 : 1;
    ctx.fillStyle = platform.phase === "cracking" ? "#6f5230" : "#443825";
    ctx.fillRect(platform.x, platform.y, platform.w, platform.h);
    ctx.strokeStyle = platform.phase === "cracking" ? "#ffe09a" : "rgba(246, 204, 123, 0.72)";
    ctx.lineWidth = platform.phase === "cracking" ? 4 : 2;
    ctx.strokeRect(platform.x, platform.y, platform.w, platform.h);
    ctx.beginPath();
    const shardWidth = Math.max(30, platform.w / 5);
    for (let x = platform.x + shardWidth; x < platform.x + platform.w; x += shardWidth) {
      ctx.moveTo(x, platform.y);
      ctx.lineTo(x - 12, platform.y + platform.h);
    }
    ctx.stroke();
    ctx.restore();
  }

  renderGate(ctx, gate) {
    ctx.save();
    ctx.globalAlpha = gate.open ? 0.2 : 0.92;
    ctx.fillStyle = gate.open ? "rgba(187, 148, 255, 0.12)" : "rgba(92, 48, 122, 0.72)";
    ctx.strokeStyle = gate.open ? "rgba(216, 181, 255, 0.32)" : "#d8aeff";
    ctx.lineWidth = gate.open ? 2 : 4;
    ctx.setLineDash(gate.open ? [12, 12] : []);
    ctx.fillRect(gate.x, gate.y, gate.w, gate.h);
    ctx.strokeRect(gate.x, gate.y, gate.w, gate.h);
    ctx.setLineDash([]);
    if (!gate.open) {
      ctx.fillStyle = "rgba(245, 224, 255, 0.82)";
      for (let y = gate.y + 14; y < gate.y + gate.h; y += 32) ctx.fillRect(gate.x + 8, y, Math.max(4, gate.w - 16), 3);
    }
    ctx.restore();
  }

  renderLauncher(ctx, launcher) {
    const direction = normalize(launcher.launchX, launcher.launchY, 0, -1);
    const centerX = launcher.x + launcher.w / 2;
    const centerY = launcher.y + launcher.h / 2;
    ctx.save();
    ctx.fillStyle = launcher.cooldownTimer > 0 ? "rgba(131, 85, 45, 0.72)" : "rgba(224, 137, 60, 0.82)";
    ctx.strokeStyle = launcher.cooldownTimer > 0 ? "rgba(255, 205, 145, 0.42)" : "#ffd293";
    ctx.lineWidth = 3;
    ctx.fillRect(launcher.x, launcher.y, launcher.w, launcher.h);
    ctx.strokeRect(launcher.x, launcher.y, launcher.w, launcher.h);
    ctx.beginPath();
    ctx.moveTo(centerX - direction.x * 8, centerY - direction.y * 8);
    ctx.lineTo(centerX + direction.x * 26, centerY + direction.y * 26);
    ctx.lineTo(centerX + direction.x * 16 - direction.y * 8, centerY + direction.y * 16 + direction.x * 8);
    ctx.moveTo(centerX + direction.x * 26, centerY + direction.y * 26);
    ctx.lineTo(centerX + direction.x * 16 + direction.y * 8, centerY + direction.y * 16 - direction.x * 8);
    ctx.stroke();
    ctx.restore();
  }

  renderStateTrigger(ctx, trigger) {
    ctx.save();
    ctx.fillStyle = trigger.used ? "rgba(185, 156, 255, 0.05)" : "rgba(185, 156, 255, 0.12)";
    ctx.strokeStyle = trigger.used ? "rgba(185, 156, 255, 0.22)" : "rgba(214, 192, 255, 0.72)";
    ctx.setLineDash([10, 8]);
    ctx.fillRect(trigger.x, trigger.y, trigger.w, trigger.h);
    ctx.strokeRect(trigger.x, trigger.y, trigger.w, trigger.h);
    ctx.restore();
  }

  renderSlope(ctx, slope) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(106, 223, 215, 0.18)";
    ctx.lineWidth = slope.thickness + 10;
    ctx.beginPath();
    ctx.moveTo(slope.ax, slope.ay);
    ctx.lineTo(slope.bx, slope.by);
    ctx.stroke();
    ctx.strokeStyle = "#285d61";
    ctx.lineWidth = slope.thickness;
    ctx.stroke();
    ctx.strokeStyle = "rgba(137, 250, 238, 0.62)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }

  renderHazard(ctx, hazard) {
    const spikeWidth = 22;
    const direction = hazard.direction || "up";
    const vertical = direction === "left" || direction === "right";
    const count = Math.max(1, Math.ceil((vertical ? hazard.h : hazard.w) / spikeWidth));
    ctx.fillStyle = "#de496d";
    ctx.shadowColor = "#ff557d";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    if (direction === "up" || direction === "down") {
      const baseY = direction === "up" ? hazard.y + hazard.h : hazard.y;
      const tipY = direction === "up" ? hazard.y : hazard.y + hazard.h;
      ctx.moveTo(hazard.x, baseY);
      for (let index = 0; index < count; index += 1) {
        const x = hazard.x + index * hazard.w / count;
        ctx.lineTo(x + hazard.w / count * 0.5, tipY);
        ctx.lineTo(x + hazard.w / count, baseY);
      }
    } else {
      const baseX = direction === "left" ? hazard.x + hazard.w : hazard.x;
      const tipX = direction === "left" ? hazard.x : hazard.x + hazard.w;
      ctx.moveTo(baseX, hazard.y);
      for (let index = 0; index < count; index += 1) {
        const y = hazard.y + index * hazard.h / count;
        ctx.lineTo(tipX, y + hazard.h / count * 0.5);
        ctx.lineTo(baseX, y + hazard.h / count);
      }
    }
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    const base = hazardBaseSegment(hazard);
    ctx.strokeStyle = "rgba(92, 22, 48, 0.9)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(base.ax, base.ay);
    ctx.lineTo(base.bx, base.by);
    ctx.stroke();
  }

  renderAnchor(ctx, anchor) {
    const isRopeTarget = this.ropeTarget?.kind === "anchor" && this.ropeTarget.id === anchor.id;
    const pulse = 1 + Math.sin(this.elapsed * 3 + anchor.x * 0.02) * 0.1;
    ctx.save();
    ctx.translate(anchor.x, anchor.y);
    ctx.scale(pulse, pulse);
    ctx.strokeStyle = isRopeTarget ? "#e6fffb" : "rgba(110, 241, 233, 0.66)";
    ctx.fillStyle = "rgba(62, 191, 192, 0.16)";
    ctx.lineWidth = isRopeTarget ? 4 : 2;
    ctx.shadowColor = "#70fff2";
    ctx.shadowBlur = isRopeTarget ? 22 : 10;
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = isRopeTarget ? "#d9fffb" : "#67d9d4";
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  renderEnergyOrb(ctx, orb) {
    const pulse = 1 + Math.sin(this.elapsed * 4 + orb.x) * 0.16;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(72, 168, 255, 0.25)";
    ctx.beginPath();
    ctx.arc(orb.x, orb.y, 20 * pulse, 0, TAU);
    ctx.fill();
    ctx.shadowColor = "#63bfff";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "#b3e7ff";
    ctx.beginPath();
    ctx.arc(orb.x, orb.y, 7 * pulse, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  renderDashRefill(ctx, refill) {
    const pulse = 1 + Math.sin(this.elapsed * 4.5 + refill.x * 0.02) * 0.1;
    ctx.save();
    ctx.translate(refill.x, refill.y);
    ctx.globalAlpha = refill.available ? 1 : 0.16;
    ctx.rotate(this.elapsed * 0.85);
    ctx.shadowColor = "#79dcff";
    ctx.shadowBlur = refill.available ? 24 : 0;
    ctx.fillStyle = "rgba(91, 199, 255, 0.26)";
    ctx.strokeStyle = "#b9efff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -refill.radius * pulse);
    ctx.lineTo(refill.radius * pulse, 0);
    ctx.lineTo(0, refill.radius * pulse);
    ctx.lineTo(-refill.radius * pulse, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.rotate(-this.elapsed * 1.7);
    ctx.fillStyle = "#e2f9ff";
    ctx.font = "700 11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(refill.charges), 0, 1);
    ctx.restore();
  }

  renderMovingObject(ctx, item) {
    if (this.debug) {
      ctx.save();
      ctx.strokeStyle = "rgba(255, 190, 117, 0.48)";
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 7]);
      ctx.beginPath();
      item.path.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
      if (item.loopMode === "loop") ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
    if (item.objectKind === "platform") {
      this.renderPlatform(ctx, item);
      ctx.fillStyle = "rgba(255, 184, 106, 0.58)";
      ctx.fillRect(item.x, item.y, item.w, 3);
    } else if (item.objectKind === "hazard") {
      this.renderHazard(ctx, item);
    } else if (item.objectKind === "anchor") {
      this.renderAnchor(ctx, item);
    } else if (item.objectKind === "bashTarget") {
      this.renderBashTarget(ctx, item);
    }
  }

  renderBashTarget(ctx, target) {
    const activeAim = this.runtime.bashAim;
    const selected = activeAim?.target.id === target.id || (!activeAim && this.bashTarget?.id === target.id);
    const available = target.cooldown <= 0;
    const pulse = 1 + Math.sin(this.elapsed * 5 + target.x * 0.02) * 0.12;
    ctx.save();
    ctx.translate(target.x, target.y);
    ctx.globalAlpha = available ? 1 : 0.2;
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = selected ? "#f3dcff" : "#c68cff";
    ctx.fillStyle = selected ? "rgba(222, 170, 255, 0.34)" : "rgba(171, 104, 225, 0.18)";
    ctx.lineWidth = selected ? 4 : 2;
    ctx.shadowColor = "#cc86ff";
    ctx.shadowBlur = selected ? 28 : 15;
    ctx.beginPath();
    for (let side = 0; side < 6; side += 1) {
      const angle = side / 6 * TAU - Math.PI / 2;
      const x = Math.cos(angle) * 20 * pulse;
      const y = Math.sin(angle) * 20 * pulse;
      if (side === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, TAU);
    ctx.fill();
    if (selected) {
      const launch = activeAim?.direction || this.currentBashDirection(target);
      ctx.strokeStyle = "rgba(239, 211, 255, 0.8)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(launch.x * 24, launch.y * 24);
      ctx.lineTo(launch.x * 78, launch.y * 78);
      ctx.stroke();
    }
    ctx.restore();
  }

  renderBashAimOverlay(ctx) {
    const aim = this.runtime.bashAim;
    if (!aim) return;
    const target = this.worldToScreen(aim.target.x, aim.target.y);
    const direction = rotate(aim.direction.x, aim.direction.y, this.camera.angle);
    const remainingRatio = clamp(aim.remaining / TUNING.bashAimDuration, 0, 1);

    ctx.save();
    ctx.fillStyle = "rgba(16, 5, 31, 0.32)";
    ctx.fillRect(0, 0, VIEWPORT.width, VIEWPORT.height);
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "rgba(223, 170, 255, 0.38)";
    ctx.lineWidth = 2;
    for (const radius of [46, 70, 98]) {
      ctx.globalAlpha = 0.78 - radius * 0.004;
      ctx.beginPath();
      ctx.arc(target.x, target.y, radius, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#f0d7ff";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.shadowColor = "#ce8bff";
    ctx.shadowBlur = 22;
    ctx.beginPath();
    ctx.moveTo(target.x + direction.x * 31, target.y + direction.y * 31);
    ctx.lineTo(target.x + direction.x * 116, target.y + direction.y * 116);
    ctx.stroke();
    const arrowTipX = target.x + direction.x * 116;
    const arrowTipY = target.y + direction.y * 116;
    const normalX = -direction.y;
    const normalY = direction.x;
    ctx.fillStyle = "#f4e4ff";
    ctx.beginPath();
    ctx.moveTo(arrowTipX + direction.x * 14, arrowTipY + direction.y * 14);
    ctx.lineTo(arrowTipX - direction.x * 14 + normalX * 11, arrowTipY - direction.y * 14 + normalY * 11);
    ctx.lineTo(arrowTipX - direction.x * 14 - normalX * 11, arrowTipY - direction.y * 14 - normalY * 11);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(239, 205, 255, 0.92)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(target.x, target.y, 82, -Math.PI / 2, -Math.PI / 2 + TAU * remainingRatio);
    ctx.stroke();
    ctx.restore();
  }

  renderAbilityPickup(ctx, pickup) {
    const pulse = 1 + Math.sin(this.elapsed * 3.5) * 0.12;
    ctx.save();
    ctx.translate(pickup.x, pickup.y);
    ctx.rotate(this.elapsed * 0.7);
    ctx.shadowColor = "#d2a2ff";
    ctx.shadowBlur = 28;
    ctx.strokeStyle = "#ebd6ff";
    ctx.fillStyle = "rgba(164, 100, 232, 0.3)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.rect(-14 * pulse, -14 * pulse, 28 * pulse, 28 * pulse);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  renderRoomEntrance(ctx, entrance) {
    ctx.save();
    ctx.fillStyle = "rgba(91, 217, 255, 0.08)";
    ctx.strokeStyle = "rgba(126, 231, 255, 0.52)";
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2;
    ctx.fillRect(entrance.x, entrance.y, entrance.w, entrance.h);
    ctx.strokeRect(entrance.x, entrance.y, entrance.w, entrance.h);
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(190, 244, 255, 0.8)";
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText(entrance.id, entrance.x + entrance.w / 2, entrance.y - 7);
    ctx.restore();
  }

  renderRoomExit(ctx, exit) {
    const locked = Boolean(exit.requiredAbility && !this.abilities.has(exit.requiredAbility));
    const direction = {
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 },
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 }
    }[exit.direction] || { x: 1, y: 0 };
    const centerX = exit.x + exit.w / 2;
    const centerY = exit.y + exit.h / 2;
    ctx.save();
    ctx.fillStyle = locked ? "rgba(255, 105, 129, 0.1)" : "rgba(255, 218, 126, 0.08)";
    ctx.strokeStyle = locked ? "rgba(255, 119, 143, 0.66)" : "rgba(255, 223, 137, 0.7)";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 7]);
    ctx.fillRect(exit.x, exit.y, exit.w, exit.h);
    ctx.strokeRect(exit.x, exit.y, exit.w, exit.h);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(centerX - direction.x * 18, centerY - direction.y * 18);
    ctx.lineTo(centerX + direction.x * 18, centerY + direction.y * 18);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centerX + direction.x * 22, centerY + direction.y * 22);
    ctx.lineTo(centerX + direction.x * 8 - direction.y * 8, centerY + direction.y * 8 + direction.x * 8);
    ctx.lineTo(centerX + direction.x * 8 + direction.y * 8, centerY + direction.y * 8 - direction.x * 8);
    ctx.closePath();
    ctx.fillStyle = locked ? "#ff8da4" : "#ffe49a";
    ctx.fill();
    ctx.restore();
  }

  renderCheckpoint(ctx, checkpoint) {
    const active = checkpoint.id === this.currentCheckpoint.id;
    const centerX = checkpoint.x + checkpoint.w / 2;
    const centerY = checkpoint.y + checkpoint.h / 2;
    ctx.save();
    ctx.globalAlpha = active ? 0.95 : 0.32;
    ctx.strokeStyle = active ? "#9affef" : "#4f9b9d";
    ctx.lineWidth = 3;
    ctx.shadowColor = "#74fff3";
    ctx.shadowBlur = active ? 24 : 0;
    ctx.beginPath();
    ctx.moveTo(centerX, checkpoint.y + 10);
    ctx.lineTo(centerX, checkpoint.y + checkpoint.h - 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(centerX, centerY, active ? 19 : 13, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  renderSign(ctx, sign) {
    ctx.save();
    ctx.font = "600 13px system-ui, sans-serif";
    const width = ctx.measureText(sign.text).width + 28;
    ctx.fillStyle = "rgba(4, 16, 23, 0.72)";
    ctx.strokeStyle = "rgba(124, 235, 228, 0.2)";
    ctx.lineWidth = 1;
    roundedRect(ctx, sign.x - width / 2, sign.y - 20, width, 34, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(211, 249, 247, 0.74)";
    ctx.textAlign = "center";
    ctx.fillText(sign.text, sign.x, sign.y + 2);
    ctx.restore();
  }

  renderGoal(ctx) {
    const goal = this.level.goal;
    const pulse = 1 + Math.sin(this.elapsed * 3) * 0.1;
    ctx.save();
    ctx.translate(goal.x, goal.y);
    ctx.globalAlpha = this.runtime.goalReached ? 0.35 : 1;
    ctx.strokeStyle = "rgba(255, 233, 154, 0.2)";
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 9]);
    ctx.beginPath();
    ctx.arc(0, 0, goal.radius + TUNING.goalActivationPadding, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#ffe99a";
    ctx.fillStyle = "rgba(255, 222, 111, 0.15)";
    ctx.shadowColor = "#ffe67a";
    ctx.shadowBlur = 26;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, goal.radius * pulse, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  renderHardBar(ctx) {
    const bar = this.runtime.hardBar;
    if (!bar) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255, 172, 69, 0.24)";
    ctx.lineWidth = 24;
    ctx.beginPath();
    ctx.moveTo(this.player.x, this.player.y);
    ctx.lineTo(bar.pivotX, bar.pivotY);
    ctx.stroke();
    ctx.strokeStyle = "#ffc36a";
    ctx.lineWidth = TUNING.hardBarThickness;
    ctx.shadowColor = "#ff9f44";
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(this.player.x, this.player.y);
    ctx.lineTo(bar.pivotX, bar.pivotY);
    ctx.stroke();
    ctx.fillStyle = "#fff0c7";
    for (const endpoint of [
      { x: this.player.x, y: this.player.y },
      { x: bar.pivotX, y: bar.pivotY }
    ]) {
      ctx.beginPath();
      ctx.arc(endpoint.x, endpoint.y, 7, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  renderRope(ctx) {
    const playerScreenIndependent = this.player;
    if (!this.abilities.has("rope") && !this.player.rope) return;
    if (!this.player.rope) {
      const pointer = this.screenToWorld(this.input.mouse.x, this.input.mouse.y);
      const aim = normalize(pointer.x - this.player.x, pointer.y - this.player.y, this.player.facing, -0.2);
      ctx.save();
      ctx.setLineDash([4, 14]);
      ctx.strokeStyle = "rgba(115, 222, 219, 0.11)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(playerScreenIndependent.x, playerScreenIndependent.y);
      ctx.lineTo(playerScreenIndependent.x + aim.x * TUNING.ropeRange, playerScreenIndependent.y + aim.y * TUNING.ropeRange);
      ctx.stroke();
      ctx.restore();
    }
    if (this.ropeTarget && !this.player.rope) {
      ctx.save();
      ctx.setLineDash([8, 10]);
      ctx.strokeStyle = this.player.energy >= TUNING.ropeCost ? "rgba(118, 255, 243, 0.26)" : "rgba(255, 103, 126, 0.3)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playerScreenIndependent.x, playerScreenIndependent.y);
      ctx.lineTo(this.ropeTarget.x, this.ropeTarget.y);
      ctx.stroke();
      ctx.restore();
    }
    if (!this.player.rope) return;
    const rope = this.player.rope;
    const endpoint = rope.phase === "attached"
      ? { x: rope.x, y: rope.y }
      : { x: rope.tipX, y: rope.tipY };
    const controlShift = rope.visualSag * 1.28;
    const firstControl = {
      x: endpoint.x + (playerScreenIndependent.x - endpoint.x) * 0.33 + rope.bendX * controlShift,
      y: endpoint.y + (playerScreenIndependent.y - endpoint.y) * 0.33 + rope.bendY * controlShift
    };
    const secondControl = {
      x: endpoint.x + (playerScreenIndependent.x - endpoint.x) * 0.67 + rope.bendX * controlShift,
      y: endpoint.y + (playerScreenIndependent.y - endpoint.y) * 0.67 + rope.bendY * controlShift
    };
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(112, 255, 242, 0.24)";
    ctx.lineWidth = 8 + rope.visualTension * 2;
    ctx.beginPath();
    ctx.moveTo(endpoint.x, endpoint.y);
    ctx.bezierCurveTo(
      firstControl.x,
      firstControl.y,
      secondControl.x,
      secondControl.y,
      playerScreenIndependent.x,
      playerScreenIndependent.y
    );
    ctx.stroke();
    ctx.strokeStyle = "#8dfff5";
    ctx.lineWidth = 2.4;
    ctx.shadowColor = "#6df5eb";
    ctx.shadowBlur = 10;
    ctx.stroke();
    if (rope.phase !== "attached") {
      ctx.fillStyle = "#d9fffb";
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(endpoint.x, endpoint.y, 5, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  renderSurfaceTarget(ctx) {
    const target = this.ropeTarget;
    if (!target || target.kind !== "surface" || this.player.rope) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(169, 255, 246, 0.72)";
    ctx.lineWidth = 6;
    ctx.shadowColor = "#7dfff2";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(target.surface.ax, target.surface.ay);
    ctx.lineTo(target.surface.bx, target.surface.by);
    ctx.stroke();
    ctx.fillStyle = "#effffc";
    ctx.beginPath();
    ctx.arc(target.x, target.y, 7, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  renderHardBarTarget(ctx) {
    const target = this.hardBarTarget;
    if (!target || this.runtime.hardBar) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.setLineDash([7, 9]);
    ctx.strokeStyle = "rgba(255, 198, 99, 0.62)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(this.player.x, this.player.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(255, 193, 83, 0.78)";
    ctx.lineWidth = 6;
    ctx.shadowColor = "#ffb34e";
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.moveTo(target.surface.ax, target.surface.ay);
    ctx.lineTo(target.surface.bx, target.surface.by);
    ctx.stroke();
    ctx.fillStyle = "#fff0c9";
    ctx.beginPath();
    ctx.arc(target.x, target.y, 7, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  renderPlayer(ctx) {
    if (!this.player.visible) return;
    const screen = this.worldToScreen(this.player.x, this.player.y);
    const speedScreen = rotate(this.player.vx, this.player.vy, this.camera.angle);
    const speed = length(speedScreen.x, speedScreen.y);
    const animation = this.player.animation;
    const pose = computeSoftBodyPose(animation, this.player.radius);
    const axisAngle = pose.angle + this.camera.angle;
    const verticalExtent = Math.sqrt(
      Math.pow(pose.longRadius * Math.sin(axisAngle), 2)
      + Math.pow(pose.crossRadius * Math.cos(axisAngle), 2)
    );
    const groundedOffset = this.player.grounded
      ? this.player.radius - verticalExtent
      : 0;
    ctx.save();
    ctx.translate(screen.x, screen.y + groundedOffset);
    if (this.player.wind) {
      const windScreen = rotate(this.player.wind.forceX, this.player.wind.forceY, this.camera.angle);
      const direction = normalize(windScreen.x, windScreen.y, 0, -1);
      const perpendicular = { x: -direction.y, y: direction.x };
      const flow = (this.elapsed * 180) % 34;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = "rgba(139, 225, 255, 0.76)";
      ctx.lineWidth = 3;
      ctx.shadowColor = "#66d5ff";
      ctx.shadowBlur = 14;
      for (const offset of [-18, 0, 18]) {
        const start = -42 + flow;
        ctx.beginPath();
        ctx.moveTo(direction.x * start + perpendicular.x * offset, direction.y * start + perpendicular.y * offset);
        ctx.lineTo(direction.x * (start + 24) + perpendicular.x * offset, direction.y * (start + 24) + perpendicular.y * offset);
        ctx.stroke();
      }
      ctx.restore();
    }
    const flash = this.player.invulnerability > 0 && Math.floor(this.player.invulnerability * 18) % 2 === 0;
    ctx.globalAlpha = flash ? 0.35 : 1;
    const velocityForward = normalize(speedScreen.x, speedScreen.y, this.player.facing, 0);
    const motionBlend = animation.motionTailBlend;
    const tailOffset = rotate(animation.tailOffsetX, animation.tailOffsetY, this.camera.angle);
    const tailVelocity = rotate(animation.tailVelocityX, animation.tailVelocityY, this.camera.angle);
    const tailDirection = normalize(tailOffset.x, tailOffset.y, -this.player.facing, 0);
    const perpendicular = { x: -tailDirection.y, y: tailDirection.x };
    const tailAngle = Math.atan2(tailDirection.y, tailDirection.x);
    const tailAxisAngle = tailAngle - axisAngle;
    const edgeRadius = 1 / Math.sqrt(
      Math.pow(Math.cos(tailAxisAngle) / pose.longRadius, 2)
      + Math.pow(Math.sin(tailAxisAngle) / pose.crossRadius, 2)
    );
    const tailTangentSpeed = dot(
      tailVelocity.x,
      tailVelocity.y,
      perpendicular.x,
      perpendicular.y
    );
    const tailBend = clamp(tailTangentSpeed * 0.026, -9, 9);
    const tailRootX = tailDirection.x * edgeRadius * 0.7;
    const tailRootY = tailDirection.y * edgeRadius * 0.7;
    ctx.strokeStyle = "rgba(171, 255, 247, 0.65)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.shadowColor = "#a8fff5";
    ctx.shadowBlur = 11;
    ctx.beginPath();
    ctx.moveTo(tailRootX, tailRootY);
    ctx.quadraticCurveTo(
      tailRootX + (tailOffset.x - tailRootX) * 0.5 + perpendicular.x * tailBend,
      tailRootY + (tailOffset.y - tailRootY) * 0.5 + perpendicular.y * tailBend,
      tailOffset.x,
      tailOffset.y
    );
    ctx.stroke();

    ctx.shadowColor = animation.dashBlend > 0.05 ? "#8fdfff" : "#a8fff5";
    ctx.shadowBlur = 17 + animation.dashBlend * 21 + Math.abs(animation.stretch) * 18;
    if (this.player.gliding) {
      ctx.strokeStyle = "rgba(143, 225, 255, 0.84)";
      ctx.fillStyle = "rgba(91, 181, 235, 0.16)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-8, -3);
      ctx.quadraticCurveTo(-42, -30, -55, 6);
      ctx.quadraticCurveTo(-32, -1, -10, 10);
      ctx.moveTo(8, -3);
      ctx.quadraticCurveTo(42, -30, 55, 6);
      ctx.quadraticCurveTo(32, -1, 10, 10);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = "#e8fffb";
    ctx.save();
    ctx.rotate(axisAngle);
    ctx.beginPath();
    ctx.ellipse(0, 0, pose.longRadius, pose.crossRadius, 0, 0, TAU);
    ctx.fill();
    if (animation.dashBlend > 0.01) {
      ctx.globalAlpha *= animation.dashBlend * 0.72;
      ctx.fillStyle = "#d8f3ff";
      ctx.fill();
    }
    ctx.restore();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#2d7278";
    const eyeForward = normalize(
      this.player.facing * (1 - motionBlend) + velocityForward.x * motionBlend,
      velocityForward.y * motionBlend,
      this.player.facing,
      0
    );
    ctx.beginPath();
    ctx.arc(eyeForward.x * 6, -4 + eyeForward.y * 4, 2.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  renderHud(ctx) {
    ctx.save();
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(4, 14, 20, 0.68)";
    roundedRect(ctx, 22, 22, 286, 92, 17);
    ctx.fill();

    ctx.font = "700 11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "rgba(208, 247, 246, 0.5)";
    ctx.fillText("VITAL", 42, 46);
    for (let index = 0; index < TUNING.maximumHealth; index += 1) {
      const x = 45 + index * 31;
      ctx.fillStyle = index < this.player.health ? "#ff7090" : "rgba(255, 112, 144, 0.14)";
      ctx.shadowColor = "#ff557b";
      ctx.shadowBlur = index < this.player.health ? 8 : 0;
      ctx.beginPath();
      ctx.arc(x, 67, 9, 0, TAU);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    if (this.abilities.has("dash")) {
      ctx.fillStyle = "rgba(208, 247, 246, 0.5)";
      ctx.fillText("DASH", 220, 46);
      for (let index = 0; index < this.player.maximumDashCharges; index += 1) {
        const available = index < this.player.dashCharges;
        ctx.save();
        ctx.translate(278 - index * 24, 64);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = available ? "#9be7ff" : "rgba(116, 195, 218, 0.15)";
        ctx.shadowColor = "#76d9ff";
        ctx.shadowBlur = available ? 12 : 0;
        ctx.fillRect(-8, -8, 16, 16);
        ctx.restore();
      }
    }

    ctx.fillStyle = "rgba(208, 247, 246, 0.5)";
    ctx.fillText("FLOW", 42, 96);
    const barX = 88;
    const barY = 86;
    const barWidth = 193;
    ctx.fillStyle = "rgba(78, 177, 255, 0.13)";
    roundedRect(ctx, barX, barY, barWidth, 11, 5);
    ctx.fill();
    const energyWidth = barWidth * this.player.energy / TUNING.maximumEnergy;
    if (energyWidth > 0.5) {
      ctx.fillStyle = "#62baff";
      ctx.shadowColor = "#42aaff";
      ctx.shadowBlur = 10;
      roundedRect(ctx, barX, barY, energyWidth, 11, 5);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(226, 250, 255, 0.72)";
    ctx.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "right";
    ctx.fillText(`${formatNumber(this.player.energy)} / ${TUNING.maximumEnergy}`, 278, 80);

    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(218, 249, 248, 0.66)";
    ctx.font = "700 12px system-ui, sans-serif";
    ctx.fillText(levelDisplayName(this.level), 28, VIEWPORT.height - 26);

    if (referenceRunState?.currentRoomId === this.level.id) {
      const collection = referenceCollections.find((item) => item.id === referenceRunState.collectionId);
      const visitedInCollection = collection
        ? collection.roomIds.filter((roomId) => referenceRunState.visitedRooms.has(roomId)).length
        : referenceRunState.visitedRooms.size;
      const total = collection?.roomIds.length || "?";
      ctx.fillStyle = "rgba(224, 203, 255, 0.78)";
      ctx.font = "650 11px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText(`连续路线 ${visitedInCollection}/${total} · 标记 ${referenceRunState.flags.size}`, 28, VIEWPORT.height - 46);
    }

    const speed = length(this.player.vx, this.player.vy);
    ctx.textAlign = "right";
    ctx.font = "700 12px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = speed > 600 ? "#8ff9ee" : "rgba(210, 247, 246, 0.52)";
    ctx.fillText(`${Math.round(speed)} px/s`, VIEWPORT.width - 28, VIEWPORT.height - 26);

    if (this.player.wind) {
      const windScreen = rotate(this.player.wind.forceX, this.player.wind.forceY, this.camera.angle);
      const horizontal = Math.abs(windScreen.x) > Math.abs(windScreen.y) * 0.55
        ? (windScreen.x > 0 ? "→" : "←")
        : "";
      const vertical = Math.abs(windScreen.y) > Math.abs(windScreen.x) * 0.55
        ? (windScreen.y > 0 ? "↓" : "↑")
        : "";
      ctx.textAlign = "center";
      ctx.fillStyle = "#a9eaff";
      ctx.font = "700 13px system-ui, sans-serif";
      const boost = this.player.gliding ? ` · 滑翔风力 ${this.player.wind.multiplier.toFixed(1)}×` : "";
      const liftSpeed = Math.max(0, -dot(
        this.player.vx,
        this.player.vy,
        this.gravityDirection().x,
        this.gravityDirection().y
      ));
      const lift = this.player.wind.liftActive
        ? ` · 上升 ${Math.round(liftSpeed)}/${TUNING.glideUpdraftMaximumSpeed}`
        : "";
      ctx.fillText(`气流推动 ${horizontal}${vertical}${boost}${lift}`, VIEWPORT.width / 2, 136);
    }

    if (this.ropeTarget && !this.player.rope) {
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(4, 15, 21, 0.75)";
      roundedRect(ctx, VIEWPORT.width / 2 - 110, VIEWPORT.height - 66, 220, 34, 11);
      ctx.fill();
      ctx.fillStyle = this.player.energy >= TUNING.ropeCost ? "#a9fff5" : "#ff8ca2";
      ctx.font = "650 12px system-ui, sans-serif";
      const targetLabel = this.ropeTarget.kind === "surface" ? "可抓取表面" : this.ropeTarget.id;
      ctx.fillText(`软绳目标 ${targetLabel}  ·  ${TUNING.ropeCost} 蓝`, VIEWPORT.width / 2, VIEWPORT.height - 44);
    } else if (this.player.rope) {
      const ropePhaseLabel = this.player.rope.phase === "firing"
        ? "软绳发射中"
        : this.player.rope.phase === "retracting"
          ? "软绳回收中"
          : this.ropeWinching
            ? `持续收绳 ${Math.round(this.player.rope.reelSpeed || 0)} px/s · 最短时额外加速`
            : "软绳已连接 · 按住 W / ↑ 快速收绳";
      ctx.textAlign = "center";
      ctx.fillStyle = "#a9fff5";
      ctx.font = "650 12px system-ui, sans-serif";
      ctx.fillText(ropePhaseLabel, VIEWPORT.width / 2, VIEWPORT.height - 44);
    }

    if (this.runtime.bashAim) {
      ctx.textAlign = "center";
      ctx.fillStyle = "#f0d1ff";
      ctx.font = "700 13px system-ui, sans-serif";
      ctx.fillText(
        `猛击时停 ${this.runtime.bashAim.remaining.toFixed(1)}s · 按住 Q 选向 · 松开立即释放`,
        VIEWPORT.width / 2,
        VIEWPORT.height - 91
      );
    } else if (this.bashTarget && this.abilities.has("bash")) {
      ctx.textAlign = "center";
      ctx.fillStyle = "#e3b8ff";
      ctx.font = "700 12px system-ui, sans-serif";
      ctx.fillText(`Q · 进入猛击时停 ${TUNING.bashCost} 蓝`, VIEWPORT.width / 2, VIEWPORT.height - 91);
    }

    if (this.runtime.hardBar && this.abilities.has("hardBar")) {
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffd28b";
      ctx.font = "700 12px system-ui, sans-serif";
      ctx.fillText(
        `F · 释放${this.runtime.hardBar.surfaceKind === "hazard" ? "伤害区" : ""}硬杆  ·  固定 ${Math.round(this.runtime.hardBar.length)} px`,
        VIEWPORT.width / 2,
        VIEWPORT.height - 112
      );
    } else if (this.hardBarTarget && this.abilities.has("hardBar")) {
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffd28b";
      ctx.font = "700 12px system-ui, sans-serif";
      const hardBarLabel = this.hardBarTarget.kind === "hazard" ? "伤害区底座撑杆" : "硬杆";
      ctx.fillText(`F · ${hardBarLabel} ${TUNING.hardBarCost} 蓝`, VIEWPORT.width / 2, VIEWPORT.height - 112);
    }

    if (this.player.damageRecoveryJump && this.player.damageRecoveryTimer > 0) {
      ctx.textAlign = "center";
      ctx.fillStyle = "#ff9bb0";
      ctx.font = "700 13px system-ui, sans-serif";
      ctx.fillText("SPACE · 受伤脱离跳", VIEWPORT.width / 2, VIEWPORT.height - 82);
    }

    if (this.toast.time > 0) {
      const alpha = clamp(this.toast.time * 2, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.font = "650 15px system-ui, sans-serif";
      const width = Math.max(240, ctx.measureText(this.toast.text).width + 46);
      const x = VIEWPORT.width / 2 - width / 2;
      ctx.fillStyle = "rgba(4, 15, 21, 0.83)";
      ctx.strokeStyle = this.toast.tone === "warning" ? "rgba(255, 112, 137, 0.4)" : this.toast.tone === "ability" ? "rgba(208, 149, 255, 0.45)" : "rgba(112, 242, 234, 0.28)";
      roundedRect(ctx, x, 26, width, 43, 14);
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.fillStyle = "#e9fffc";
      ctx.fillText(this.toast.text, VIEWPORT.width / 2, 53);
    } else if (this.runtime.goalReached) {
      const width = 330;
      const x = VIEWPORT.width / 2 - width / 2;
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(4, 15, 21, 0.88)";
      ctx.strokeStyle = "rgba(255, 233, 154, 0.45)";
      roundedRect(ctx, x, 24, width, 54, 15);
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.fillStyle = "#fff0ad";
      ctx.font = "750 15px system-ui, sans-serif";
      ctx.fillText("关卡完成", VIEWPORT.width / 2, 47);
      ctx.fillStyle = "rgba(233, 255, 252, 0.68)";
      ctx.font = "600 11px system-ui, sans-serif";
      ctx.fillText("Esc 返回关卡选择", VIEWPORT.width / 2, 66);
    }

    if (this.debug) this.renderDebug(ctx);
    ctx.restore();
  }

  renderDebug(ctx) {
    const gravity = this.gravityDirection();
    const visualStats = this.visualRuntime.stats();
    const decodedMiB = visualStats.estimatedDecodedBytes / (1024 * 1024);
    const tintMiB = visualStats.estimatedTintBytes / (1024 * 1024);
    const lines = [
      `position ${formatNumber(this.player.x)} / ${formatNumber(this.player.y)}`,
      `velocity ${formatNumber(this.player.vx)} / ${formatNumber(this.player.vy)}`,
      `gravity ${formatNumber(gravity.x, 2)} / ${formatNumber(gravity.y, 2)}`,
      `camera ${(this.camera.angle * 180 / Math.PI).toFixed(0)}°`,
      `render ${this.displayMetrics?.width || canvas.width}×${this.displayMetrics?.height || canvas.height}  ${this.displayMetrics?.scale.toFixed(2) || "1.00"}x`,
      `frame ${this.frameMetrics.averageFps.toFixed(1)} fps  avg ${this.frameMetrics.averageMs.toFixed(2)} ms`,
      `p95 ${this.frameMetrics.p95Ms.toFixed(2)} ms  worst ${this.frameMetrics.worstMs.toFixed(2)} ms`,
      `objects active ${this.debugStats.activeObjects}  drawn ${this.debugStats.renderedObjects}`,
      `collision candidates ${this.debugStats.collisionCandidates}`,
      `assets req ${visualStats.requests}  hit ${visualStats.cacheHits}  ready ${visualStats.ready}  load ${visualStats.loading}  err ${visualStats.error}`,
      `asset cache ${visualStats.cacheEntries}  decoded ${decodedMiB.toFixed(2)} MiB  tint ${tintMiB.toFixed(2)} MiB/${visualStats.tintVariants}  evicted ${visualStats.evictions}`,
      `visual scene ${visualStats.sceneDraws}  object ${visualStats.objectAssetDraws}/${visualStats.objectPatchDraws} patches  fallback ${visualStats.fallbackDraws}`,
      `visual culled ${visualStats.cullCount}  quality ${visualStats.qualityTier}`,
      `grounded ${this.player.grounded}  rope ${this.player.rope?.phase || "—"}  dash ${this.player.dashCharges}/${this.player.maximumDashCharges}`,
      `checkpoint ${this.currentCheckpoint.id}`,
      `abilities ${[...this.abilities].join(", ")}`
    ];
    ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
    roundedRect(ctx, VIEWPORT.width - 438, 80, 410, lines.length * 20 + 22, 12);
    ctx.fill();
    ctx.fillStyle = "#a8ebe8";
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "left";
    lines.forEach((line, index) => ctx.fillText(line, VIEWPORT.width - 420, 106 + index * 20));
  }

  renderPause(ctx) {
    ctx.save();
    ctx.fillStyle = "rgba(1, 7, 11, 0.66)";
    ctx.fillRect(0, 0, VIEWPORT.width, VIEWPORT.height);
    ctx.textAlign = "center";
    ctx.fillStyle = "#e9fffc";
    ctx.font = "750 36px system-ui, sans-serif";
    ctx.fillText("已暂停", VIEWPORT.width / 2, VIEWPORT.height / 2 - 8);
    ctx.fillStyle = "rgba(220, 249, 247, 0.6)";
    ctx.font = "15px system-ui, sans-serif";
    ctx.fillText("按 P 继续", VIEWPORT.width / 2, VIEWPORT.height / 2 + 28);
    ctx.restore();
  }
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function levelDisplayName(level) {
  return level.category === "单项3C"
    ? `${level.name} · ${level.acceptanceLevel}`
    : level.name;
}

function isGodotSyncReady(level) {
  return level.category === "单项3C" && Number(level.acceptanceLevel.slice(1)) >= 1;
}

if (canvas && context && startCard && levelGrid && levelEditorRoot && openLevelEditorButton) {
const input = new Input(canvas);
const game = new Game(context, input, LEVELS);
const referenceLevelLibrary = new ReferenceLevelLibrary();
const levelStartCoordinator = new LatestRequestCoordinator();
globalThis.cablesterCancelPendingLevelStart = () => levelStartCoordinator.cancel();

let customLevels = [];
let referenceRooms = [];
let referenceCollectionByRoom = new Map();
let referenceLoadError = null;
let referenceCollectionFilter = "all";
let referenceSearch = "";
let referencePage = 0;
let referenceLoadAudit = { running: false, completed: 0, total: 0, entrances: 0, failures: [], elapsedMs: 0 };
let referenceAcceptanceAudit = {
  running: false,
  completed: 0,
  total: 0,
  entranceChecks: 0,
  checkpointResetChecks: 0,
  connectionChecks: 0,
  mechanismCycles: 0,
  menuReentries: 0,
  renderedRooms: 0,
  peakActiveObjects: 0,
  peakCachedDocuments: 0,
  finalCachedDocuments: 0,
  failures: [],
  elapsedMs: 0
};
let referenceContinuousAudit = {
  running: false,
  collectionsCompleted: 0,
  totalCollections: 0,
  transitionsCompleted: 0,
  totalTransitions: 0,
  deaths: 0,
  failures: [],
  collections: [],
  elapsedMs: 0
};

const REFERENCE_PAGE_SIZE = 24;

function filteredReferenceRooms() {
  const query = referenceSearch.trim().toLocaleLowerCase("zh-CN");
  return referenceRooms.filter((room) => {
    if (referenceCollectionFilter !== "all" && referenceCollectionByRoom.get(room.id)?.id !== referenceCollectionFilter) return false;
    if (!query) return true;
    return [room.id, room.localName, room.mapType, room.hierarchy?.referenceRoomId, room.hierarchy?.partitionId]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase("zh-CN").includes(query));
  });
}

function nextBrowserFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function runReferenceLoadAudit(rooms) {
  if (referenceLoadAudit.running || referenceAcceptanceAudit.running || referenceContinuousAudit.running || rooms.length === 0) return;
  referenceLoadAudit = { running: true, completed: 0, total: rooms.length, entrances: 0, failures: [], elapsedMs: 0 };
  referenceLevelLibrary.clearRoomCache();
  renderLevelMenu();
  const startedAt = performance.now();
  for (const room of rooms) {
    try {
      const level = await referenceLevelLibrary.loadRoom(room.id);
      for (const entrance of level.roomEntrances) {
        game.loadLevel(level, { entranceId: entrance.id });
        referenceLoadAudit.entrances += 1;
      }
      game.loadLevel(level);
      await nextBrowserFrame();
    } catch (error) {
      console.error(error);
      referenceLoadAudit.failures.push({ roomId: room.id, message: error.message });
    }
    referenceLoadAudit.completed += 1;
    referenceLoadAudit.elapsedMs = performance.now() - startedAt;
    if (referenceLoadAudit.completed % 24 === 0) renderLevelMenu();
  }
  game.loadLevel(LEVELS[0]);
  referenceLevelLibrary.clearRoomCache();
  referenceLoadAudit.running = false;
  referenceLoadAudit.elapsedMs = performance.now() - startedAt;
  renderLevelMenu();
}

function assertReferenceAcceptance(condition, message) {
  if (!condition) throw new Error(message);
}

function pointInsideLevelBounds(point, bounds, margin = 0) {
  return point.x >= bounds.x + margin
    && point.x <= bounds.x + bounds.w - margin
    && point.y >= bounds.y + margin
    && point.y <= bounds.y + bounds.h - margin;
}

function assertFiniteRuntimeState(roomId) {
  const playerValues = [game.player.x, game.player.y, game.player.vx, game.player.vy, game.player.health, game.player.energy];
  assertReferenceAcceptance(playerValues.every(Number.isFinite), `${roomId} 死亡重置后角色状态出现非有限数值`);
  for (const item of game.runtime.movingObjects) {
    assertReferenceAcceptance([item.x, item.y, item.deltaX, item.deltaY].every(Number.isFinite), `${roomId} 移动物件 ${item.id} 状态出现非有限数值`);
  }
  assertReferenceAcceptance(game.runtime.dashRefills.length === game.level.dashRefills.length, `${roomId} dashRefill 重置后数量变化`);
  assertReferenceAcceptance(game.runtime.movingObjects.length === game.level.movingObjects.length, `${roomId} 移动物件重置后数量变化`);
  assertReferenceAcceptance(game.runtime.launchers.length === game.level.launchers.length, `${roomId} 发射器重置后数量变化`);
  assertReferenceAcceptance(game.runtime.fragilePlatforms.length === game.level.fragilePlatforms.length, `${roomId} 碎裂平台重置后数量变化`);
  assertReferenceAcceptance(game.runtime.gates.length === game.level.gates.length, `${roomId} 门状态重置后数量变化`);
  assertReferenceAcceptance(game.runtime.stateTriggers.length === game.level.stateTriggers.length, `${roomId} 状态触发器重置后数量变化`);
}

async function runReferenceAcceptanceAudit(rooms) {
  if (referenceLoadAudit.running || referenceAcceptanceAudit.running || referenceContinuousAudit.running || rooms.length === 0) return;
  referenceAcceptanceAudit = {
    running: true,
    completed: 0,
    total: rooms.length,
    entranceChecks: 0,
    checkpointResetChecks: 0,
    connectionChecks: 0,
    mechanismCycles: 0,
    menuReentries: 0,
    renderedRooms: 0,
    peakActiveObjects: 0,
    peakCachedDocuments: 0,
    finalCachedDocuments: 0,
    failures: [],
    elapsedMs: 0
  };
  referenceLevelLibrary.clearRoomCache();
  renderLevelMenu();
  const startedAt = performance.now();

  for (const room of rooms) {
    try {
      const level = await referenceLevelLibrary.loadRoom(room.id);
      assertReferenceAcceptance(level.id === room.id, `${room.id} 编译后 ID 不一致`);
      assertReferenceAcceptance(pointInsideLevelBounds(level.spawn, level.bounds, game.player.radius), `${room.id} 默认出生超出合法边界`);

      for (const entrance of level.roomEntrances) {
        game.loadLevel(level, { entranceId: entrance.id });
        assertReferenceAcceptance(game.player.x === entrance.spawn.x && game.player.y === entrance.spawn.y, `${room.id} 入口 ${entrance.id} 未使用声明出生点`);
        assertReferenceAcceptance(pointInsideLevelBounds(entrance.spawn, level.bounds, game.player.radius), `${room.id} 入口 ${entrance.id} 出生超出合法边界`);
        referenceAcceptanceAudit.entranceChecks += 1;
      }

      for (const checkpoint of level.checkpoints) {
        game.loadLevel(level, { checkpointId: checkpoint.id });
        assertReferenceAcceptance(game.currentCheckpoint.id === checkpoint.id, `${room.id} 检查点 ${checkpoint.id} 未被选中`);
        assertReferenceAcceptance(pointInsideLevelBounds(checkpoint.spawn, level.bounds, game.player.radius), `${room.id} 检查点 ${checkpoint.id} 出生超出合法边界`);
        const resetPositions = new Map(game.runtime.movingObjects
          .filter((item) => item.resetPolicy === "death")
          .map((item) => [item.id, { x: item.x, y: item.y }]));
        game.runtime.exitCooldown = 999;
        for (let step = 0; step < 60; step += 1) game.updateRuntimeItems(TUNING.fixedStep);
        game.player.vx = 413;
        game.player.vy = -287;
        game.player.energy = 0;
        game.player.dashCharges = 0;
        game.beginRespawn("逐房验收重置");
        for (let step = 0; step < 240 && game.player.respawnTimer > 0; step += 1) game.update(TUNING.fixedStep);
        assertReferenceAcceptance(game.player.respawnTimer === 0, `${room.id} 检查点 ${checkpoint.id} 重生超时`);
        assertReferenceAcceptance(game.player.x === checkpoint.spawn.x && game.player.y === checkpoint.spawn.y, `${room.id} 检查点 ${checkpoint.id} 重生位置不一致`);
        assertReferenceAcceptance(game.player.vx === 0 && game.player.vy === 0, `${room.id} 检查点 ${checkpoint.id} 重生保留错误速度`);
        assertReferenceAcceptance(game.player.health === TUNING.maximumHealth && game.player.energy === TUNING.maximumEnergy, `${room.id} 检查点 ${checkpoint.id} 未恢复血量或蓝量`);
        assertReferenceAcceptance(game.player.dashCharges === game.player.maximumDashCharges, `${room.id} 检查点 ${checkpoint.id} 未恢复冲刺次数`);
        for (const item of game.runtime.movingObjects) {
          const expected = resetPositions.get(item.id);
          if (!expected) continue;
          assertReferenceAcceptance(Math.abs(item.x - expected.x) < 0.001 && Math.abs(item.y - expected.y) < 0.001, `${room.id} 移动物件 ${item.id} 未按 death 策略重置`);
        }
        assertFiniteRuntimeState(room.id);
        referenceAcceptanceAudit.checkpointResetChecks += 1;
        referenceAcceptanceAudit.mechanismCycles += 1;
      }

      for (const exit of level.roomExits) {
        const target = await referenceLevelLibrary.loadRoom(exit.targetRoomId);
        const targetEntrance = target.roomEntrances.find((entrance) => entrance.id === exit.targetEntranceId);
        assertReferenceAcceptance(Boolean(targetEntrance), `${room.id} 出口 ${exit.id} 缺少目标入口 ${exit.targetEntranceId}`);
        game.loadLevel(target, { entranceId: exit.targetEntranceId });
        assertReferenceAcceptance(game.level.id === exit.targetRoomId, `${room.id} 出口 ${exit.id} 目标房间加载错误`);
        assertReferenceAcceptance(game.player.x === targetEntrance.spawn.x && game.player.y === targetEntrance.spawn.y, `${room.id} 出口 ${exit.id} 目标入口出生错误`);
        referenceAcceptanceAudit.connectionChecks += 1;
      }

      game.loadLevel(level);
      game.render();
      referenceAcceptanceAudit.renderedRooms += 1;
      referenceAcceptanceAudit.peakActiveObjects = Math.max(referenceAcceptanceAudit.peakActiveObjects, game.debugStats.activeObjects);
      referenceAcceptanceAudit.peakCachedDocuments = Math.max(referenceAcceptanceAudit.peakCachedDocuments, referenceLevelLibrary.documentCache.size);
      game.openLevelMenu();
      assertReferenceAcceptance(!startCard.classList.contains("is-hidden") && game.running === false, `${room.id} 返回菜单失败`);
      referenceLevelLibrary.clearRoomCache(room.id);
      const reentered = await referenceLevelLibrary.loadRoom(room.id);
      game.loadLevel(reentered);
      assertReferenceAcceptance(game.level.id === room.id, `${room.id} 清理缓存后重新进入失败`);
      referenceAcceptanceAudit.menuReentries += 1;
    } catch (error) {
      console.error(error);
      referenceAcceptanceAudit.failures.push({ roomId: room.id, message: error.message });
    }
    referenceAcceptanceAudit.completed += 1;
    referenceAcceptanceAudit.elapsedMs = performance.now() - startedAt;
    if (referenceAcceptanceAudit.completed % 24 === 0) {
      renderLevelMenu();
      await nextBrowserFrame();
    }
  }

  game.loadLevel(LEVELS[0]);
  game.openLevelMenu();
  referenceLevelLibrary.clearRoomCache();
  referenceAcceptanceAudit.finalCachedDocuments = referenceLevelLibrary.documentCache.size;
  assertReferenceAcceptance(referenceAcceptanceAudit.finalCachedDocuments === 0, "逐房验收结束后参考房间缓存未清空");
  referenceAcceptanceAudit.running = false;
  referenceAcceptanceAudit.elapsedMs = performance.now() - startedAt;
  renderLevelMenu();
}

function waitForRoomTransition(targetRoomId, attempts = 120) {
  return new Promise((resolve, reject) => {
    let remaining = attempts;
    const check = () => {
      if (game.level.id === targetRoomId) {
        resolve();
        return;
      }
      remaining -= 1;
      if (remaining <= 0) {
        reject(new Error(`切房超时：${game.level.id} -> ${targetRoomId}`));
        return;
      }
      setTimeout(check, 0);
    };
    check();
  });
}

async function autoplaySequentialExit(targetRoomId, maximumSteps = 4200) {
  const sourceRoomId = game.level.id;
  const sequentialExit = (game.level.roomExits || []).find((exit) => exit.targetRoomId === targetRoomId);
  if (!sequentialExit) throw new Error(`${sourceRoomId} 缺少到 ${targetRoomId} 的顺序出口`);
  game.running = false;
  game.paused = false;
  game.runtime.exitCooldown = Math.min(game.runtime.exitCooldown, 0.05);
  let deaths = 0;
  let respawning = false;
  let furthestX = game.player.x;
  let previousX = game.player.x;
  let stagnantSteps = 0;
  for (let step = 0; step < maximumSteps; step += 1) {
    applyRightwardReferenceAutoplayInput(input, game.player, step, { stagnantSteps });
    game.update(TUNING.fixedStep);
    input.finishSimulationStep();
    stagnantSteps = game.player.x > previousX + 0.25 ? 0 : stagnantSteps + 1;
    previousX = game.player.x;
    furthestX = Math.max(furthestX, game.player.x);
    if (game.player.respawnTimer > 0 && !respawning) deaths += 1;
    respawning = game.player.respawnTimer > 0;
    if (game.runtime.transitioning) {
      clearReferenceAutoplayInput(input);
      await waitForRoomTransition(targetRoomId);
      game.running = false;
      return { sourceRoomId, targetRoomId, steps: step + 1, deaths, furthestX };
    }
    if (step > 0 && step % 720 === 0) await nextBrowserFrame();
  }
  clearReferenceAutoplayInput(input);
  throw new Error(`${sourceRoomId} 在 ${maximumSteps} 个固定步内未到达 ${targetRoomId}；最远 x=${furthestX.toFixed(1)}，死亡 ${deaths}`);
}

async function runReferenceContinuousAudit(collections) {
  if (referenceContinuousAudit.running || referenceLoadAudit.running || referenceAcceptanceAudit.running || collections.length === 0) return;
  const totalTransitions = collections.reduce((sum, collection) => sum + Math.max(0, collection.roomIds.length - 1), 0);
  referenceContinuousAudit = {
    running: true,
    collectionsCompleted: 0,
    totalCollections: collections.length,
    transitionsCompleted: 0,
    totalTransitions,
    deaths: 0,
    failures: [],
    collections: [],
    elapsedMs: 0
  };
  const startedAt = performance.now();
  renderLevelMenu();
  for (const collection of collections) {
    const collectionResult = { collectionId: collection.id, transitions: 0, deaths: 0, passed: false };
    try {
      await startReferenceRoom(collection.roomIds[0], { collectionId: collection.id, newRun: true });
      game.running = false;
      for (let index = 0; index < collection.roomIds.length - 1; index += 1) {
        const result = await autoplaySequentialExit(collection.roomIds[index + 1]);
        collectionResult.transitions += 1;
        collectionResult.deaths += result.deaths;
        referenceContinuousAudit.transitionsCompleted += 1;
        referenceContinuousAudit.deaths += result.deaths;
      }
      collectionResult.passed = true;
      referenceContinuousAudit.collectionsCompleted += 1;
    } catch (error) {
      console.error(error);
      referenceContinuousAudit.failures.push({
        collectionId: collection.id,
        roomId: game.level.id,
        message: error.message
      });
    }
    referenceContinuousAudit.collections.push(collectionResult);
    referenceContinuousAudit.elapsedMs = performance.now() - startedAt;
    renderLevelMenu();
    await nextBrowserFrame();
  }
  clearReferenceAutoplayInput(input);
  game.openLevelMenu();
  referenceContinuousAudit.running = false;
  referenceContinuousAudit.elapsedMs = performance.now() - startedAt;
  renderLevelMenu();
}

function createReferenceMenuTools(filteredCount, pageCount) {
  const tools = document.createElement("div");
  tools.className = "reference-menu-tools";

  const label = document.createElement("strong");
  label.textContent = `参考白盒库 · ${filteredCount}/${referenceRooms.length}`;

  const collection = document.createElement("select");
  collection.className = "reference-collection-filter";
  collection.setAttribute("aria-label", "按章节、Side 或区域筛选参考白盒");
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = `全部章节与区域（${referenceRooms.length}）`;
  collection.append(allOption);
  for (const item of referenceCollections) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = `${item.localName}（${item.roomIds.length}）`;
    collection.append(option);
  }
  collection.value = referenceCollectionFilter;
  collection.addEventListener("change", () => {
    referenceCollectionFilter = collection.value;
    referencePage = 0;
    renderLevelMenu();
  });

  const search = document.createElement("input");
  search.className = "reference-room-search";
  search.type = "search";
  search.placeholder = "搜索本地名、稳定 ID、房间 ID…";
  search.setAttribute("aria-label", "搜索参考白盒房间");
  search.value = referenceSearch;
  search.addEventListener("input", () => {
    referenceSearch = search.value;
    referencePage = 0;
    renderLevelMenu();
    const replacement = levelGrid.querySelector(".reference-room-search");
    if (replacement) {
      replacement.focus();
      replacement.setSelectionRange(referenceSearch.length, referenceSearch.length);
    }
  });

  const pagination = document.createElement("div");
  pagination.className = "reference-pagination";
  const previous = document.createElement("button");
  previous.type = "button";
  previous.textContent = "上一页";
  previous.disabled = referencePage <= 0;
  previous.addEventListener("click", () => {
    referencePage = Math.max(0, referencePage - 1);
    renderLevelMenu();
  });
  const page = document.createElement("span");
  page.setAttribute("aria-live", "polite");
  page.textContent = `${Math.min(referencePage + 1, Math.max(1, pageCount))} / ${Math.max(1, pageCount)}`;
  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "下一页";
  next.disabled = referencePage >= pageCount - 1;
  next.addEventListener("click", () => {
    referencePage = Math.min(Math.max(0, pageCount - 1), referencePage + 1);
    renderLevelMenu();
  });
  pagination.append(previous, page, next);
  const audit = document.createElement("button");
  audit.type = "button";
  audit.className = "reference-load-audit";
  audit.disabled = referenceLoadAudit.running || referenceAcceptanceAudit.running || referenceContinuousAudit.running;
  audit.title = "逐房验证本地获取、编译、运行时初始化与一帧绘制；不等于可玩性或连续通关验收。";
  if (referenceLoadAudit.running) {
    audit.textContent = `加载审计 ${referenceLoadAudit.completed}/${referenceLoadAudit.total}`;
  } else if (referenceLoadAudit.total > 0) {
    const seconds = (referenceLoadAudit.elapsedMs / 1000).toFixed(1);
    audit.textContent = referenceLoadAudit.failures.length === 0
      ? `加载通过 ${referenceLoadAudit.completed}/${referenceLoadAudit.total} · ${referenceLoadAudit.entrances} 入口 · ${seconds}s`
      : `加载失败 ${referenceLoadAudit.failures.length}/${referenceLoadAudit.total}`;
  } else {
    audit.textContent = "浏览器加载审计";
  }
  audit.addEventListener("click", () => runReferenceLoadAudit(filteredReferenceRooms()));
  const acceptanceAudit = document.createElement("button");
  acceptanceAudit.type = "button";
  acceptanceAudit.className = "reference-acceptance-audit";
  acceptanceAudit.disabled = referenceLoadAudit.running || referenceAcceptanceAudit.running || referenceContinuousAudit.running;
  acceptanceAudit.title = "逐房验证入口、检查点死亡重置、机关状态数值、全部出口目标入口、渲染、返回菜单与清缓存重进；主路线通关另由连续审计证明。";
  if (referenceAcceptanceAudit.running) {
    acceptanceAudit.textContent = `逐房综合验收 ${referenceAcceptanceAudit.completed}/${referenceAcceptanceAudit.total}`;
  } else if (referenceAcceptanceAudit.total > 0) {
    const seconds = (referenceAcceptanceAudit.elapsedMs / 1000).toFixed(1);
    acceptanceAudit.textContent = referenceAcceptanceAudit.failures.length === 0
      ? `逐房验收通过 ${referenceAcceptanceAudit.completed}/${referenceAcceptanceAudit.total} · ${referenceAcceptanceAudit.entranceChecks} 入口 · ${referenceAcceptanceAudit.checkpointResetChecks} 重置 · ${referenceAcceptanceAudit.connectionChecks} 连接 · ${referenceAcceptanceAudit.menuReentries} 重进 · 峰值 ${referenceAcceptanceAudit.peakActiveObjects} 物件 · 缓存 ${referenceAcceptanceAudit.finalCachedDocuments} · ${seconds}s`
      : `逐房验收失败 ${referenceAcceptanceAudit.failures.length}/${referenceAcceptanceAudit.total}`;
  } else {
    acceptanceAudit.textContent = "浏览器逐房综合验收";
  }
  acceptanceAudit.addEventListener("click", () => runReferenceAcceptanceAudit(referenceRooms));
  const continuousAudit = document.createElement("button");
  continuousAudit.type = "button";
  continuousAudit.className = "reference-continuous-audit";
  continuousAudit.disabled = referenceLoadAudit.running || referenceAcceptanceAudit.running || referenceContinuousAudit.running;
  continuousAudit.title = "用真实移动、跳跃、冲刺、碰撞、死亡重置和切房处理器自动跑完 44 个集合的顺序主路线；不代替全部支路或保真验收。";
  if (referenceContinuousAudit.running) {
    continuousAudit.textContent = `自动主路线 ${referenceContinuousAudit.collections.length}/${referenceContinuousAudit.totalCollections} · ${referenceContinuousAudit.transitionsCompleted}/${referenceContinuousAudit.totalTransitions}`;
  } else if (referenceContinuousAudit.totalCollections > 0) {
    const seconds = (referenceContinuousAudit.elapsedMs / 1000).toFixed(1);
    continuousAudit.textContent = referenceContinuousAudit.failures.length === 0
      ? `自动主路线通过 ${referenceContinuousAudit.collectionsCompleted}/${referenceContinuousAudit.totalCollections} · ${referenceContinuousAudit.transitionsCompleted} 转场 · ${referenceContinuousAudit.deaths} 重置 · ${seconds}s`
      : `自动主路线失败 ${referenceContinuousAudit.failures.length}/${referenceContinuousAudit.totalCollections}`;
  } else {
    continuousAudit.textContent = "自动连续验收全部主路线";
  }
  continuousAudit.addEventListener("click", () => runReferenceContinuousAudit(referenceCollections));
  const continuousStart = document.createElement("button");
  continuousStart.type = "button";
  continuousStart.className = "reference-continuous-start";
  const selectedCollection = referenceCollections.find((item) => item.id === referenceCollectionFilter);
  continuousStart.disabled = !selectedCollection || referenceLoadAudit.running || referenceAcceptanceAudit.running || referenceContinuousAudit.running;
  continuousStart.textContent = selectedCollection ? "从首房连续开始" : "选择集合后连续试玩";
  continuousStart.title = "从所选 Side 或 Ori 区域的首房开始，切房时保留能力、世界标记和访问记录。";
  continuousStart.addEventListener("click", async () => {
    if (!selectedCollection) return;
    await startReferenceRoom(selectedCollection.roomIds[0], { collectionId: selectedCollection.id, newRun: true });
  });
  tools.append(label, collection, search, pagination, continuousStart, audit, acceptanceAudit, continuousAudit);
  return tools;
}

function renderLevelMenu() {
  levelGrid.replaceChildren();
  for (const level of [...LEVELS, ...customLevels]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "level-button";
    button.dataset.category = level.category;
    if (level.category === "单项3C") button.dataset.godotReady = String(isGodotSyncReady(level));

    const category = document.createElement("span");
    category.className = "level-category";
    category.textContent = level.category;
    const name = document.createElement("span");
    name.className = "level-name";
    name.textContent = levelDisplayName(level);
    const acceptance = document.createElement("span");
    acceptance.className = "level-acceptance";
    acceptance.textContent = isGodotSyncReady(level)
      ? "Godot 同步开发已开放"
      : "Web 验证中 · 暂不同步 Godot";
    const summary = document.createElement("span");
    summary.className = "level-summary";
    summary.textContent = level.summary;
    button.append(category, name);
    if (level.category === "单项3C") button.append(acceptance);
    button.append(summary);

    button.addEventListener("click", async () => {
      button.disabled = true;
      const generation = levelStartCoordinator.begin();
      game.visualLoadCoordinator.invalidate();
      const index = LEVELS.indexOf(level);
      const adjacentLevels = index >= 0 ? [LEVELS[index - 1], LEVELS[index + 1]].filter(Boolean) : [];
      try {
        if (await game.startPrepared(level, {}, adjacentLevels) && levelStartCoordinator.isCurrent(generation)) {
          startCard.classList.add("is-hidden");
          canvas.focus();
        }
      } catch (error) {
        console.error(error);
        game.openLevelMenu();
        game.showToast("关卡视觉素材准备失败，请重试", 1.8, "warning");
      } finally {
        button.disabled = false;
      }
    });
    levelGrid.append(button);
  }
  if (referenceRooms.length > 0) {
    const filtered = filteredReferenceRooms();
    const pageCount = Math.max(1, Math.ceil(filtered.length / REFERENCE_PAGE_SIZE));
    referencePage = Math.min(referencePage, pageCount - 1);
    levelGrid.append(createReferenceMenuTools(filtered.length, pageCount));
  }
  const filtered = filteredReferenceRooms();
  const visibleReferenceRooms = filtered.slice(referencePage * REFERENCE_PAGE_SIZE, (referencePage + 1) * REFERENCE_PAGE_SIZE);
  for (const room of visibleReferenceRooms) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "level-button";
    button.dataset.category = "参考白盒";
    const category = document.createElement("span");
    category.className = "level-category";
    category.textContent = room.game === "celeste" ? "CELESTE 白盒" : "ORI DE 白盒";
    const name = document.createElement("span");
    name.className = "level-name";
    name.textContent = room.localName;
    const summary = document.createElement("span");
    summary.className = "level-summary";
    summary.textContent = `${room.mapType} · ${room.status.playable} · 按需加载本地 JSON`;
    button.append(category, name, summary);
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const collection = referenceCollectionByRoom.get(room.id);
        await startReferenceRoom(room.id, { collectionId: collection?.id, newRun: true });
      } catch (error) {
        console.error(error);
        referenceLoadError = error.message;
        renderLevelMenu();
      } finally {
        button.disabled = false;
      }
    });
    levelGrid.append(button);
  }
  if (referenceLoadError) {
    const errorCard = document.createElement("button");
    errorCard.type = "button";
    errorCard.className = "level-button";
    errorCard.dataset.category = "参考白盒";
    errorCard.disabled = true;
    const category = document.createElement("span");
    category.className = "level-category";
    category.textContent = "参考库加载失败";
    const summary = document.createElement("span");
    summary.className = "level-summary";
    summary.textContent = referenceLoadError;
    errorCard.append(category, summary);
    levelGrid.append(errorCard);
  }
  if (referenceRooms.length > 0 && visibleReferenceRooms.length === 0) {
    const empty = document.createElement("p");
    empty.className = "reference-empty-state";
    empty.textContent = "没有匹配的参考白盒；可清空搜索或切换章节/区域。";
    levelGrid.append(empty);
  }
}

const levelEditor = createLevelEditor({
  root: levelEditorRoot,
  sourceLevels: LEVELS,
  onPlay(level) {
    const generation = levelStartCoordinator.begin();
    game.visualLoadCoordinator.invalidate();
    void game.startPrepared(level)
      .then((started) => {
        if (!started || !levelStartCoordinator.isCurrent(generation)) return;
        levelEditor.close();
        startCard.classList.add("is-hidden");
        canvas.focus();
      })
      .catch((error) => {
        console.error(error);
        game.openLevelMenu();
        game.showToast("试玩素材准备失败，请重试", 1.8, "warning");
      });
  },
  onSavedLevelsChange(levels) {
    customLevels = levels;
    renderLevelMenu();
  }
});

async function startReferenceRoom(roomId, { collectionId = null, entranceId = null, newRun = false } = {}) {
  const generation = levelStartCoordinator.begin();
  const wasRunning = game.running;
  const wasTransitioning = Boolean(game.runtime?.transitioning);
  const previousAbilities = [...(game.abilities || [])];
  const previousFlags = [...(game.runtime?.flags || [])];
  const previousRunState = referenceRunState;
  game.visualLoadCoordinator.invalidate();
  game.running = false;
  try {
    const neighborhood = await referenceLevelLibrary.preloadRoomNeighborhood(roomId);
    if (!levelStartCoordinator.isCurrent(generation)) return false;
    const level = neighborhood.levels.get(roomId);
    if (!level) {
      const failure = neighborhood.errors.find((item) => item.roomId === roomId)?.error;
      throw failure || new Error(`Unable to prepare reference room: ${roomId}`);
    }
    const documentData = await referenceLevelLibrary.loadRoomDocument(roomId);
    const adjacentLevels = [...neighborhood.levels.entries()]
      .filter(([candidateId]) => candidateId !== roomId)
      .map(([, candidateLevel]) => candidateLevel);
    const startsNewRun = newRun || !previousRunState;
    const preparedAbilities = startsNewRun
      ? level.startingAbilities
      : [...new Set([...previousRunState.abilities, ...previousAbilities])];
    const preparedFlags = startsNewRun ? [] : previousFlags;
    const started = await game.startPrepared(level, {
      entranceId,
      abilities: preparedAbilities,
      flags: preparedFlags,
      checkpointId: startsNewRun ? null : previousRunState.checkpoints.get(roomId) || null
    }, adjacentLevels);
    if (started) {
      if (startsNewRun) {
        referenceRunState = new ReferenceRunState(collectionId || "reference.unassigned", roomId, {
          abilities: level.startingAbilities
        });
      } else {
        referenceRunState = previousRunState;
        for (const abilityId of previousAbilities) referenceRunState.recordAbility(abilityId);
        referenceRunState.replaceFlags(previousFlags);
        referenceRunState.enterRoom(roomId, entranceId);
      }
      levelEditor.addSourceDocuments([documentData]);
      startCard.classList.add("is-hidden");
      canvas.focus();
    }
    return started;
  } catch (error) {
    if (levelStartCoordinator.isCurrent(generation)) {
      game.running = wasRunning;
      if (game.runtime) game.runtime.transitioning = wasTransitioning;
    }
    throw error;
  }
}

game.setRoomExitHandler(async (exit) => {
  if (referenceRunState && game.currentCheckpoint?.id) {
    referenceRunState.recordCheckpoint(game.level.id, game.currentCheckpoint.id);
  }
  const target = referenceLevelLibrary.roomMetadata(exit.targetRoomId);
  if (!target) {
    game.runtime.transitioning = false;
    game.runtime.exitCooldown = 1;
    game.showToast("目标房间尚未进入当前制作批次", 1.5, "warning");
    return;
  }
  await startReferenceRoom(exit.targetRoomId, {
    collectionId: referenceRunState?.collectionId,
    entranceId: exit.targetEntranceId,
    newRun: false
  });
});

openLevelEditorButton.addEventListener("click", () => levelEditor.open());
renderLevelMenu();

referenceLevelLibrary.loadIndex()
  .then((index) => {
    referenceCollections = index.collections;
    referenceRooms = Object.values(index.rooms);
    referenceCollectionByRoom = new Map(referenceCollections.flatMap((collection) => collection.roomIds.map((roomId) => [roomId, collection])));
    referenceLoadError = null;
    renderLevelMenu();
  })
  .catch((error) => {
    console.error(error);
    referenceLoadError = error.message;
    renderLevelMenu();
  });

window.cablester = game;
window.cablesterReference = {
  library: referenceLevelLibrary,
  runLoadAudit: () => runReferenceLoadAudit(referenceRooms),
  runAcceptanceAudit: () => runReferenceAcceptanceAudit(referenceRooms),
  runContinuousAudit: () => runReferenceContinuousAudit(referenceCollections),
  get runState() { return referenceRunState?.snapshot() || null; },
  get loadAudit() { return structuredClone(referenceLoadAudit); },
  get acceptanceAudit() { return structuredClone(referenceAcceptanceAudit); },
  get continuousAudit() { return structuredClone(referenceContinuousAudit); }
};
}
