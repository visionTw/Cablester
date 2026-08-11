const partition = (id, localName, mapType = "medium-area", notes = "") => ({
  id,
  localName,
  mapType,
  notes
});

export const ORI_AREAS = Object.freeze([
  {
    id: "swallows-nest",
    referenceName: "Swallow's Nest",
    localName: "归巢林地",
    mapType: "medium-area",
    requiredAbilities: ["jump"],
    mechanics: ["prologue-movement", "scripted-world-state", "safe-exploration"],
    partitions: [
      partition("home-clearing", "林居空地", "compact-room"),
      partition("storm-path", "风暴山径", "escape-segment"),
      partition("withered-return", "枯林归途", "medium-area")
    ]
  },
  {
    id: "sunken-glades",
    referenceName: "Sunken Glades",
    localName: "沉谷",
    mapType: "large-continuous-area",
    requiredAbilities: ["jump", "spiritFlame", "wallGrab"],
    mechanics: ["breakable-wall", "pushable-boulder", "spirit-gate", "poison-water", "ability-gate", "return-route"],
    partitions: [
      partition("revival-basin", "复苏洼地"),
      partition("sein-cavern", "微光洞室", "compact-room"),
      partition("first-gate-hub", "初门枢纽", "large-continuous-area"),
      partition("lower-ponds", "下层水洼"),
      partition("spirit-well-junction", "灵泉路口"),
      partition("western-return", "西侧回访支路"),
      partition("black-root-junction", "暗根岔口")
    ]
  },
  {
    id: "spirit-caverns",
    referenceName: "Spirit Caverns",
    localName: "灵息洞窟",
    mapType: "medium-area",
    requiredAbilities: ["jump", "spiritFlame", "wallGrab"],
    mechanics: ["rotating-hazard", "pushable-boulder", "projectile-hazard", "map-stone", "ability-pickup"],
    partitions: [
      partition("lower-entry", "下层入口"),
      partition("map-stone-loop", "地图石环路"),
      partition("rotor-boulder", "旋棘推石室", "compact-room"),
      partition("wall-jump-tree", "蹬墙古树", "compact-room"),
      partition("upper-shortcut", "上层捷径")
    ]
  },
  {
    id: "hollow-grove",
    referenceName: "Hollow Grove",
    localName: "空心林",
    mapType: "large-continuous-area",
    requiredAbilities: ["wallGrab", "chargeFlame", "doubleJump"],
    mechanics: ["breakable-wall", "vertical-climb", "ability-gate", "branching-route", "return-route"],
    partitions: [
      partition("eastern-ascent", "东侧攀径"),
      partition("spirit-tree-approach", "灵树前庭"),
      partition("charge-flame-tree", "蓄焰古树", "compact-room"),
      partition("upper-canopy", "上层林冠"),
      partition("stomp-gate", "震地封口"),
      partition("valley-exit", "风谷出口"),
      partition("revisit-secrets", "回访秘径")
    ]
  },
  {
    id: "moon-grotto",
    referenceName: "Moon Grotto",
    localName: "月影洞",
    mapType: "large-continuous-area",
    requiredAbilities: ["wallGrab", "doubleJump", "bash", "stomp"],
    mechanics: ["trap-bridge", "projectile-bash", "vertical-descent", "stomp-floor", "water-state", "return-route"],
    partitions: [
      partition("western-descent", "西侧深降"),
      partition("trap-bridge-chase", "落桥追逐", "escape-segment"),
      partition("lower-grotto", "下层洞厅"),
      partition("gumo-junction", "古莫岔口"),
      partition("stomp-tree", "震地古树", "compact-room"),
      partition("flooded-return", "净水回路"),
      partition("deep-optional", "深穴支路")
    ]
  },
  {
    id: "gumos-hideout",
    referenceName: "Gumo's Hideout",
    localName: "石匠隐所",
    mapType: "medium-area",
    requiredAbilities: ["wallGrab", "doubleJump"],
    mechanics: ["chase", "falling-platform", "switch-door", "key-item", "one-way-exit"],
    partitions: [
      partition("chase-entry", "追踪入口", "escape-segment"),
      partition("trap-corridors", "机关回廊"),
      partition("water-vein-vault", "水脉密室", "compact-room"),
      partition("return-ascent", "返程升井")
    ]
  },
  {
    id: "thornfelt-swamp",
    referenceName: "Thornfelt Swamp",
    localName: "刺泽",
    mapType: "large-continuous-area",
    requiredAbilities: ["wallGrab", "doubleJump", "bash", "stomp"],
    mechanics: ["poison-water", "clean-water-state", "projectile-bash", "stomp-floor", "return-route"],
    partitions: [
      partition("poisoned-approach", "毒水前路"),
      partition("ginso-gate", "巨树门径"),
      partition("restored-basin", "复流泽地"),
      partition("stomp-branch", "震地支路"),
      partition("revisit-secrets", "水下回访")
    ]
  },
  {
    id: "ginso-tree",
    referenceName: "Ginso Tree",
    localName: "涌泉巨树",
    mapType: "large-continuous-area",
    requiredAbilities: ["wallGrab", "doubleJump", "bash"],
    mechanics: ["portal", "projectile-bash", "rising-liquid", "escape-autoscroll", "one-way-state-change"],
    partitions: [
      partition("base-entry", "树根入口"),
      partition("lower-portals", "下层折跃"),
      partition("bash-tree", "猛击古树", "compact-room"),
      partition("middle-portals", "中层折跃"),
      partition("upper-projectiles", "上层弹道"),
      partition("heart-chamber", "水心密室", "compact-room"),
      partition("escape-lower", "洪流下段", "escape-segment"),
      partition("escape-crown", "洪流树冠", "escape-segment")
    ]
  },
  {
    id: "black-root-burrows",
    referenceName: "Black Root Burrows",
    localName: "暗根洞群",
    mapType: "large-continuous-area",
    requiredAbilities: ["wallGrab", "dash", "stomp"],
    mechanics: ["darkness", "light-orb-escort", "lantern-switch", "moving-platform", "ability-gate", "return-route"],
    partitions: [
      partition("dark-entry", "暗幕入口"),
      partition("light-orb-escort", "携光通道"),
      partition("lantern-network", "灯阵平台群"),
      partition("statue-chamber", "石像厅", "compact-room"),
      partition("dash-tree", "疾行古树", "compact-room"),
      partition("stomp-gate", "深层封口")
    ]
  },
  {
    id: "lost-grove",
    referenceName: "Lost Grove",
    localName: "遗落林",
    mapType: "large-continuous-area",
    requiredAbilities: ["wallGrab", "dash", "stomp", "lightBurst"],
    mechanics: ["moving-hazard", "moving-platform", "light-burst-lantern", "projectile-bash", "return-route"],
    partitions: [
      partition("deep-descent", "深林下降"),
      partition("moving-hazards", "游移险道"),
      partition("memory-clearing", "旧忆空地", "compact-room"),
      partition("light-burst-tree", "光弹古树", "compact-room"),
      partition("lantern-ascent", "点灯升路"),
      partition("return-loop", "归路环线")
    ]
  },
  {
    id: "valley-of-the-wind",
    referenceName: "Valley of the Wind",
    localName: "风隙谷",
    mapType: "large-continuous-area",
    requiredAbilities: ["bash", "stomp", "glide"],
    mechanics: ["strong-wind", "projectile-bash", "glide", "pursuit", "vertical-ascent"],
    partitions: [
      partition("southern-entry", "南侧谷口"),
      partition("wind-ravine", "横风裂谷"),
      partition("kuro-pursuit", "黑翼追袭", "escape-segment"),
      partition("feather-landing", "羽落台地", "compact-room"),
      partition("western-ascent", "西壁攀升"),
      partition("sorrow-junction", "哀峰岔口")
    ]
  },
  {
    id: "misty-woods",
    referenceName: "Misty Woods",
    localName: "迷雾林",
    mapType: "large-continuous-area",
    requiredAbilities: ["bash", "stomp", "glide"],
    mechanics: ["reconfiguring-map", "one-way-route", "projectile-bash", "key-gate", "world-state-change"],
    partitions: [
      partition("fog-entry", "雾林入口"),
      partition("shifting-path-one", "变径一段"),
      partition("atsu-climb", "古树攀径"),
      partition("keystone-branch", "钥石支路"),
      partition("shifting-path-two", "变径二段"),
      partition("gumon-seal", "风印密坛", "compact-room"),
      partition("restored-return", "定形归路")
    ]
  },
  {
    id: "forlorn-ruins",
    referenceName: "Forlorn Ruins",
    localName: "寒遗迹",
    mapType: "large-continuous-area",
    requiredAbilities: ["bash", "stomp", "glide", "gravityCarry"],
    mechanics: ["gravity-field", "carry-object", "laser", "crush-hazard", "escape-sequence", "one-way-state-change"],
    partitions: [
      partition("snowfield-approach", "雪原前路"),
      partition("lower-ruins", "遗迹下层"),
      partition("gravity-vessel", "重力载体室", "compact-room"),
      partition("left-key-branch", "左侧钥路"),
      partition("right-key-branch", "右侧钥路"),
      partition("element-chamber", "风心密室", "compact-room"),
      partition("escape-shaft", "崩落竖井", "escape-segment"),
      partition("escape-surface", "雪面逃离", "escape-segment")
    ]
  },
  {
    id: "kuros-nest",
    referenceName: "Kuro's Nest",
    localName: "黑翼巢地",
    mapType: "medium-area",
    requiredAbilities: ["glide"],
    mechanics: ["stealth-cover", "pursuit", "key-item", "one-way-exit"],
    partitions: [
      partition("nest-approach", "巢地前路"),
      partition("feather-retrieval", "遗羽台", "compact-room"),
      partition("covered-retreat", "遮蔽退路", "escape-segment")
    ]
  },
  {
    id: "sorrow-pass",
    referenceName: "Sorrow Pass",
    localName: "哀风峰",
    mapType: "large-continuous-area",
    requiredAbilities: ["bash", "glide", "lightBurst", "chargeJump"],
    mechanics: ["updraft", "projectile-bash", "light-burst-lantern", "vertical-ascent", "ability-gate", "return-shortcut"],
    partitions: [
      partition("lower-ascent", "下峰攀路"),
      partition("updraft-cavern", "升流洞厅"),
      partition("lantern-branch", "光弹灯路"),
      partition("charge-jump-tree", "蓄跃古树", "compact-room"),
      partition("upper-winds", "高空风道"),
      partition("sunstone-shrine", "日石祭台", "compact-room"),
      partition("descent-shortcut", "回落捷径")
    ]
  },
  {
    id: "mount-horu",
    referenceName: "Mount Horu",
    localName: "熔火山心",
    mapType: "large-continuous-area",
    requiredAbilities: ["bash", "stomp", "glide", "chargeJump", "dash", "lightBurst"],
    mechanics: ["lava", "central-hub", "switch-chamber", "falling-hazard", "moving-platform", "rising-liquid", "escape-autoscroll"],
    partitions: [
      partition("mountain-entry", "山门入口"),
      partition("central-shaft", "中央熔井", "large-continuous-area"),
      partition("chamber-one", "熔室一", "compact-room"),
      partition("chamber-two", "熔室二", "compact-room"),
      partition("chamber-three", "熔室三", "compact-room"),
      partition("chamber-four", "熔室四", "compact-room"),
      partition("chamber-five", "熔室五", "compact-room"),
      partition("chamber-six", "熔室六", "compact-room"),
      partition("chamber-seven", "熔室七", "compact-room"),
      partition("chamber-eight", "熔室八", "compact-room"),
      partition("element-core", "火心密室", "compact-room"),
      partition("final-escape", "终局逃亡", "escape-segment")
    ]
  },
  {
    id: "spider-coves",
    referenceName: "Spider Coves",
    localName: "丝穴支洞",
    mapType: "medium-area",
    requiredAbilities: ["wallGrab", "bash"],
    mechanics: ["projectile-hazard", "projectile-bash", "hidden-route"],
    partitions: [
      partition("cove-entry", "丝穴入口"),
      partition("projectile-nest", "弹巢洞室", "compact-room"),
      partition("hidden-exit", "隐秘出口")
    ]
  }
]);

export const ORI_AREA_CONNECTIONS = Object.freeze([
  ["swallows-nest.withered-return", "sunken-glades.revival-basin", "story"],
  ["sunken-glades.first-gate-hub", "spirit-caverns.lower-entry", "open"],
  ["sunken-glades.first-gate-hub", "hollow-grove.eastern-ascent", "open"],
  ["sunken-glades.black-root-junction", "black-root-burrows.dark-entry", "wallGrab"],
  ["hollow-grove.stomp-gate", "moon-grotto.western-descent", "doubleJump"],
  ["moon-grotto.gumo-junction", "gumos-hideout.chase-entry", "open"],
  ["hollow-grove.valley-exit", "thornfelt-swamp.poisoned-approach", "open"],
  ["thornfelt-swamp.ginso-gate", "ginso-tree.base-entry", "waterVein"],
  ["thornfelt-swamp.restored-basin", "moon-grotto.flooded-return", "ginsoRestored"],
  ["black-root-burrows.stomp-gate", "lost-grove.deep-descent", "stomp"],
  ["hollow-grove.valley-exit", "valley-of-the-wind.southern-entry", "stomp"],
  ["valley-of-the-wind.wind-ravine", "misty-woods.fog-entry", "glide"],
  ["misty-woods.gumon-seal", "forlorn-ruins.snowfield-approach", "gumonSeal"],
  ["forlorn-ruins.escape-surface", "valley-of-the-wind.kuro-pursuit", "forlornRestored"],
  ["valley-of-the-wind.kuro-pursuit", "kuros-nest.nest-approach", "story"],
  ["valley-of-the-wind.sorrow-junction", "sorrow-pass.lower-ascent", "glide"],
  ["sorrow-pass.sunstone-shrine", "mount-horu.mountain-entry", "sunstone"],
  ["hollow-grove.upper-canopy", "spider-coves.cove-entry", "bash"]
]);
