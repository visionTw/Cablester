# Cablester 第一阶段本地验收报告

状态：**LOCAL COMPLETE / 本地自动化基础收尾**
证据冻结日：2026-08-14（Asia/Shanghai）
范围：canonical World Package、本地 Web World Studio、Godot 4.7.1 importer/runtime、3C 双端对等、首个正式区域“暮种林”和 macOS 本地导出包。

## 结论与范围

第一阶段的本地、机器可验证基础已经关闭：正式森林与 3C 实验室共享 schema v3 canonical World Package；Godot resolved snapshot、normalized manifest 和 canonical 内容 hash 一致；10 个 3C 案例为 **10/10 cases、318/318 assertions**；collision-driven 连续路线访问 **12/12 chunks**、四条支路、全部能力与 flag，并完成死亡恢复、存档重载、检查点和最终目标；macOS 导出包验收为 **23/23 checks**。

当前目标允许通过 Git commit/push 同步本地开发源码和可移植证据，但明确不包含网页发布、Sites 部署或公开 URL 复验。Web 保留为本地 canonical 数据编辑器、四级预览器和 3C 实验室；后续开发全面转向 Godot 应用。历史 Sites 证据只作归档，不能证明当前或未来发布。

`humanConfirmation: needed` 仍保留：机器结果不能宣称真人已经批准手感、画面、音频或长期游玩体验。根据本次本地收尾范围，这些主观工作转入后续 Godot 应用迭代，不阻塞本地自动化基础结束。

## 冻结身份

| 项目 | 冻结值 | 权威位置 |
| --- | --- | --- |
| Godot build | `4.7.1.stable.official.a13da4feb` | [`GODOT_VERSION`](../GODOT_VERSION)；[`scripts/godot.sh`](../scripts/godot.sh) 拒绝其他 build |
| Schema / 内容版本 | `3` / `1.0.0` | [`CANONICAL_WORLD_PACKAGE.md`](CANONICAL_WORLD_PACKAGE.md) 与 canonical packages |
| 正式森林 | `cablester-first-forest`；1 Region、12 Chunks、284 Objects、15 Edges | [`first-forest.world.json`](../worlds/formal/first-forest.world.json) |
| 正式森林 hash | `sha256:bd86d11711e237d8305594384fb0081ea41c003bb7121952f919030eed01c5d7` | canonical、snapshot 与 normalized manifest 一致 |
| 3C 实验室 | `cablester-3c-labs`；1 Region、10 Chunks、405 Objects | [`cablester-3c-labs.world.json`](../worlds/labs/cablester-3c-labs.world.json) |
| 3C 实验室 hash | `sha256:c42c17c59a4e750fd440f5d63b982708581ddd5da842ce1efcedb5a2a2ce3d3d` | canonical、snapshot、manifest 与 3C 报告一致 |
| Gameplay tuning | `approved-1`；固定步长 `1/120s` | canonical tuning 与共享 replay |
| Clean rebuild source fingerprint | `sha256:5d9c89085e12f73934e1c212ed8724fea34e6098d7bea15a3d4ead65602eb521` | rebuild 前后相同；187 files、3,834,263 bytes |

## 14 项本地停止条件

| # | 停止条件 | 状态 | 当前本地证据 |
| ---: | --- | --- | --- |
| 1 | Web 可实际生产仓库关卡文件 | **PASS** | World Studio 支持稳定 ID、World/Region/Chunk/Object 编辑、三层 Canvas 拖拽、连接构建、undo/redo、确定性序列化、schema/staged validation、ETag 与 capability 保护的 repository GET/PUT；浏览器工作流和服务器写回均有回归测试。 |
| 2 | 森林布局、拓扑、状态和物件只来自 canonical | **PASS** | 正式 package 为 12 chunks、15 edges、284 objects、6 flags；`.tscn` 只保留主场景与受控 prefab，正式布局没有平行手工副本。 |
| 3 | Web 完整预览森林及 Region/Chunk 结构 | **PASS** | [`world-studio-performance.json`](../artifacts/web/world-studio-performance.json) 为真实 Chrome `pass`：四种 Canvas digest 全部不同且非空，含 12 chunk、15 edge、5 route、3 landmark、284 Godot collision proxy 和 2001 trajectory samples。 |
| 4 | Godot 确定性导入并完整运行同一森林 | **PASS** | clean rebuild、snapshot、连续物理路线和实际 macOS 导出包共同通过；导入 warnings/errors 均为 0。 |
| 5 | Web 与 Godot contentHash 一致 | **PASS** | 森林与 labs 的 canonical、snapshot 和 normalized manifest 各自逐字共享上述 hash。 |
| 6 | canonical 与 Godot normalized manifest semantic diff 为零 | **PASS** | clean rebuild 中 formal/labs 两份 semantic diff 均为 0。 |
| 7 | 清空浏览器草稿后正式区域仍从仓库恢复 | **PASS** | Chrome artifact 记录 local/session storage poison → clear → reload；恢复正式 forest hash、12 chunks、284 objects，snapshot 仍为 current。 |
| 8 | 删除 Godot 缓存后可完整重建 | **PASS** | [`rebuild-attestation.json`](../artifacts/godot/rebuild-attestation.json) 为 `ok: true`：28/28 commands、173/173 checks，源 fingerprint 前后相同。 |
| 9 | 6 个专项关与 4 个综合案例完成双端回归 | **PASS（自动）** | [`3c-parity-report.json`](../artifacts/godot/3c-parity-report.json) 为 10/10、318/318、0 failure；真人手感仍为 `needed`。 |
| 10 | Godot 导出包通过全路线、支线、往返、存档与性能验收 | **PASS（自动）** | [`exported-app-acceptance.json`](../artifacts/godot/exported/exported-app-acceptance.json) 为 `pass`、23 checks、4 runs；实际 PCK 中路线 12/12 chunks、四支路、7 abilities、6 flags、goal/checkpoint/save-reload 全通过。真人体验不在机器结论内。 |
| 11 | Web prediction、Godot snapshot 与 telemetry 明确区分 | **PASS** | Chrome 四视图分别呈现 canonical prediction、resolved snapshot、runtime telemetry 与 Godot-only proxy，snapshot hash/version 握手为 current。 |
| 12 | 正式路径无临时素材、未登记资源、隐藏布局或参考复刻 | **PASS** | Registry 为 1 个程序化回退 + 25 个登记原创 WebP；25 主图和 25 缩略图均通过 QA；formal 不引用 Celeste/Ori/reference-room 内容。 |
| 13 | 没有未解决的 P0/P1 | **PASS** | 本地安全/回归审计无未解决 P0/P1；本轮 3 个 P3 已修复并有回归：Godot prefab 路径边界、loopback repository capability、spatial-grid 预算。 |
| 14 | 报告列全版本、hash、测试、性能、来源、差异和证据 | **PASS** | 本报告绑定同一 checkout/工作树指纹和本地证据；网页发布被明确排除，不用历史 Sites 收据补位。 |

## 本地自动化结果

- `npm test`：**233/233 pass**。
- `npm run check`：10 个 built-in levels、2 个 canonical worlds 和 908 个 authored reference rooms 通过结构验证。
- `npm run assets:audit`：25 个生成素材、50/50 文件、0 errors。
- `godot/tools/rebuild_artifacts.sh`：28/28 commands、173/173 checks；11/11 replays；tuning 97/97；formal/labs semantic diff 0。
- [`first-forest.continuous-physics-route.acceptance.json`](../artifacts/godot/first-forest.continuous-physics-route.acceptance.json)：13,901 ticks、12/12 chunks、13/13 route checks、7 deaths、7 abilities、6 flags、goal/checkpoint/save-reload 全通过。
- `npm run godot:export-acceptance`：macOS `.app` 23/23 checks、4/4 runs。
- `npm run build`：仅生成本地 `dist/`；未发布。

## 性能证据

真实 Chrome World Studio：

- 正式森林 Canvas：`119.755 FPS`，p95/p99 `8.333/8.333 ms`，worst `16.666 ms`。
- 10× 合成世界：10 regions、200 chunks、10,400 objects，`120.005 FPS`，p95/p99 `8.333/8.333 ms`。
- 正式森林交互 paint 最大 `35.1 ms`；10× 合成世界最大 `75.3 ms`；均低于 `100 ms` 门限。
- 50 次跨区切换后 cache 命中/未命中 `120/280`，tail memory ratio `1.091`；console errors/warnings 为 0。

Godot 连续路线 headless：

- frame p50/p95/p99：`0.701/0.917/1.277 ms`。
- physics p50/p95/p99：`0.539/0.693/0.972 ms`。
- 结束时 4 chunks loaded；估算内存 `32 MiB`。

实际导出包连续路线：frame p95 `0.740 ms`，physics p95 `0.548 ms`。这些数值是本机自动化采样，不等于真人正常显示驱动下的主观流畅度结论。

## 本轮 P3 修复

### Godot prefab 加载边界

漏洞路径是外部 World Package 的 prefab registry `godotScene` 进入 Godot `load()/instantiate()`。现在 schema、validator、importer 和最终加载点都只接受 `res://godot/prefabs/*.tscn`，拒绝 `user://`、绝对路径、遍历、反斜杠、错误扩展和其他根目录。合法 canonical prefab 继续导入。

### 本地 repository confused-deputy

漏洞路径是 origin-less loopback 请求访问 repository GET/PUT。开发服务器现在为每次启动生成 capability，只通过 URL fragment 交给浏览器；客户端移除 fragment、仅保存在 history state/in-memory，并在 repository 请求头发送。Host、Origin、路径、schema、hash、ETag 和并发锁仍全部保留。直接访问无 capability 的 localhost 为只读。

### SpatialGridIndex 资源预算

漏洞路径是导入极端有限坐标/bounds 后同步展开无界 cell。现在入索引前验证坐标、单实体 cell 数和全索引 aggregate memberships；超预算在任何 mutation 前抛出 `WORLD_SPATIAL_BUDGET_EXCEEDED`，正常森林和 10× 世界查询保持通过。

## 资产与来源边界

当前 AssetRegistry 共 26 条：1 个 `builtin:procedural` 安全回退和 25 个透明 WebP；图片分为 8 gameplay、14 通用 scene 和 3 个暮种林 landmark。25 个图片为 Cablester 原创提示词生成的小型可复用项目素材，使用 OpenAI 内置 ImageGen `gpt-image-2`，再经本地透明化、裁切、缩放和 WebP 处理；没有使用第三方游戏资源或整张复刻背景。完整来源见 [`ASSET_LIBRARY.md`](ASSET_LIBRARY.md) 与 [`asset-registry.json`](../worlds/registries/asset-registry.json)。

## 已知边界与下一阶段

- 真人尚未签署 3C 手感、画面、音频和长期游玩体验；报告不把自动化冒充真人批准。
- Web 只作为本地数据工具继续维护；当前不处理网页发布。
- 下一阶段全面开发 Godot 应用，优先处理正常显示驱动体验、UI/设置/存档产品化、视觉与音频、输入设备和持续人工试玩。
- 若未来重新发布网页，必须重新开启脱敏、安全审计、精确 commit/构建绑定、部署和公开 URL 验收；本阶段历史 Sites 收据不得复用。
- 当前没有提交、推送或部署操作；用户现有工作树改动全部保留。
