import { PROTOTYPE_LEVEL } from "./level.js";
import { compileLevelWithArtPreset } from "./level-art-presets.js";

function labLevel(definition) {
  return {
    category: "单项3C",
    summary: "",
    startingAbilities: ["wallGrab"],
    bounds: { x: -500, y: -350, w: 3600, h: 1600 },
    backgroundSeeds: [],
    platforms: [],
    slopes: [],
    hazards: [],
    anchors: [],
    energyOrbs: [],
    abilityPickups: [],
    bashTargets: [],
    windZones: [],
    checkpoints: [],
    rotationTriggers: [],
    signs: [],
    ...definition
  };
}

const HARD_BAR_LAB = labLevel({
  id: "hard-bar-lab",
  name: "硬杆实验场",
  acceptanceLevel: "L0",
  summary: "连接角色与命中面，以固定长度绕支点完成撑杆跳。",
  startingAbilities: ["hardBar", "dash", "wallGrab"],
  spawn: { x: 120, y: 590 },
  backgroundSeeds: [
    { x: 420, y: 260, size: 150 }, { x: 1120, y: 220, size: 210 }, { x: 1900, y: 330, size: 180 }
  ],
  platforms: [
    { id: "hb-start", x: -350, y: 640, w: 760, h: 180 },
    { id: "hb-island-a", x: 690, y: 570, w: 190, h: 100 },
    { id: "hb-island-b", x: 1120, y: 455, w: 210, h: 95 },
    { id: "hb-island-c", x: 1570, y: 610, w: 230, h: 120 },
    { id: "hb-goal-ground", x: 2050, y: 520, w: 620, h: 220 }
  ],
  hazards: [
    { id: "hb-hazard-a", x: 410, y: 640, w: 280, h: 130, damage: 1 },
    { id: "hb-hazard-b", x: 880, y: 640, w: 240, h: 130, damage: 1 },
    { id: "hb-hazard-c", x: 1330, y: 640, w: 240, h: 130, damage: 1 },
    { id: "hb-hazard-d", x: 1800, y: 640, w: 250, h: 130, damage: 1 }
  ],
  anchors: [],
  energyOrbs: [
    { id: "hb-e1", x: 760, y: 520, amount: 1.5 },
    { id: "hb-e2", x: 1200, y: 405, amount: 1.5 },
    { id: "hb-e3", x: 1650, y: 560, amount: 1.5 }
  ],
  checkpoints: [
    { id: "hb-cp-start", x: 80, y: 550, w: 90, h: 90, spawn: { x: 125, y: 590 } },
    { id: "hb-cp-mid", x: 1600, y: 520, w: 90, h: 90, spawn: { x: 1645, y: 555 } }
  ],
  goal: { id: "hb-goal", x: 2460, y: 460, radius: 34 },
  signs: [
    { id: "hb-sign-a", x: 250, y: 585, text: "硬杆可撑在墙地、斜面或伤害区底座 · F连接" },
    { id: "hb-sign-b", x: 1200, y: 395, text: "Space撑杆起跳 · A/D切向加减速 · F释放" }
  ]
});

const BASH_LAB = labLevel({
  id: "bash-lab",
  name: "猛击实验场",
  acceptanceLevel: "L1",
  summary: "靠近六边支点后进入短暂时停，选择方向再高速弹射。",
  startingAbilities: ["bash", "wallGrab"],
  spawn: { x: 120, y: 590 },
  backgroundSeeds: [
    { x: 500, y: 300, size: 170 }, { x: 1030, y: 300, size: 230 }, { x: 1680, y: 260, size: 150 }
  ],
  platforms: [
    { id: "bash-start", x: -300, y: 640, w: 650, h: 180 },
    { id: "bash-rest", x: 710, y: 590, w: 150, h: 65 },
    { id: "bash-goal-ground", x: 1220, y: 600, w: 760, h: 180 }
  ],
  hazards: [
    { id: "bash-pit-a", x: 350, y: 690, w: 360, h: 90, damage: 1 },
    { id: "bash-pit-b", x: 860, y: 690, w: 360, h: 90, damage: 1 }
  ],
  bashTargets: [
    { id: "bash-t0", x: 270, y: 520 },
    { id: "bash-t1", x: 430, y: 520 },
    { id: "bash-t2", x: 565, y: 405 },
    { id: "bash-t3", x: 710, y: 295 },
    { id: "bash-t4", x: 855, y: 405 },
    { id: "bash-t5", x: 1000, y: 520 }
  ],
  energyOrbs: [
    { id: "bash-e1", x: 570, y: 365, amount: 1 },
    { id: "bash-e2", x: 860, y: 365, amount: 1 }
  ],
  checkpoints: [
    { id: "bash-cp-start", x: 70, y: 550, w: 90, h: 90, spawn: { x: 115, y: 590 } },
    { id: "bash-cp-end", x: 1290, y: 510, w: 90, h: 90, spawn: { x: 1335, y: 555 } }
  ],
  goal: { id: "bash-goal", x: 1760, y: 540, radius: 34 },
  signs: [
    { id: "bash-sign", x: 230, y: 585, text: "靠近六边支点 · 按住Q选向 · 松开立即猛击" }
  ]
});

const DOUBLE_JUMP_LAB = labLevel({
  id: "double-jump-lab",
  name: "二段跳实验场",
  acceptanceLevel: "L1",
  summary: "测试补救跳、延迟二跳、低顶空间和跨越伤害区。",
  startingAbilities: ["doubleJump", "wallGrab"],
  spawn: { x: 100, y: 590 },
  backgroundSeeds: [
    { x: 360, y: 220, size: 140 }, { x: 980, y: 260, size: 180 }, { x: 1640, y: 200, size: 220 }
  ],
  platforms: [
    { id: "dj-start", x: -300, y: 640, w: 600, h: 170 },
    { id: "dj-step-a", x: 470, y: 535, w: 115, h: 70 },
    { id: "dj-step-b", x: 720, y: 415, w: 120, h: 70 },
    { id: "dj-ceiling", x: 900, y: 250, w: 390, h: 45 },
    { id: "dj-step-c", x: 990, y: 515, w: 125, h: 70 },
    { id: "dj-step-d", x: 1320, y: 390, w: 120, h: 70 },
    { id: "dj-goal-ground", x: 1600, y: 570, w: 620, h: 190 }
  ],
  hazards: [
    { id: "dj-h1", x: 300, y: 680, w: 170, h: 90, damage: 1 },
    { id: "dj-h2", x: 585, y: 680, w: 135, h: 90, damage: 1 },
    { id: "dj-h3", x: 840, y: 680, w: 150, h: 90, damage: 1 },
    { id: "dj-h4", x: 1115, y: 680, w: 205, h: 90, damage: 1 },
    { id: "dj-h5", x: 1440, y: 680, w: 160, h: 90, damage: 1 }
  ],
  checkpoints: [
    { id: "dj-cp-start", x: 55, y: 550, w: 90, h: 90, spawn: { x: 100, y: 590 } },
    { id: "dj-cp-mid", x: 1010, y: 425, w: 80, h: 90, spawn: { x: 1050, y: 465 } }
  ],
  goal: { id: "dj-goal", x: 1990, y: 510, radius: 34 },
  signs: [
    { id: "dj-sign", x: 190, y: 585, text: "Space起跳 · 空中再次Space" },
    { id: "dj-sign-delay", x: 1080, y: 460, text: "延迟第二跳可以获得更远距离" }
  ]
});

const GLIDE_LAB = labLevel({
  id: "glide-lab",
  name: "滑翔实验场",
  acceptanceLevel: "L0",
  summary: "从高处跨越长距离，利用上升与横向气流调整航线。",
  startingAbilities: ["glide", "wallGrab"],
  spawn: { x: 80, y: 235 },
  bounds: { x: -500, y: -450, w: 3500, h: 1800 },
  backgroundSeeds: [
    { x: 500, y: 280, size: 220 }, { x: 1120, y: 160, size: 170 }, { x: 1860, y: 300, size: 240 }
  ],
  platforms: [
    { id: "glide-start", x: -300, y: 285, w: 540, h: 80 },
    { id: "glide-landing-a", x: 720, y: 590, w: 250, h: 110 },
    { id: "glide-launch-b", x: 1080, y: 430, w: 240, h: 85 },
    { id: "glide-landing-b", x: 1740, y: 570, w: 260, h: 120 },
    { id: "glide-goal-ground", x: 2180, y: 470, w: 520, h: 210 }
  ],
  hazards: [
    { id: "glide-valley-a", x: 240, y: 735, w: 480, h: 100, damage: 1 },
    { id: "glide-valley-b", x: 970, y: 735, w: 770, h: 100, damage: 1 },
    { id: "glide-valley-c", x: 2000, y: 735, w: 180, h: 100, damage: 1 }
  ],
  windZones: [
    { id: "wind-up-a", x: 390, y: 230, w: 190, h: 510, forceX: 0, forceY: -520 },
    { id: "wind-right-a", x: 1320, y: 250, w: 350, h: 430, forceX: 300, forceY: -90 },
    { id: "wind-up-b", x: 2050, y: 310, w: 130, h: 420, forceX: 0, forceY: -610 }
  ],
  checkpoints: [
    { id: "glide-cp-start", x: 35, y: 195, w: 90, h: 90, spawn: { x: 80, y: 235 } },
    { id: "glide-cp-mid", x: 1125, y: 340, w: 90, h: 90, spawn: { x: 1170, y: 380 } }
  ],
  goal: { id: "glide-goal", x: 2500, y: 410, radius: 34 },
  signs: [
    { id: "glide-sign", x: 115, y: 230, text: "下落时按住Space展开滑翔" },
    { id: "glide-sign-wind", x: 1450, y: 330, text: "风场会强化滑翔升力与横向位移 · A/D微调" }
  ]
});

const DASH_LAB = labLevel({
  id: "dash-lab",
  name: "冲刺实验场",
  acceptanceLevel: "L0",
  summary: "验证当前朝向、八方向空中冲刺、落地恢复和高速接绳接杆。",
  startingAbilities: ["dash", "rope", "hardBar", "wallGrab"],
  bounds: { x: -500, y: -500, w: 3500, h: 1800 },
  spawn: { x: 100, y: 590 },
  backgroundSeeds: [
    { x: 430, y: 210, size: 170 }, { x: 1180, y: 300, size: 220 }, { x: 2050, y: 180, size: 180 }
  ],
  platforms: [
    { id: "dash-start", x: -300, y: 640, w: 650, h: 180 },
    { id: "dash-low-a", x: 610, y: 590, w: 170, h: 90 },
    { id: "dash-high-a", x: 910, y: 390, w: 170, h: 70 },
    { id: "dash-low-b", x: 1270, y: 610, w: 170, h: 90 },
    { id: "dash-high-b", x: 1590, y: 330, w: 190, h: 70 },
    { id: "dash-low-c", x: 1940, y: 590, w: 190, h: 90 },
    { id: "dash-goal-ground", x: 2420, y: 500, w: 520, h: 230 }
  ],
  slopes: [
    { id: "dash-slope-a", ax: 420, ay: 350, bx: 650, by: 260, thickness: 14, grapple: true },
    { id: "dash-slope-b", ax: 1810, ay: 260, bx: 2060, by: 350, thickness: 14, grapple: true }
  ],
  hazards: [
    { id: "dash-h1", x: 350, y: 700, w: 260, h: 90, damage: 1 },
    { id: "dash-h2", x: 780, y: 700, w: 490, h: 90, damage: 1 },
    { id: "dash-h3", x: 1440, y: 700, w: 500, h: 90, damage: 1 },
    { id: "dash-h4", x: 2130, y: 700, w: 290, h: 90, damage: 1 }
  ],
  anchors: [
    { id: "dash-a1", x: 520, y: 300, type: "rope" },
    { id: "dash-a2", x: 1210, y: 280, type: "both" },
    { id: "dash-a3", x: 1870, y: 230, type: "rope" },
    { id: "dash-a4", x: 2290, y: 320, type: "both" }
  ],
  energyOrbs: [
    { id: "dash-e1", x: 680, y: 520, amount: 1 },
    { id: "dash-e2", x: 1320, y: 540, amount: 1 },
    { id: "dash-e3", x: 2020, y: 520, amount: 1 }
  ],
  checkpoints: [
    { id: "dash-cp-start", x: 55, y: 550, w: 90, h: 90, spawn: { x: 100, y: 590 } },
    { id: "dash-cp-mid", x: 1295, y: 520, w: 90, h: 90, spawn: { x: 1340, y: 560 } }
  ],
  goal: { id: "dash-goal", x: 2740, y: 440, radius: 34 },
  signs: [
    { id: "dash-sign-a", x: 210, y: 585, text: "Ctrl按朝向冲刺 · W/A/S/D + Ctrl八方向" },
    { id: "dash-sign-b", x: 1030, y: 335, text: "空中一次 · 落地恢复" },
    { id: "dash-sign-c", x: 1720, y: 275, text: "冲刺途中接绳或硬杆会继承速度" }
  ]
});

const HIGH_SPEED_LAB = labLevel({
  id: "combined-speed",
  name: "综合 · 高速连段",
  category: "综合关卡",
  summary: "用摆荡、猛击和二段跳保持动量，尽量不落地。",
  startingAbilities: ["rope", "hardBar", "bash", "doubleJump", "glide", "dash", "wallGrab"],
  bounds: { x: -500, y: -500, w: 4700, h: 1900 },
  spawn: { x: 100, y: 590 },
  backgroundSeeds: [
    { x: 600, y: 240, size: 230 }, { x: 1550, y: 280, size: 180 }, { x: 2450, y: 200, size: 250 }, { x: 3350, y: 330, size: 210 }
  ],
  platforms: [
    { id: "speed-start", x: -350, y: 640, w: 620, h: 180 },
    { id: "speed-touch-a", x: 930, y: 585, w: 150, h: 70 },
    { id: "speed-touch-b", x: 1810, y: 500, w: 140, h: 70 },
    { id: "speed-touch-c", x: 2730, y: 610, w: 150, h: 90 },
    { id: "speed-goal", x: 3550, y: 540, w: 520, h: 220 }
  ],
  slopes: [
    { id: "speed-slope-a", ax: 330, ay: 330, bx: 650, by: 220, thickness: 14, grapple: true },
    { id: "speed-slope-b", ax: 1180, ay: 230, bx: 1470, by: 340, thickness: 14, grapple: true },
    { id: "speed-slope-c", ax: 2120, ay: 300, bx: 2440, by: 185, thickness: 14, grapple: true },
    { id: "speed-slope-d", ax: 3020, ay: 230, bx: 3320, by: 330, thickness: 14, grapple: true }
  ],
  hazards: [
    { id: "speed-h1", x: 270, y: 700, w: 660, h: 100, damage: 1 },
    { id: "speed-h2", x: 1080, y: 700, w: 730, h: 100, damage: 1 },
    { id: "speed-h3", x: 1950, y: 700, w: 780, h: 100, damage: 1 },
    { id: "speed-h4", x: 2880, y: 700, w: 670, h: 100, damage: 1 }
  ],
  anchors: [
    { id: "speed-a1", x: 520, y: 270, type: "rope" },
    { id: "speed-a2", x: 840, y: 245, type: "both" },
    { id: "speed-a3", x: 1410, y: 285, type: "rope" },
    { id: "speed-a4", x: 1740, y: 240, type: "both" },
    { id: "speed-a5", x: 2350, y: 245, type: "rope" },
    { id: "speed-a6", x: 2650, y: 300, type: "both" },
    { id: "speed-a7", x: 3240, y: 285, type: "rope" }
  ],
  bashTargets: [
    { id: "speed-b1", x: 1110, y: 420 },
    { id: "speed-b2", x: 2020, y: 390 },
    { id: "speed-b3", x: 2950, y: 430 }
  ],
  energyOrbs: Array.from({ length: 11 }, (_, index) => ({
    id: `speed-e${index + 1}`,
    x: 500 + index * 285,
    y: 340 - (index % 3) * 45,
    amount: 0.8
  })),
  checkpoints: [
    { id: "speed-cp-start", x: 55, y: 550, w: 90, h: 90, spawn: { x: 100, y: 590 } },
    { id: "speed-cp-mid", x: 1835, y: 410, w: 90, h: 90, spawn: { x: 1880, y: 450 } },
    { id: "speed-cp-end", x: 2760, y: 520, w: 90, h: 90, spawn: { x: 2805, y: 560 } }
  ],
  goal: { id: "speed-goal-marker", x: 3880, y: 480, radius: 34 },
  signs: [
    { id: "speed-sign", x: 180, y: 585, text: "目标：尽量不断速、少落地" }
  ]
});

const HORIZONTAL_LAB = labLevel({
  id: "combined-horizontal",
  name: "综合 · 水平穿越",
  category: "综合关卡",
  summary: "长距离横向路线，包含多种安全线与高速捷径。",
  startingAbilities: ["rope", "hardBar", "bash", "doubleJump", "glide", "dash", "wallGrab"],
  bounds: { x: -500, y: -450, w: 5600, h: 1900 },
  spawn: { x: 100, y: 590 },
  backgroundSeeds: Array.from({ length: 6 }, (_, index) => ({ x: 450 + index * 820, y: 200 + index % 2 * 140, size: 150 + index % 3 * 45 })),
  platforms: [
    { id: "hor-start", x: -350, y: 640, w: 780, h: 180 },
    { id: "hor-low-a", x: 650, y: 610, w: 310, h: 120 },
    { id: "hor-high-a", x: 1130, y: 430, w: 260, h: 90 },
    { id: "hor-low-b", x: 1560, y: 620, w: 360, h: 150 },
    { id: "hor-high-b", x: 2130, y: 350, w: 280, h: 80 },
    { id: "hor-low-c", x: 2600, y: 600, w: 320, h: 140 },
    { id: "hor-high-c", x: 3200, y: 410, w: 260, h: 80 },
    { id: "hor-low-d", x: 3690, y: 620, w: 320, h: 140 },
    { id: "hor-goal-ground", x: 4300, y: 540, w: 600, h: 220 }
  ],
  slopes: [
    { id: "hor-s1", ax: 430, ay: 300, bx: 720, by: 220, thickness: 14, grapple: true },
    { id: "hor-s2", ax: 1450, ay: 250, bx: 1740, by: 350, thickness: 14, grapple: true },
    { id: "hor-s3", ax: 2470, ay: 280, bx: 2760, by: 180, thickness: 14, grapple: true },
    { id: "hor-s4", ax: 3500, ay: 230, bx: 3820, by: 350, thickness: 14, grapple: true }
  ],
  hazards: [
    { id: "hor-h1", x: 430, y: 700, w: 220, h: 90, damage: 1 },
    { id: "hor-h2", x: 960, y: 700, w: 600, h: 90, damage: 1 },
    { id: "hor-h3", x: 1920, y: 700, w: 680, h: 90, damage: 1 },
    { id: "hor-h4", x: 2920, y: 700, w: 770, h: 90, damage: 1 },
    { id: "hor-h5", x: 4010, y: 700, w: 290, h: 90, damage: 1 }
  ],
  anchors: Array.from({ length: 12 }, (_, index) => ({
    id: `hor-a${index + 1}`,
    x: 560 + index * 330,
    y: 250 + index % 3 * 65,
    type: index % 3 === 1 ? "both" : "rope"
  })),
  bashTargets: [
    { id: "hor-b1", x: 1040, y: 520 }, { id: "hor-b2", x: 2020, y: 480 },
    { id: "hor-b3", x: 3020, y: 500 }, { id: "hor-b4", x: 4100, y: 480 }
  ],
  energyOrbs: Array.from({ length: 14 }, (_, index) => ({ id: `hor-e${index + 1}`, x: 520 + index * 290, y: 360 - index % 2 * 70, amount: 0.75 })),
  checkpoints: [
    { id: "hor-cp-start", x: 55, y: 550, w: 90, h: 90, spawn: { x: 100, y: 590 } },
    { id: "hor-cp-a", x: 1610, y: 530, w: 90, h: 90, spawn: { x: 1655, y: 570 } },
    { id: "hor-cp-b", x: 2650, y: 510, w: 90, h: 90, spawn: { x: 2695, y: 550 } },
    { id: "hor-cp-c", x: 3740, y: 530, w: 90, h: 90, spawn: { x: 3785, y: 570 } }
  ],
  goal: { id: "hor-goal", x: 4680, y: 480, radius: 34 },
  signs: [{ id: "hor-sign", x: 190, y: 585, text: "下层更安全 · 上层速度更快" }]
});

const VERTICAL_LAB = labLevel({
  id: "combined-vertical",
  name: "综合 · 垂直升降",
  category: "综合关卡",
  summary: "向上攀升后高速下降，练习重力方向上的连续判断。",
  startingAbilities: ["rope", "hardBar", "bash", "doubleJump", "glide", "dash", "wallGrab"],
  bounds: { x: -600, y: -1850, w: 2300, h: 2850 },
  spawn: { x: 120, y: 590 },
  backgroundSeeds: Array.from({ length: 7 }, (_, index) => ({ x: 150 + index % 3 * 420, y: 420 - index * 280, size: 130 + index % 3 * 50 })),
  platforms: [
    { id: "vert-base", x: -280, y: 640, w: 900, h: 180 },
    { id: "vert-p1", x: 500, y: 380, w: 190, h: 60 },
    { id: "vert-p2", x: 80, y: 100, w: 180, h: 60 },
    { id: "vert-p3", x: 620, y: -180, w: 190, h: 60 },
    { id: "vert-p4", x: 160, y: -500, w: 190, h: 60 },
    { id: "vert-p5", x: 680, y: -810, w: 190, h: 60 },
    { id: "vert-p6", x: 220, y: -1120, w: 190, h: 60 },
    { id: "vert-top", x: 500, y: -1430, w: 600, h: 90 }
  ],
  slopes: [
    { id: "vert-s1", ax: 260, ay: 260, bx: 480, by: 80, thickness: 14, grapple: true },
    { id: "vert-s2", ax: 360, ay: -300, bx: 620, by: -470, thickness: 14, grapple: true },
    { id: "vert-s3", ax: 380, ay: -870, bx: 650, by: -1040, thickness: 14, grapple: true }
  ],
  hazards: [
    { id: "vert-h1", x: -80, y: 250, w: 140, h: 210, damage: 1 },
    { id: "vert-h2", x: 850, y: -430, w: 110, h: 300, damage: 1 },
    { id: "vert-h3", x: -40, y: -1050, w: 120, h: 300, damage: 1 }
  ],
  anchors: Array.from({ length: 10 }, (_, index) => ({
    id: `vert-a${index + 1}`,
    x: index % 2 === 0 ? 370 : 650,
    y: 420 - index * 175,
    type: index % 3 === 2 ? "both" : "rope"
  })),
  bashTargets: Array.from({ length: 6 }, (_, index) => ({ id: `vert-b${index + 1}`, x: index % 2 === 0 ? 520 : 300, y: 250 - index * 275 })),
  windZones: [
    { id: "vert-wind-up", x: 400, y: -1180, w: 150, h: 1050, forceX: 0, forceY: -420 },
    { id: "vert-wind-down", x: 900, y: -1400, w: 150, h: 1450, forceX: 0, forceY: 330 }
  ],
  energyOrbs: Array.from({ length: 9 }, (_, index) => ({ id: `vert-e${index + 1}`, x: index % 2 === 0 ? 440 : 610, y: 320 - index * 190, amount: 1 })),
  checkpoints: [
    { id: "vert-cp-start", x: 70, y: 550, w: 90, h: 90, spawn: { x: 115, y: 590 } },
    { id: "vert-cp-mid", x: 185, y: -590, w: 90, h: 90, spawn: { x: 230, y: -540 } },
    { id: "vert-cp-top", x: 540, y: -1520, w: 90, h: 90, spawn: { x: 585, y: -1470 } }
  ],
  goal: { id: "vert-goal", x: 980, y: -1240, radius: 34 },
  signs: [
    { id: "vert-sign-a", x: 220, y: 585, text: "先向上攀升 · 顶部向右进入下降通道" },
    { id: "vert-sign-b", x: 790, y: -1370, text: "按住Space滑翔控制下降" }
  ]
});

const HAZARD_LAB = labLevel({
  id: "combined-hazards",
  name: "综合 · 伤害走廊",
  category: "综合关卡",
  summary: "密集伤害区、连续恢复跳和短检查点的容错测试。",
  startingAbilities: ["rope", "hardBar", "bash", "doubleJump", "glide", "dash", "wallGrab"],
  bounds: { x: -500, y: -450, w: 4300, h: 1800 },
  spawn: { x: 100, y: 590 },
  backgroundSeeds: [
    { x: 500, y: 220, size: 180 }, { x: 1300, y: 330, size: 220 }, { x: 2200, y: 210, size: 160 }, { x: 3100, y: 300, size: 240 }
  ],
  platforms: [
    { id: "haz-start", x: -300, y: 640, w: 620, h: 170 },
    { id: "haz-p1", x: 520, y: 560, w: 190, h: 90 },
    { id: "haz-p2", x: 900, y: 430, w: 210, h: 80 },
    { id: "haz-p3", x: 1320, y: 600, w: 220, h: 100 },
    { id: "haz-p4", x: 1740, y: 390, w: 200, h: 80 },
    { id: "haz-p5", x: 2150, y: 590, w: 230, h: 100 },
    { id: "haz-p6", x: 2600, y: 440, w: 220, h: 80 },
    { id: "haz-goal-ground", x: 3070, y: 570, w: 600, h: 190 }
  ],
  slopes: [
    { id: "haz-s1", ax: 360, ay: 310, bx: 610, by: 240, thickness: 14, grapple: true },
    { id: "haz-s2", ax: 1160, ay: 240, bx: 1410, by: 330, thickness: 14, grapple: true },
    { id: "haz-s3", ax: 2000, ay: 280, bx: 2260, by: 190, thickness: 14, grapple: true }
  ],
  hazards: [
    { id: "haz-h1", x: 320, y: 650, w: 200, h: 100, damage: 1 },
    { id: "haz-h2", x: 710, y: 650, w: 190, h: 100, damage: 1 },
    { id: "haz-h3", x: 1110, y: 650, w: 210, h: 100, damage: 1 },
    { id: "haz-h4", x: 1540, y: 650, w: 200, h: 100, damage: 1 },
    { id: "haz-h5", x: 1940, y: 650, w: 210, h: 100, damage: 1 },
    { id: "haz-h6", x: 2380, y: 650, w: 220, h: 100, damage: 1 },
    { id: "haz-h7", x: 2820, y: 650, w: 250, h: 100, damage: 1 },
    { id: "haz-ceiling-a", x: 760, y: 210, w: 120, h: 150, damage: 1, direction: "down" },
    { id: "haz-wall-a", x: 1590, y: 280, w: 90, h: 220, damage: 1, direction: "left" },
    { id: "haz-ceiling-b", x: 2460, y: 180, w: 120, h: 180, damage: 1, direction: "down" }
  ],
  anchors: Array.from({ length: 9 }, (_, index) => ({ id: `haz-a${index + 1}`, x: 450 + index * 330, y: 260 + index % 2 * 80, type: index % 3 === 1 ? "both" : "rope" })),
  bashTargets: [
    { id: "haz-b1", x: 800, y: 510 }, { id: "haz-b2", x: 1640, y: 540 }, { id: "haz-b3", x: 2470, y: 520 }
  ],
  energyOrbs: Array.from({ length: 10 }, (_, index) => ({ id: `haz-e${index + 1}`, x: 430 + index * 295, y: 410 - index % 2 * 80, amount: 0.9 })),
  checkpoints: [
    { id: "haz-cp-start", x: 55, y: 550, w: 90, h: 90, spawn: { x: 100, y: 590 } },
    { id: "haz-cp-a", x: 1350, y: 510, w: 90, h: 90, spawn: { x: 1395, y: 550 } },
    { id: "haz-cp-b", x: 2180, y: 500, w: 90, h: 90, spawn: { x: 2225, y: 540 } },
    { id: "haz-cp-c", x: 3100, y: 480, w: 90, h: 90, spawn: { x: 3145, y: 520 } }
  ],
  goal: { id: "haz-goal", x: 3480, y: 510, radius: 34 },
  signs: [
    { id: "haz-sign", x: 190, y: 585, text: "伤害坑底可碰撞 · 每秒扣1血 · Space脱离" }
  ]
});

export const LEGACY_LEVELS = Object.freeze([
  PROTOTYPE_LEVEL,
  HARD_BAR_LAB,
  BASH_LAB,
  DOUBLE_JUMP_LAB,
  GLIDE_LAB,
  DASH_LAB,
  HIGH_SPEED_LAB,
  HORIZONTAL_LAB,
  VERTICAL_LAB,
  HAZARD_LAB
]);

export const LEVELS = Object.freeze(LEGACY_LEVELS.map((level) => compileLevelWithArtPreset(level)));

export const LEVEL_BY_ID = new Map(LEVELS.map((level) => [level.id, level]));
