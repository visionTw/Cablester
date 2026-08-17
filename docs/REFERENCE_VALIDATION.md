# 参考关卡验证与性能记录

## 状态模型

每个必需条目必须独立记录：

- `whitebox`：`not-started` / `authored`;
- `load`：`not-loaded` / `loadable`;
- `playable`：`not-playable` / `playable`;
- `validation`：`not-validated` / `validated`;
- `automation`、`browser`、`continuousRun`：`not-run` / `passed` / `failed` / `human-confirmation-needed`.

当前：908 个必需条目中 908 个已验证。清单完成不等于白盒、可加载或可游玩。

## 改造前基线（2026-08-09）

测试设备：MacBook Pro (Mac15,6)，Apple M3 Pro 11 核，18 GB 内存，macOS 14.4，arm64。

| 项目 | 结果 |
|---|---|
| `npm test` | 52/52 通过，0 失败，Node test 总耗时约 75 ms |
| `npm run check` | 原有 10/10 关通过结构校验 |
| 浏览器启动 | 1280×720 视口、DPR 2；关卡菜单和 `combined-horizontal` 可加载 |
| Canvas 绘制缓冲 | 调试层报告 2278×1281，约 1.78× CSS 比例 |
| 浏览器控制台 | 启动、选关和 1 秒静置后 0 error / 0 warning |
| FPS / 帧耗时 | 待加入只读帧统计调试计数后复测；在任何裁剪或空间索引优化前记录 |
| 活动物件 / 绘制物件 / 碰撞候选 | 当前运行时未统计；必须在性能优化前加入调试计数 |

现有运行时在更新、碰撞和绘制路径中直接遍历整关集合，不能作为 Ori 连续世界或 804 房间库的最终架构。

## 首批架构里程碑（2026-08-09）

| 项目 | 结果 |
|---|---|
| `npm test` | 80/80 通过；908/908 个本地文件已通过自动解析、编译、结构和出口目标检查 |
| `npm run check` | 原有 10 关与 908 个已制作参考房间全部通过结构校验 |
| 浏览器按需加载 | 908/908 可从菜单独立加载；修复 fetch 上下文问题后新鲜运行 0 error / 0 warning |
| 1600×1000 | Ori 复苏洼地：约 121.6 FPS，平均 8.23 ms，P95 9.60 ms，最差 10.20 ms；active/drawn/collision 10/10/10 |
| 800×900 | Celeste ST-1-01：约 122.3 FPS，平均 8.18 ms，P95 9.90 ms，最差 10.40 ms；active/drawn/collision 12/12/14 |

机制接入后在 1280×720 的 Celeste ST-1-03 实测约 120.7 FPS、平均 8.29 ms、P95 10.20 ms、最差 10.30 ms，active/drawn/collision 13/13/7；截图捕获时的短暂最差帧不计入稳定窗口。

完整首轮白盒库接入后，菜单只渲染每页 24 个参考卡片，并按 27 个 Celeste Side 集合与 17 个 Ori 区域筛选；浏览器抽样加载 Farewell ST-1-01、Ori 熔火山心终局逃亡和含四类新机关的 Celeste CR-2-01，新鲜控制台均为 0 error / 0 warning。CR-2-01 首测暴露了靠边出生后立即触发出口的问题，随后加入安全出生内缩、入口内缩和切房冷却并复测通过。该抽样不等于其余自动白盒已完成逐房浏览器验收，因此它们的 `browser` 状态保持 `not-run`。

随后通过真实页面的“浏览器加载审计”依次对 908/908 房间执行本地 JSON 获取、文档校验/编译、默认出生与全部 2326 个入口出生的 Game 运行时初始化，以及至少一帧绘制；当前指纹内容上的全量复测耗时 7.8 秒，失败 0，本轮控制台 error/warning 0。机器记录位于 [`levels/reference/browser-load-audit.json`](../levels/reference/browser-load-audit.json)。这仍不是路线通关、死亡重置、手感或高保真验收，所以不会单独据此升级逐房 `browser` 状态。

同一最终指纹又在真实页面执行“逐房综合验收”：908/908 房逐一核对 2326 个入口合法出生、908 次检查点死亡重置与血蓝/冲刺/速度恢复、机关固定步状态、3668 个实际出口对象到目标入口的初始化、908 次渲染及返回菜单后清缓存重进；峰值活动物件 53，结束缓存 0，耗时 11.3 秒，失败 0，控制台 error/warning 0。记录位于 [`levels/reference/browser-acceptance-audit.json`](../levels/reference/browser-acceptance-audit.json)。它与连续物理输入审计共同为逐房 `playable/browser` 状态提供证据；主观手感仍保持 `humanConfirmation=needed`。

连接图审计覆盖 908 房、44 个集合和 3678 条 manifest 候选连接：3678/3678 已有 JSON 出口，目标/入口无效项为 0；44/44 集合弱连通，且从各集合首房在候选有向图中正反向都可覆盖全集合。完整记录位于 [`docs/REFERENCE_GRAPH_AUDIT.md`](REFERENCE_GRAPH_AUDIT.md) 和 [`levels/reference/graph-audit.json`](../levels/reference/graph-audit.json)。这同样不等于实际输入通关。

菜单为每个 Side/区域提供“从首房连续开始”，切房时保留能力、世界标记、检查点和访问记录。最终浏览器自动连续审计使用真实 Game 固定步、碰撞、死亡/房间重置和异步出口加载，不传送也不直接修改角色状态；进度敏感输入逐一走完 44/44 个集合、908 房和 864 次连续切房，0 次死亡重置、失败 0、耗时 21.9 秒，本轮控制台 error/warning 0。因此与内容指纹匹配的 908/908 条目升级为 `continuousRun=passed`。机器记录位于 [`levels/reference/continuous-run-audit.json`](../levels/reference/continuous-run-audit.json)；任何运行时、样式或房间 JSON 改动都会使指纹失配并自动撤销该状态。这证明每个集合的一条顺序主路线；所有支路出口由逐房综合验收和连接图覆盖，但人工手感或原作坐标/美术保真不由自动化替代。

保真度差异审计位于 [`docs/REFERENCE_FIDELITY_AUDIT.md`](REFERENCE_FIDELITY_AUDIT.md) 和 [`levels/reference/fidelity-audit.json`](../levels/reference/fidelity-audit.json)：每条条目-机制使用都必须有明确等价系统，并另行报告当前 JSON 是否实际存在对应对象或能力。当前工程 `validated` 为 908/908；这表示全部指纹化工程证据闭环，不等于原作位置、节奏、视觉或手感已经由真人确认。

CR-2-01 在 1280×720 调试层短窗口约 122.2 FPS、平均 8.18 ms、P95 10.20 ms、最差 16.80 ms，active/drawn/collision 27/27/22。

Ori 月影洞“西侧深降”液体白盒在同一 1280×720 浏览器短窗口约 122.1 FPS、平均 8.19 ms、P95 9.30 ms、最差 17.00 ms，active/drawn/collision 26/26/34；液体区域可见并且控制台无新增错误。

Celeste 镜暗神殿 ST-1-01 黑暗白盒在 1280×720 约 120.9 FPS、平均 8.27 ms、P95 10.10 ms、最差 18.40 ms，active/drawn/collision 32/32/42；照明半径可见且控制台无新增错误。

当前指纹性能复验使用浏览器真实 `requestAnimationFrame` 滚动帧样本；机器记录位于 [`levels/reference/performance-audit.json`](../levels/reference/performance-audit.json)。

| 房间 | 视口 | 平均 FPS | 平均 ms | P95 ms | 最差 ms | active/drawn/collision |
|---|---:|---:|---:|---:|---:|---:|
| `celeste.temple.a.d-01` | 1280x720 | 120.049 | 8.33 | 8.333 | 8.333 | 53/14/26 |
| `ori.mount-horu.central-shaft` | 1280x720 | 120.049 | 8.33 | 8.333 | 8.333 | 27/5/16 |
| `ori.mount-horu.central-shaft` | 1600x1000 | 119.999 | 8.333 | 8.333 | 8.808 | 27/5/16 |
| `ori.mount-horu.central-shaft` | 800x900 | 120.049 | 8.33 | 8.333 | 8.333 | 27/5/16 |

这些数字是静置或短输入白盒的开发机观测值，不代表连续移动、大型区域或完整章节最终性能；后续机制与地图批次仍须重复测量。

## 自动验证门槛

持续运行 `npm test` 和 `npm run check`。新增覆盖必须包括：manifest/文件存在性、文档解析/编译、全局 ID 唯一、入口出口引用、双向连接、边界、能力/物件注册、移动路径、固定时间步确定性、高速平台、平台携带、dashRefill 去抖/消耗/重生/死亡重置、机关保存恢复、房间死亡重置和旧十关回归。测试不得假设项目永远只有十关。

## 浏览器逐房间验收记录规则

每个房间/分区必须记录入口、出口、合法出生可完成、死亡快速重试、检查点、机关重置、资源软锁、移动碰撞、相机提示、控制台和返回菜单重进。每章/区域还需至少一次连续入口到出口试玩。不能自动化的手感问题标为 `human-confirmation-needed`，不能伪装成通过。

## 视口与性能门槛

- 逻辑坐标保持 1280×720；
- 分别验证 1600×1000 和 800×900；
- 代表性大型 Ori 区域目标接近稳定 60 FPS；
- 记录平均 FPS、P95/最差帧、活动/绘制/碰撞候选计数；
- 连续死亡、切房和切章后活动对象及内存不得持续增长；
- 完成前必须给出设备、方法、平均值和最差值，不能只写“感觉流畅”。
