export const PROTOTYPE_LEVEL = {
  id: "movement-lab-01",
  name: "软绳实验场",
  category: "单项3C",
  acceptanceLevel: "L1",
  summary: "方向吸附、物理摆荡、空中加速收绳和连续换绳。",
  startingAbilities: ["rope", "dash", "wallGrab"],
  bounds: { x: -500, y: -350, w: 4100, h: 1700 },
  spawn: { x: 160, y: 590 },
  backgroundSeeds: [
    { x: 120, y: 240, size: 130 },
    { x: 890, y: 180, size: 210 },
    { x: 1620, y: 330, size: 150 },
    { x: 2420, y: 180, size: 260 },
    { x: 3040, y: 420, size: 190 }
  ],
  platforms: [
    { id: "start-ground", x: -420, y: 640, w: 920, h: 180 },
    { id: "island-a", x: 710, y: 600, w: 250, h: 100 },
    { id: "island-b", x: 1110, y: 505, w: 170, h: 62 },
    { id: "island-c", x: 1430, y: 630, w: 190, h: 120 },
    { id: "island-d", x: 1760, y: 520, w: 150, h: 66 },
    { id: "runway", x: 2070, y: 640, w: 390, h: 180 },
    { id: "chamber-left", x: 2440, y: 70, w: 55, h: 630 },
    { id: "chamber-top", x: 2440, y: 70, w: 760, h: 55 },
    { id: "chamber-floor", x: 2440, y: 650, w: 760, h: 55 },
    { id: "chamber-right", x: 3145, y: 70, w: 55, h: 635 },
    { id: "chamber-step-a", x: 2730, y: 530, w: 130, h: 35 },
    { id: "chamber-step-b", x: 2860, y: 310, w: 160, h: 35 }
  ],
  slopes: [
    { id: "slope-rib-a", ax: 410, ay: 315, bx: 680, by: 235, thickness: 14, grapple: true },
    { id: "ceiling-rib-a", ax: 820, ay: 185, bx: 1120, by: 185, thickness: 14, grapple: true },
    { id: "slope-rib-b", ax: 1230, ay: 195, bx: 1450, by: 305, thickness: 14, grapple: true },
    { id: "wall-rib-a", ax: 1680, ay: 170, bx: 1680, by: 420, thickness: 14, grapple: true },
    { id: "chamber-slope", ax: 2730, ay: 430, bx: 2950, by: 230, thickness: 16, grapple: true }
  ],
  hazards: [
    { id: "spikes-a", x: 500, y: 628, w: 210, h: 72, damage: 1 },
    { id: "spikes-b", x: 960, y: 655, w: 150, h: 65, damage: 1 },
    { id: "spikes-c", x: 1280, y: 655, w: 150, h: 70, damage: 1 },
    { id: "spikes-d", x: 1620, y: 655, w: 140, h: 70, damage: 1 },
    { id: "chamber-spikes", x: 3070, y: 570, w: 75, h: 80, damage: 1 }
  ],
  anchors: [
    { id: "a01", x: 530, y: 340, type: "both" },
    { id: "a02", x: 775, y: 250, type: "rope" },
    { id: "a03", x: 1015, y: 310, type: "both" },
    { id: "a04", x: 1265, y: 235, type: "rope" },
    { id: "a05", x: 1495, y: 350, type: "both" },
    { id: "a06", x: 1710, y: 250, type: "rope" },
    { id: "a07", x: 1970, y: 315, type: "both" },
    { id: "a08", x: 2260, y: 360, type: "rope" },
    { id: "r01", x: 2630, y: 420, type: "both" },
    { id: "r02", x: 2820, y: 260, type: "rope" },
    { id: "r03", x: 3000, y: 180, type: "both" }
  ],
  energyOrbs: [
    { id: "e01", x: 650, y: 350, amount: 1.0 },
    { id: "e02", x: 900, y: 285, amount: 1.0 },
    { id: "e03", x: 1160, y: 300, amount: 1.0 },
    { id: "e04", x: 1390, y: 330, amount: 1.0 },
    { id: "e05", x: 1640, y: 310, amount: 1.0 },
    { id: "e06", x: 1900, y: 350, amount: 1.0 },
    { id: "e07", x: 2180, y: 420, amount: 1.25 },
    { id: "e08", x: 2690, y: 300, amount: 1.5 },
    { id: "e09", x: 2860, y: 190, amount: 1.5 }
  ],
  bashTargets: [],
  windZones: [],
  abilityPickups: [
    { id: "ability-double-jump", x: 1515, y: 575, abilityId: "doubleJump", source: "prototype-key-item" }
  ],
  checkpoints: [
    { id: "cp-start", x: 115, y: 550, w: 90, h: 90, spawn: { x: 160, y: 590 } },
    { id: "cp-runway", x: 2130, y: 550, w: 90, h: 90, spawn: { x: 2175, y: 590 } },
    { id: "cp-chamber", x: 2510, y: 555, w: 90, h: 95, spawn: { x: 2555, y: 600 } }
  ],
  rotationTriggers: [
    { id: "rotate-chamber", x: 2600, y: 525, w: 120, h: 125, delta: Math.PI / 2 }
  ],
  goal: { id: "goal", x: 3060, y: 260, radius: 38 },
  signs: [
    { id: "sign-start", x: 250, y: 585, text: "左键出绳 · 松开回收 · 绳上按住W / ↑快速收绳" },
    { id: "sign-bar", x: 1160, y: 445, text: "F连接角色与命中面 · 再按F释放" },
    { id: "sign-rotation", x: 2210, y: 585, text: "前方空间会旋转 · 输入仍按屏幕方向" }
  ]
};
