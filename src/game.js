import { ABILITIES, KNOWN_ABILITY_IDS, TUNING, VIEWPORT } from "./config.js";
import { syncCanvasBackingStore } from "./display.js";
import { LEVELS } from "./levels.js";
import { validateLevel } from "./level-validator.js";
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

const canvas = document.querySelector("#game");
const context = canvas.getContext("2d");
const startCard = document.querySelector("#start-card");
const levelGrid = document.querySelector("#level-grid");

for (const level of LEVELS) {
  const levelErrors = validateLevel(level);
  if (levelErrors.length > 0) throw new Error(`${level.id}:\n${levelErrors.join("\n")}`);
}

class Input {
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

class Game {
  constructor(ctx, input, levels) {
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
    this.loadLevel(levels[0]);
    this.frameRequest = requestAnimationFrame((timestamp) => this.frame(timestamp));
  }

  loadLevel(level) {
    this.level = level;
    this.elapsed = 0;
    this.accumulator = 0;
    this.toast = { text: "", time: 0, tone: "normal" };
    this.particles = new ParticleField();
    this.camera = {
      x: level.spawn.x,
      y: level.spawn.y - 30,
      angle: 0,
      rotation: null
    };
    this.runtime = {
      energyOrbs: level.energyOrbs.map((orb) => ({ ...orb, available: true, respawnTimer: 0 })),
      abilityPickups: level.abilityPickups.map((pickup) => ({ ...pickup, collected: false })),
      bashTargets: level.bashTargets.map((target) => ({ ...target, cooldown: 0 })),
      bashAim: null,
      rotationTriggers: level.rotationTriggers.map((trigger) => ({ ...trigger, activated: false })),
      goalReached: false,
      hardBar: null
    };
    const startingAbilities = level.startingAbilities?.length
      ? level.startingAbilities
      : Object.values(ABILITIES).filter((ability) => ability.defaultUnlocked).map((ability) => ability.id);
    this.abilities = new Set(startingAbilities);
    this.currentCheckpoint = level.checkpoints[0];
    this.blockingSurfaces = this.buildBlockingSurfaces();
    this.grappleSurfaces = this.blockingSurfaces.filter((surface) => surface.grapple);
    this.hardBarSurfaces = [...this.grappleSurfaces, ...this.buildHazardAttachmentSurfaces()];
    this.player = this.createPlayer(level.spawn);
    this.ropeTarget = null;
    this.hardBarTarget = null;
    this.bashTarget = null;
    this.ropeWinching = false;
  }

  createPlayer(spawn) {
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
      updraftExitTimer: 0,
      dashAvailable: this.abilities?.has("dash") || false,
      dashTimer: 0,
      dashDirectionX: 0,
      dashDirectionY: 0,
      timeSinceEnergyUse: 99,
      respawnTimer: 0,
      visible: true,
      facing: 1,
      distanceTravelled: 0,
      previousX: spawn.x,
      previousY: spawn.y
    };
  }

  start(level) {
    if (level) this.loadLevel(level);
    this.running = true;
    this.paused = false;
    this.lastTimestamp = performance.now();
    this.showToast(`${levelDisplayName(this.level)} · 先观察，再连续通过`, 3.2);
  }

  openLevelMenu() {
    this.running = false;
    this.paused = false;
    this.input.keys.clear();
    startCard.classList.remove("is-hidden");
  }

  frame(timestamp) {
    const rawDelta = this.lastTimestamp ? (timestamp - this.lastTimestamp) / 1000 : 0;
    this.lastTimestamp = timestamp;
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

  update(deltaTime) {
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

    if (wasGrounded && this.abilities.has("dash")) player.dashAvailable = true;

    let moveAxis = 0;
    if (this.input.down("KeyA", "ArrowLeft")) moveAxis -= 1;
    if (this.input.down("KeyD", "ArrowRight")) moveAxis += 1;
    let verticalAxis = 0;
    if (this.input.down("KeyW", "ArrowUp")) verticalAxis -= 1;
    if (this.input.down("KeyS", "ArrowDown")) verticalAxis += 1;
    if (moveAxis !== 0) player.facing = moveAxis;

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

    player.vx += gravity.x * TUNING.gravity * gravityScale * deltaTime;
    player.vy += gravity.y * TUNING.gravity * gravityScale * deltaTime;

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

    player.x += player.vx * deltaTime;
    player.y += player.vy * deltaTime;
    this.constrainRope();
    this.constrainHardBar();
    this.resolveCollisions();
    this.constrainHardBar();
    this.updateRopeVisual(deltaTime);

    player.distanceTravelled += length(player.x - player.previousX, player.y - player.previousY);
    if (player.grounded) {
      player.airJumps = this.abilities.has("doubleJump") ? 1 : 0;
      player.dashAvailable = this.abilities.has("dash");
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
  }

  handleDashInput(horizontalAxis, verticalAxis) {
    const player = this.player;
    if (!this.input.pressed("ControlLeft") && !this.input.pressed("ControlRight")) return false;
    if (!this.abilities.has("dash") || !player.dashAvailable) {
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
    player.dashAvailable = false;
    player.grounded = false;
    player.gliding = false;
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

    for (const anchor of this.level.anchors) {
      const offsetX = anchor.x - this.player.x;
      const offsetY = anchor.y - this.player.y;
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
    }

    candidates.sort((left, right) => left.score - right.score || left.id.localeCompare(right.id));
    this.ropeTarget = this.abilities.has("rope") ? candidates[0] || null : null;

    hardBarCandidates.sort((left, right) => left.score - right.score || left.id.localeCompare(right.id));
    this.hardBarTarget = this.abilities.has("hardBar") ? hardBarCandidates[0] || null : null;

    const pointerScreen = this.input.mouse;
    const bashCandidates = this.runtime.bashTargets
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
    for (const platform of this.level.platforms) {
      surfaces.push(
        { id: `${platform.id}:top`, kind: "platform", grapple: true, ax: platform.x, ay: platform.y, bx: platform.x + platform.w, by: platform.y },
        { id: `${platform.id}:right`, kind: "platform", grapple: true, ax: platform.x + platform.w, ay: platform.y, bx: platform.x + platform.w, by: platform.y + platform.h },
        { id: `${platform.id}:bottom`, kind: "platform", grapple: true, ax: platform.x + platform.w, ay: platform.y + platform.h, bx: platform.x, by: platform.y + platform.h },
        { id: `${platform.id}:left`, kind: "platform", grapple: true, ax: platform.x, ay: platform.y + platform.h, bx: platform.x, by: platform.y }
      );
    }
    for (const slope of this.level.slopes || []) {
      surfaces.push({ ...slope, kind: "slope", grapple: Boolean(slope.grapple) });
    }
    return surfaces;
  }

  buildHazardAttachmentSurfaces() {
    return this.level.hazards.map(hazardHardBarSurface);
  }

  resolveCollisions() {
    const player = this.player;
    const gravity = this.gravityDirection();
    const tangent = this.screenRightDirection();
    player.grounded = false;
    player.wallNormal = null;

    for (let pass = 0; pass < 3; pass += 1) {
      let resolvedAny = false;
      for (const platform of this.level.platforms) {
        const contact = this.resolveCircleRect(platform);
        if (!contact) continue;
        resolvedAny = true;
        this.recordContact(contact, gravity, tangent);
      }
      for (const slope of this.level.slopes || []) {
        const contact = this.resolveCircleSegment(slope);
        if (!contact) continue;
        resolvedAny = true;
        this.recordContact(contact, gravity, tangent);
      }
      for (const hazard of this.level.hazards) {
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
    for (const hazard of this.level.hazards) {
      if (circleIntersectsRect(player.x, player.y, player.radius, hazard)) {
        this.damagePlayer(hazard.damage, hazard);
      }
    }

    for (const orb of this.runtime.energyOrbs) {
      if (!orb.available || length(player.x - orb.x, player.y - orb.y) > player.radius + 16) continue;
      orb.available = false;
      orb.respawnTimer = 7;
      player.energy = restoreResource(player.energy, orb.amount, TUNING.maximumEnergy);
      this.particles.burst(orb.x, orb.y, "#63bfff", 14, 145);
    }

    for (const pickup of this.runtime.abilityPickups) {
      if (pickup.collected || length(player.x - pickup.x, player.y - pickup.y) > player.radius + 24) continue;
      pickup.collected = true;
      const result = grantAbility(this.abilities, pickup.abilityId, KNOWN_ABILITY_IDS);
      if (result.granted) {
        player.airJumps = pickup.abilityId === "doubleJump" ? 1 : player.airJumps;
        player.dashAvailable = pickup.abilityId === "dash" ? true : player.dashAvailable;
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

    if (!this.runtime.goalReached && isGoalReached(player, this.level.goal, TUNING.goalActivationPadding)) {
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
    for (const orb of this.runtime.energyOrbs) {
      if (orb.available) continue;
      orb.respawnTimer -= deltaTime;
      if (orb.respawnTimer <= 0) orb.available = true;
    }
    for (const target of this.runtime.bashTargets) {
      target.cooldown = Math.max(0, target.cooldown - deltaTime);
    }
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
      updraftExitTimer: 0,
      dashAvailable: this.abilities.has("dash"),
      dashTimer: 0,
      dashDirectionX: 0,
      dashDirectionY: 0,
      timeSinceEnergyUse: 99,
      respawnTimer: 0,
      visible: true
    });
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
    this.renderBackground(ctx);
    ctx.save();
    ctx.translate(VIEWPORT.width / 2, VIEWPORT.height / 2);
    ctx.rotate(this.camera.angle);
    ctx.translate(-this.camera.x, -this.camera.y);
    this.renderWorld(ctx);
    ctx.restore();
    this.renderPlayer(ctx);
    this.renderBashAimOverlay(ctx);
    this.renderHud(ctx);
    if (this.paused) this.renderPause(ctx);
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
    for (const seed of this.level.backgroundSeeds) this.renderBackgroundSeed(ctx, seed);
    for (const wind of this.level.windZones) this.renderWindZone(ctx, wind);
    for (const platform of this.level.platforms) this.renderPlatform(ctx, platform);
    for (const slope of this.level.slopes || []) this.renderSlope(ctx, slope);
    for (const hazard of this.level.hazards) this.renderHazard(ctx, hazard);
    for (const checkpoint of this.level.checkpoints) this.renderCheckpoint(ctx, checkpoint);
    for (const sign of this.level.signs) this.renderSign(ctx, sign);
    for (const orb of this.runtime.energyOrbs) if (orb.available) this.renderEnergyOrb(ctx, orb);
    for (const pickup of this.runtime.abilityPickups) if (!pickup.collected) this.renderAbilityPickup(ctx, pickup);
    for (const target of this.runtime.bashTargets) this.renderBashTarget(ctx, target);
    this.renderGoal(ctx);
    this.renderHardBar(ctx);
    this.renderRope(ctx);
    this.renderSurfaceTarget(ctx);
    this.renderHardBarTarget(ctx);
    for (const anchor of this.level.anchors) this.renderAnchor(ctx, anchor);
    this.particles.render(ctx);

    if (this.debug) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
      ctx.lineWidth = 1;
      ctx.strokeRect(this.level.bounds.x, this.level.bounds.y, this.level.bounds.w, this.level.bounds.h);
    }
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
    const angle = Math.atan2(speedScreen.y, speedScreen.x);
    const movingFast = length(speedScreen.x, speedScreen.y) > 450;
    ctx.save();
    ctx.translate(screen.x, screen.y);
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
    if (movingFast && !this.player.gliding) ctx.rotate(angle);
    const flash = this.player.invulnerability > 0 && Math.floor(this.player.invulnerability * 18) % 2 === 0;
    ctx.globalAlpha = flash ? 0.35 : 1;
    const dashing = this.player.dashTimer > 0;
    ctx.shadowColor = dashing ? "#8fdfff" : "#a8fff5";
    ctx.shadowBlur = dashing ? 38 : movingFast ? 26 : 17;
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
    ctx.fillStyle = dashing ? "#dff7ff" : "#e8fffb";
    ctx.beginPath();
    ctx.ellipse(0, 0, movingFast ? 23 : 18, movingFast ? 14 : 19, 0, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#2d7278";
    const eyeX = movingFast ? 7 : this.player.facing * 6;
    ctx.beginPath();
    ctx.arc(eyeX, -4, 2.5, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(171, 255, 247, 0.65)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-10, 11);
    ctx.quadraticCurveTo(-22, 24, -29, 12);
    ctx.stroke();
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
      ctx.save();
      ctx.translate(268, 64);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = this.player.dashAvailable ? "#9be7ff" : "rgba(116, 195, 218, 0.15)";
      ctx.shadowColor = "#76d9ff";
      ctx.shadowBlur = this.player.dashAvailable ? 12 : 0;
      ctx.fillRect(-8, -8, 16, 16);
      ctx.restore();
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
    const lines = [
      `position ${formatNumber(this.player.x)} / ${formatNumber(this.player.y)}`,
      `velocity ${formatNumber(this.player.vx)} / ${formatNumber(this.player.vy)}`,
      `gravity ${formatNumber(gravity.x, 2)} / ${formatNumber(gravity.y, 2)}`,
      `camera ${(this.camera.angle * 180 / Math.PI).toFixed(0)}°`,
      `render ${this.displayMetrics?.width || canvas.width}×${this.displayMetrics?.height || canvas.height}  ${this.displayMetrics?.scale.toFixed(2) || "1.00"}x`,
      `grounded ${this.player.grounded}  rope ${this.player.rope?.phase || "—"}  dash ${this.player.dashAvailable}`,
      `checkpoint ${this.currentCheckpoint.id}`,
      `abilities ${[...this.abilities].join(", ")}`
    ];
    ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
    roundedRect(ctx, VIEWPORT.width - 340, 80, 312, lines.length * 20 + 22, 12);
    ctx.fill();
    ctx.fillStyle = "#a8ebe8";
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "left";
    lines.forEach((line, index) => ctx.fillText(line, VIEWPORT.width - 322, 106 + index * 20));
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

const input = new Input(canvas);
const game = new Game(context, input, LEVELS);

for (const level of LEVELS) {
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

  button.addEventListener("click", () => {
    startCard.classList.add("is-hidden");
    canvas.focus();
    game.start(level);
  });
  levelGrid.append(button);
}

window.cablester = game;
