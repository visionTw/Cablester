# 参考关卡机制矩阵

本矩阵先记录章节/区域级需求，防止在缺少证据时提前堆功能。房间或分区进入制作批次时，必须把使用机制细化到对应 manifest 条目，并补齐运行时、视觉、工坊、属性编辑、JSON 编译/反编译、validator、固定时间步测试、重置、屏幕外策略和实际关卡验证。

## Celeste

| 章节 | Side | 参考机制族 | Cablester 等价映射 | 当前可信度 |
|---|---|---|---|---|
| Prologue | A | basic-movement, jump, bridge-collapse, scripted-dash-grant | 八向冲刺、墙抓/墙跳；大跨度只在不绕过主路线时使用绳/杆/猛击 | 房间级矩阵待逐批核对 |
| Forsaken City | A/B/C | dash, dash-refill, spikes, spring, traffic-block, falling-platform, crumble-platform, breakable-wall | 八向冲刺、墙抓/墙跳；大跨度只在不绕过主路线时使用绳/杆/猛击 | 房间级矩阵待逐批核对 |
| Old Site | A/B/C | dash, dash-refill, dream-block, moving-block, badeline-chase, seed-route, hidden-route | 八向冲刺、墙抓/墙跳；大跨度只在不绕过主路线时使用绳/杆/猛击 | 房间级矩阵待逐批核对 |
| Celestial Resort | A/B/C | dash, dash-refill, dust-hazard, moving-dust, key-door, clutter-switch, one-way-route, vertical-shaft | 八向冲刺、墙抓/墙跳；大跨度只在不绕过主路线时使用绳/杆/猛击 | 房间级矩阵待逐批核对 |
| Golden Ridge | A/B/C | dash, dash-refill, wind, snowball, bubble-launcher, moving-block, cloud-platform, breakable-wall | 八向冲刺、墙抓/墙跳；大跨度只在不绕过主路线时使用绳/杆/猛击 | 房间级矩阵待逐批核对 |
| Mirror Temple | A/B/C | dash, dash-refill, darkness, torch-switch, key-door, red-bubble, seeker, dash-switch, carry-object | 八向冲刺、墙抓/墙跳；大跨度只在不绕过主路线时使用绳/杆/猛击 | 房间级矩阵待逐批核对 |
| Reflection | A/B/C | dash, dash-refill, feather, bumper, kevin-block, badeline-orb, boss-pursuit, falling-route | 八向冲刺、墙抓/墙跳；大跨度只在不绕过主路线时使用绳/杆/猛击 | 房间级矩阵待逐批核对 |
| The Summit | A/B/C | dash, dash-refill, wind, dream-block, dust-hazard, bubble-launcher, seeker, feather, checkpoint-flags | 八向冲刺、墙抓/墙跳；大跨度只在不绕过主路线时使用绳/杆/猛击 | 房间级矩阵待逐批核对 |
| Epilogue | A | safe-exploration, hidden-route, future-challenge-rule | 八向冲刺、墙抓/墙跳；大跨度只在不绕过主路线时使用绳/杆/猛击 | 房间级矩阵待逐批核对 |
| Core | A/B/C | double-dash, dash-refill, hot-cold-toggle, lava-ice-hazard, core-block, conveyor, dash-state-rule | 可配置多次冲刺恢复；冷热状态、传送带和定时危险物数据化 | 房间级矩阵待逐批核对 |
| Farewell | A | double-dash, dash-refill, jellyfish-glide, puffer-launch, wavedash-equivalent, wall-bounce-equivalent, moving-hazard, electric-barrier, endurance-room | 八向冲刺 + dashRefill；滑翔等价水母；猛击/发射器等价河豚与弹射；保留耐力长房节奏 | 房间级矩阵待逐批核对 |

## Ori 1 Definitive Edition

| 区域 | 主要能力/门 | 参考机制族 | 含逃亡段 | 当前可信度 |
|---|---|---|---:|---|
| Swallow's Nest | jump | prologue-movement, scripted-world-state, safe-exploration | 否 | 区域级初始标注，分区制作前再核对 |
| Sunken Glades | jump, spiritFlame, wallGrab | breakable-wall, pushable-boulder, spirit-gate, poison-water, ability-gate, return-route | 否 | 区域级初始标注，分区制作前再核对 |
| Spirit Caverns | jump, spiritFlame, wallGrab | rotating-hazard, pushable-boulder, projectile-hazard, map-stone, ability-pickup | 否 | 区域级初始标注，分区制作前再核对 |
| Hollow Grove | wallGrab, chargeFlame, doubleJump | breakable-wall, vertical-climb, ability-gate, branching-route, return-route | 否 | 区域级初始标注，分区制作前再核对 |
| Moon Grotto | wallGrab, doubleJump, bash, stomp | trap-bridge, projectile-bash, vertical-descent, stomp-floor, water-state, return-route | 否 | 区域级初始标注，分区制作前再核对 |
| Gumo's Hideout | wallGrab, doubleJump | chase, falling-platform, switch-door, key-item, one-way-exit | 否 | 区域级初始标注，分区制作前再核对 |
| Thornfelt Swamp | wallGrab, doubleJump, bash, stomp | poison-water, clean-water-state, projectile-bash, stomp-floor, return-route | 否 | 区域级初始标注，分区制作前再核对 |
| Ginso Tree | wallGrab, doubleJump, bash | portal, projectile-bash, rising-liquid, escape-autoscroll, one-way-state-change | 是 | 区域级初始标注，分区制作前再核对 |
| Black Root Burrows | wallGrab, dash, stomp | darkness, light-orb-escort, lantern-switch, moving-platform, ability-gate, return-route | 否 | 区域级初始标注，分区制作前再核对 |
| Lost Grove | wallGrab, dash, stomp, lightBurst | moving-hazard, moving-platform, light-burst-lantern, projectile-bash, return-route | 否 | 区域级初始标注，分区制作前再核对 |
| Valley of the Wind | bash, stomp, glide | strong-wind, projectile-bash, glide, pursuit, vertical-ascent | 否 | 区域级初始标注，分区制作前再核对 |
| Misty Woods | bash, stomp, glide | reconfiguring-map, one-way-route, projectile-bash, key-gate, world-state-change | 否 | 区域级初始标注，分区制作前再核对 |
| Forlorn Ruins | bash, stomp, glide, gravityCarry | gravity-field, carry-object, laser, crush-hazard, escape-sequence, one-way-state-change | 是 | 区域级初始标注，分区制作前再核对 |
| Kuro's Nest | glide | stealth-cover, pursuit, key-item, one-way-exit | 否 | 区域级初始标注，分区制作前再核对 |
| Sorrow Pass | bash, glide, lightBurst, chargeJump | updraft, projectile-bash, light-burst-lantern, vertical-ascent, ability-gate, return-shortcut | 否 | 区域级初始标注，分区制作前再核对 |
| Mount Horu | bash, stomp, glide, chargeJump, dash, lightBurst | lava, central-hub, switch-chamber, falling-hazard, moving-platform, rising-liquid, escape-autoscroll | 是 | 区域级初始标注，分区制作前再核对 |
| Spider Coves | wallGrab, bash | projectile-hazard, projectile-bash, hidden-route | 否 | 区域级初始标注，分区制作前再核对 |

## 已识别机制全集（104）

- `ability-gate`
- `ability-pickup`
- `badeline-chase`
- `badeline-orb`
- `basic-movement`
- `boss-pursuit`
- `branching-route`
- `breakable-wall`
- `bridge-collapse`
- `bubble-launcher`
- `bumper`
- `carry-object`
- `central-hub`
- `chase`
- `checkpoint-flags`
- `clean-water-state`
- `cloud-platform`
- `clutter-switch`
- `conveyor`
- `core-block`
- `crumble-platform`
- `crush-hazard`
- `darkness`
- `dash`
- `dash-refill`
- `dash-state-rule`
- `dash-switch`
- `double-dash`
- `dream-block`
- `dust-hazard`
- `electric-barrier`
- `endurance-room`
- `escape-autoscroll`
- `escape-sequence`
- `falling-hazard`
- `falling-platform`
- `falling-route`
- `feather`
- `future-challenge-rule`
- `glide`
- `gravity-field`
- `hidden-route`
- `hot-cold-toggle`
- `jellyfish-glide`
- `jump`
- `kevin-block`
- `key-door`
- `key-gate`
- `key-item`
- `lantern-switch`
- `laser`
- `lava`
- `lava-ice-hazard`
- `light-burst-lantern`
- `light-orb-escort`
- `map-stone`
- `moving-block`
- `moving-dust`
- `moving-hazard`
- `moving-platform`
- `one-way-exit`
- `one-way-route`
- `one-way-state-change`
- `poison-water`
- `portal`
- `projectile-bash`
- `projectile-hazard`
- `prologue-movement`
- `puffer-launch`
- `pursuit`
- `pushable-boulder`
- `reconfiguring-map`
- `red-bubble`
- `return-route`
- `return-shortcut`
- `rising-liquid`
- `rotating-hazard`
- `safe-exploration`
- `scripted-dash-grant`
- `scripted-world-state`
- `seed-route`
- `seeker`
- `snowball`
- `spikes`
- `spirit-gate`
- `spring`
- `stealth-cover`
- `stomp-floor`
- `strong-wind`
- `switch-chamber`
- `switch-door`
- `torch-switch`
- `traffic-block`
- `trap-bridge`
- `updraft`
- `vertical-ascent`
- `vertical-climb`
- `vertical-descent`
- `vertical-shaft`
- `wall-bounce-equivalent`
- `water-state`
- `wavedash-equivalent`
- `wind`
- `world-state-change`

## 首批通用机制优先级

1. `dashRefill`：支持恢复一次或多次冲刺、一次性/重生、连续接触去抖、死亡/房间重置和可用状态反馈。
2. 数据驱动移动物件：路径点、速度、加速度、停留、缓动、循环/往返、触发方式、重置和屏幕外策略。
3. 稳定移动平台携带与高速连续碰撞；移动墙、移动危险物、移动锚点/猛击支点复用同一轨迹核心。
4. 只有代表性章节/区域清点确认后，才按需加入碎裂平台、弹簧/发射器、门/能力门、风场移动版、追逐和世界状态变化。

## 当前实现状态（2026-08-09）

- `dashRefill` 已接入运行时、工坊属性、JSON 编译/反编译、validator、视觉、HUD 多次冲刺计数、接触去抖、补满/增量、一次性/重生和死亡重置；
- `movingObject` 已支持平台、危险物、锚点和猛击支点，使用统一多节点轨迹核心，包含速度、加速度、停留、三种缓动、循环/往返/单次、自动/接触/开关触发、死亡/房间/保持重置和三种屏幕外策略；
- 移动平台已实现站立携带、动态抓取表面和高速扫掠碰撞；移动危险物使用同一位置状态并参与伤害扫掠；
- 发射器、碎裂平台、能力/状态门和世界状态触发区已接入运行时、工坊、编译/反编译、validator、视觉与死亡重置；世界标记可跨参考房间保存；
- 水、危险液体和熔岩使用统一 `liquidZone`：支持重力倍率、阻力、水流、游动输入、接触伤害、工坊属性和 JSON 往返；
- `darknessZone` 支持区域强度、玩家照明半径和世界标记解除，并已进入运行时、工坊、JSON、validator 与视觉；
- 固定步测试覆盖确定性、触发、屏幕外策略、往返、接触去抖、重生、一次性、门闩保持、世界标记、死亡重置和高速平台接触。
