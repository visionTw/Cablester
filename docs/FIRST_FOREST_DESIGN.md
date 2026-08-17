# 第一森林区域：暮种林（Duskseed Reach）

`暮种林` 是 Cablester 第一阶段唯一的正式大区域。它借鉴“首个大型探索区域应教会移动、建立地标、形成回环”的体验原则，但地图、名称、路线、构图、角色、素材和音频均为原创。

## 体验主旨

- 核心意象：夜色森林中沿根系传递的“种灯脉冲”；冷青环境光与少量琥珀导航光对比。
- 主路线把软绳摆荡、硬杆撑跳、二段跳、猛击、滑翔和冲刺串成逐步升级的连续移动语句。
- 支路不是数量填充：分别提供资源回收、路线回读、状态机关和高速挑战。
- 三个大型地标在世界图和本地画面均可辨认：种灯门、双根钟、心木环庭。

## Region / Chunk 结构

正式 region ID：`duskseed-reach`。12 个 chunk，主路线 8 个，支路 4 个：

| Chunk | 角色 | 主要机制 | 世界位置 |
| --- | --- | --- | --- |
| `seedgate-verge` | 入口与安全教学 | 跑跳、墙抓、软绳 | `(0, 0)` |
| `lantern-crossing` | 第一处分岔 | 软绳/硬杆、多高度路线 | `(2400, 0)` |
| `root-aqueduct` | 低位回环 | 液体、移动平台、flag 水闸 | `(4800, 600)` |
| `canopy-lift` | 垂直主段 | 二段跳拾取、墙抓、检查点 | `(7200, -1200)` |
| `wind-terraces` | 空中横越 | 滑翔拾取、风场、方向预取 | `(9600, -1200)` |
| `bellroot-court` | 中央枢纽 | 猛击、门状态、三向连接 | `(12000, 0)` |
| `heartwood-ring` | 能力综合 | 软绳/硬杆/bash/dash 连段 | `(14400, 0)` |
| `afterglow-gate` | 出口与回读 | 保存、最终检查点、出口 | `(16800, 400)` |
| `moss-cistern` | 支路 A | 水下阻力、资源、返水闸 | `(5200, 2200)` |
| `echo-burrow` | 支路 B | 黑暗、种灯 flag、短回环 | `(9600, 1800)` |
| `crown-overlook` | 支路 C | 高速滑翔/冲刺挑战 | `(12600, -2400)` |
| `old-nursery` | 支路 D | fragile、移动机关、永久拾取 | `(14800, 2200)` |

主路线：

`seedgate-verge → lantern-crossing → root-aqueduct → canopy-lift → wind-terraces → bellroot-court → heartwood-ring → afterglow-gate`

正式回环：

1. `root-aqueduct ↔ moss-cistern ↔ lantern-crossing`；打开 `cistern-sluice-open` 后成为低位返回捷径。
2. `wind-terraces ↔ echo-burrow ↔ bellroot-court`；点亮 `echo-seed-lit` 后黑暗支路可稳定往返。
3. `bellroot-court ↔ crown-overlook ↔ heartwood-ring`；需要 `glide`，完成后开启顶部高速捷径。
4. `heartwood-ring ↔ old-nursery ↔ afterglow-gate`；`nursery-restored` 持久化并提供备用出口。

## 能力与状态序列

- 出生批准能力：`rope`、`hardBar`、`dash`、`wallGrab`。
- `doubleJump`：`canopy-lift` 主路线必得；拾取点前不放置必须二跳的唯一出口。
- `glide`：`wind-terraces` 入口安全台必得；第一段风场有可返回落点。
- `bash`：`bellroot-court` 主路必得；门在拾取之后才要求 bash。
- 状态 keys：`cistern-sluice-open`、`echo-seed-lit`、`bellroot-bells-rung`、`crown-route-open`、`nursery-restored`、`heartwood-awake`。
- 所有主路线门都有同 chunk 内、门前可达的解锁来源。一次性拾取和永久 flag 使用 `persistAcrossDeath: true`；局部移动/fragile 状态按 chunk reset。

## 安全与净空

- canonical 玩家半径 18；门、入口、垂直井和平台间隙的最小静态净空目标为 52 units。
- 每个跨区入口有至少 160×120 的安全落点，入口触发区不会覆盖危险区或移动物路径。
- 每个 chunk 至少一个安全 checkpoint；主路线最大 checkpoint 间隔不超过 2 个 chunk。
- 掉落出口只在明确设计的 hazard/recovery 区域开放；其他边缘使用显式 `boundaryWall`。
- 跨区往返测试必须覆盖已拾取能力、已开启 flag、一次性物件与当前 checkpoint。

## 流式策略

- 默认 active：当前 chunk；warm：一跳邻居；prefetch：运动方向上的二跳候选。
- `prefetchDistance: 900`、`hysteresis: 320`、`unloadDelaySeconds: 2.4`；方向前瞻由运行时依据速度推导，不另写入 canonical 字段。
- 地标代理与跨区状态机关为 keep-alive 元数据，但高清纹理不常驻。
- 快速 A→B→A、瞬移、掉头和迟到请求都有固定场景；request epoch 不匹配的加载结果必须废弃。

## 美术生产边界

- 正式路径复用基线的 22 个原创小型 WebP，并新增 3 个暮种林专属模块化地标；当前共 25 个图片资产，且始终保留程序化安全回退。
- 新增资产只允许是可复用的小型模块：种灯门变体、双根钟、心木环庭核心、区域地图地标代理等；不生成整张背景。
- 每项资产必须记录 prompt、生成方式、原创/许可说明、尺寸、文件校验、Web/Godot 映射和实际应用 chunk。
- reference 白盒的 Celeste/Ori 数据不进入本 region，不作为路线或物件拷贝来源。

## 试玩验收路线

1. 主路线入口→出口，获得三项能力并激活 `heartwood-awake`。
2. 四条支路各完成一次并返回枢纽。
3. 入口→水闸捷径→入口 A→B→A。
4. 顶部滑翔捷径正反向。
5. 死亡后 checkpoint、能力、持久 flag 与局部 reset policy。
6. 保存退出/重启后从最后 checkpoint 继续，正式状态不丢失。
