# 关卡美术配置与发布验收

本文记录正式关卡的美术 preset、参考白盒的覆盖边界，以及每次发布必须补齐的测试、性能、浏览器和 Sites 证据。代码存在、构建成功或旧版线上记录都不能单独代表本轮发布完成。

## 当前美术架构

`src/levels.js` 保留 10 份 `LEGACY_LEVELS` 玩法定义，再通过 `compileLevelWithArtPreset` 生成实际菜单使用的 `LEVELS`。`applyLevelArtPreset` 只合并：

- 物件的 `properties.visual`；
- scene 既有角色层的视觉 override；
- 额外 scene layers。

物件 ID、type、position、碰撞尺寸、伤害、能力、检查点和其他玩法字段不会被 preset 改写。代表性样板为 `combined-horizontal`，主题名“深月长廊”；所有正式关卡使用同一素材世界观，通过 tint、opacity、parallax 和少量密度差异形成辨识度。

每个正式 preset 当前配置：

- 9 类 gameplay visual：平台、危险物、锚点、能量球、冲刺补充、猛击支点、检查点、出生点、终点；
- 4 个基础角色层：远景树干、中景古树、玩家附近灌木、前景暗藤；
- 4 个自定义层：发光植物、游雾、中远景树组、生物光点；
- slope、风场、液体、黑暗、旋转、移动物件、机关门等尚无专用图片时继续使用 type/project 默认和程序化安全表现。

## 10 个正式关卡主题映射

| 关卡 ID | 玩法名称 | 美术主题 | 区分重点 |
| --- | --- | --- | --- |
| `movement-lab-01` | 软绳实验场 | 月绳幽径 | 冷青月色、柔和蓝绿树层和明亮绳索交互物。 |
| `hard-bar-lab` | 硬杆实验场 | 琥珀根庭 | 琥珀根木、暖金点缀和较低雾/光点密度。 |
| `bash-lab` | 猛击实验场 | 紫辉花林 | 紫罗兰中景和高可读的猛击花核心。 |
| `double-jump-lab` | 二段跳实验场 | 青苔跃谷 | 绿色苔藓、清爽中景和明亮平台边缘。 |
| `glide-lab` | 滑翔实验场 | 雾风树冠 | 更慢的远/中景视差、较明显游雾和冷蓝树冠。 |
| `dash-lab` | 冲刺实验场 | 电光裂林 | 蓝紫高对比、生物光点增强和清晰高速路线。 |
| `combined-speed` | 综合 · 高速连段 | 金萤飞径 | 暖金光点、琥珀中景和高速路径的亮暗分离。 |
| `combined-horizontal` | 综合 · 水平穿越 | 深月长廊 | 样板关；原色资产、完整八层场景和长距离横向视差。 |
| `combined-vertical` | 综合 · 垂直升降 | 天穹古树 | 冷蓝纵深、更慢远景视差和高耸树干感。 |
| `combined-hazards` | 综合 · 伤害走廊 | 绯荆沼泽 | 暗紫沼泽、绯红危险物和更重前景剪影。 |

canonical 映射在 [`src/level-art-presets.js`](../src/level-art-presets.js)。修改主题时应先检查样板，再逐关确认构图、路线可读性和帧率，不能只调整色表后宣告验收。

## 素材一致性与可读性约束

- 远景使用低饱和、慢视差、低透明度；中景增加轮廓和暖色点；玩家附近保留较高清晰度；前景使用暗色剪影和有限覆盖。
- 平台顶边、危险物尖刺、锚点核心、出生/终点门和检查点必须在动作速度下仍可辨识。
- 图片不会替代碰撞 debug 或交互语义；关键物件绘制后仍可叠加必要的状态提示。
- foreground 在玩家之后绘制，但 gameplay cue 与 HUD 在其后；仍须检查前景不会大面积遮挡角色或路线。
- 不通过一张超大背景覆盖整关；组合现有小素材、平铺、镜像、稀疏随机和 tint 复用。

## 908 个参考白盒的覆盖边界

当前工作树有 908 份 `metadata.mode: "reference-room"` 的参考房间源文件，全部仍为 schema v1。`ReferenceLevelLibrary` 读取时会迁移、验证、缓存文档，再编译为运行时关卡。

这些房间的美术范围必须准确理解：

1. 它们不经过 `LEVEL_ART_PRESET_BY_ID`，没有逐房间主题、构图、scene 密度或色彩设计。
2. v1 迁移会为每个物件补齐当前 type default visual；因此 platform、hazard、anchor 等已登记类型可能显示公共图片默认素材。
3. 其余物件仍使用 `builtin:procedural`；任何缺失、不适用或加载失败图片也回到程序化 renderer。
4. 迁移生成的默认 scene 四层只引用 `builtin:procedural`，正式运行时会跳过这些空装饰层并保留基础 Canvas 渐变/光点背景。
5. 参考房间当前是玩法结构、连通性和机制验证白盒；“908 份可迁移/可编译/可安全回退”不等于“908 份已完成原创场景美术和浏览器视觉验收”。

若未来要求参考房间也具备逐房间美术，必须建立独立但仍输出同一 v2 scene/visual 格式的 preset 或数据生成规则，并重新做全量可读性与性能抽样；不能把正式 10 关的主题表冒充参考房间覆盖。

## 发布前流程

1. 重新检查 registry、最终 WebP/缩略图、关卡 preset 和 v1 迁移结果。
2. 对 10 个正式关卡运行结构验证，并确认 908 参考房间继续可迁移和编译。
3. 运行 `npm run assets:audit`、素材/scene/roundtrip/回退测试、`npm run check` 和 `npm run build`。
4. 在浏览器逐项验收三个编辑模式、保存、导入导出、一键试玩和原生下拉可读性。
5. 记录正式关卡的首次加载、请求、内存、平均 FPS、P95 和最差帧；至少覆盖样板、垂直关、危险密集关和 low-tier。
6. 对 10 关逐一保存同视口 before/after 截图或视频证据，并记录遮挡、接缝和主题一致性结论。
7. 构建通过后发布到 Sites；记录版本和状态，再重新打开公开地址确认新入口、素材请求、编辑保存和试玩。
8. 只有上述证据全部属于当前 commit/构建，才可把本轮发布标记为完成。

## 本轮结果区（2026-08-12 发布构建）

> 当前状态：本地功能、素材、自动测试、结构检查、构建、浏览器功能巡检和性能审计已有当前证据。Sites v12 是较早的公开验收版本，其复验发现静态资源层没有采用项目期望的 WebP MIME/缓存响应头；当前最终候选保留 registry 的真实 `assets/` 文件路径，同时让浏览器通过 `/media/` Worker 交付路由读取同一文件。最终 Sites 版本尚待主任务发布并以在线响应头复验为门禁。

### 版本、测试与构建

| 项目 | 当前轮结果 | 证据 |
| --- | --- | --- |
| commit / 工作树指纹 | 基线 `HEAD 7b50c35e28af10d49be1b18a3f9c77afc2d7f4b7`；首个公开验收 commit `81c5d9bbcb1b3fe36080577561ae847800bcb250` | [`levels/art/performance-audit.json`](../levels/art/performance-audit.json) 的输入指纹为 `95f58ed35e51b841e61ed8c574a00057c76b293733bec2a96bde22fa5bb36844`，覆盖 57 个性能相关文件；最终发布 commit 待主任务填写。 |
| `npm test` | **通过：116/116，0 失败** | 2026-08-12 在最终工作树重新运行 `node --test`，总耗时 4.658 秒；包含 registry、canonical asset path、实际本地素材交付服务、单物件/同类型替换、v1/v2 roundtrip、scene、回退、素材像素审计和性能证据指纹门禁。 |
| `npm run check` | **通过：10 个正式关卡 + 908 个参考房间** | 当前命令输出 `10 built-in levels and 908 authored reference rooms passed structural validation.`；参考内容指纹 `13ca025a74bdb299db7314c9a31011bc7f6be6b93e30c72aff07f03dfc39da39` 覆盖 931 文件（908 room + 23 runtime）。 |
| `npm run assets:audit` | **通过：16 个生成素材，32/32 文件，0 错误** | 16 个运行时 WebP + 16 个缩略图共 391.5 KiB；像素解码估算 3129.1 KiB；残留洋红像素为 0，透明边缘最大 alpha 4/255，最差缩略图 RGB MAE 2.999。 |
| `npm run build` | **通过** | 最终候选 `dist/` 共 982 个文件、17,691,849 bytes，包含 16 个运行时素材、16 个缩略图、canonical asset path 模块、优先接管 `/media/*` 的 Worker 与静态资源 `_headers`；命令输出 `Cablester Sites build created in dist/.`。 |

### ImageGen 素材批次与授权

当前 registry 为 17 条：`builtin:procedural` 安全回退 + 16 个 ImageGen 透明 WebP。完整文件路径、真实尺寸/字节数、提示词、适用物件类型、生成方式和 license 均登记在 [`src/asset-library.js`](../src/asset-library.js)，缩略图与处理规范见 [`docs/ASSET_LIBRARY.md`](ASSET_LIBRARY.md)。

| 分组 | 已接入素材 ID | 生产与 QA 结果 |
| --- | --- | --- |
| 玩法物件（8） | `gameplay:moss-platform`、`gameplay:thorn-hazard`、`gameplay:rope-anchor`、`gameplay:energy-orb`、`gameplay:bash-blossom`、`gameplay:checkpoint-lantern`、`gameplay:spawn-gate`、`gameplay:goal-gate` | 均由内置 ImageGen `gpt-image-2` 生成纯 `#ff00ff` 背景源图，再本地去色键污染、裁切、缩放并以 WebP quality 88 输出；已进入 type default、编辑器缩略图和正式关卡 preset。 |
| 场景层（8） | `scene:moss-bush-cluster`、`scene:cyan-seed-plant`、`scene:overhang-vine-branch`、`scene:ancient-amber-tree`、`scene:distant-trunk-grove`、`scene:mid-tree-cluster`、`scene:cyan-mist-band`、`scene:forest-light-motes` | 已进入场景素材选择器和 10 关八层 scene preset；本地巡检未见洋红边、明显接缝或遮挡关键 HUD/提示。 |

16 项素材的 registry license 统一记录为 `Original AI-generated project asset`，使用范围仅声明为 **Cablester 项目运行时、编辑器、文档和公开 Sites 部署**；来源记录为 2026-08-11 使用 OpenAI 内置 ImageGen 为 Cablester 生成，未使用第三方游戏资源。该项目内记录不替代发布主体对 OpenAI 条款、商标、版权或其他适用法律的审查，registry 也没有声明独立素材包再分发范围。提示词只使用梦幻森林、生物光、手绘质感、剪影层次、冷暖色彩和空间纵深等通用语言，没有要求复制《Ori》原画、角色、标志或具体场景构图。

### 本地浏览器验收

证据为 2026-08-12 00:54（Asia/Shanghai）在 1280×720 Codex in-app browser 对 `http://127.0.0.1:4175/` 的巡检，结构化结果保存在 [`levels/art/browser-acceptance-audit.json`](../levels/art/browser-acceptance-audit.json)。该文件记录 10/10 正式关卡加载、16/16 图片 ready、0 asset error 和 0 新 console error/warning。

| 项目 | 结果 | 证据或边界 |
| --- | --- | --- |
| 三模式入口明显可见 | **通过** | `物件编辑`、`物件素材`、`场景分层` 均能直接进入；JSON 中 `obviousEntry: true`。 |
| 素材搜索、缩略图、单个与批量替换 | **通过** | 17 张 registry 卡片；选择 platform 后 2 张兼容卡；搜索收敛为 1 张；单个替换、undo/redo 和 9 个 platform 同类型批量替换均通过，inspector canvas 实时显示图片。 |
| 素材库按需加载 P1 | **通过，P1 已关闭** | 未进入“物件素材”模式时 DOM 中为 0 张素材缩略图；进入后渲染 17 张卡片、16 张图片缩略图，且全部图片使用 `thumbnailSrc` 路径，没有预取运行时原图。 |
| 类型默认、项目默认、单字段与全部重置 | **部分通过** | 浏览器已通过 type default、same-type reset、project default reset + undo；单字段/全部配置的 canonical reset 有自动测试覆盖，但本轮 JSON 未保存单字段按钮的独立浏览器动作证据。 |
| 图层新增、锁定、排序、复制、删除 | **通过** | 8 层初始 scene；新增 + undo/redo、depth 排序 + undo、复制/删除及恢复 8 层均通过；实际切换锁定时 inspector 状态为 enabled → disabled → enabled，证明锁定拦截编辑、解锁恢复编辑。 |
| scene 素材添加/替换与无缝预览 | **通过** | scene picker 有 9 个选项，替换 + undo 和实时 canvas 通过；10 关巡检未见可见接缝、突跳或洋红边。无缝放置的确定性、范围和 draw cap 另由自动测试覆盖。 |
| 保存、JSON roundtrip、一键试玩 | **通过** | 保存与一键试玩通过；通过内置浏览器真实 file chooser 导入 schema v1 文件 `levels/reference/celeste/prologue/a/0.json`，界面显示“已导入关卡，请确认后保存”，随后执行导出并显示“关卡 JSON 已导出”。v1→v2 迁移及文档 roundtrip 另由自动测试覆盖。 |
| 原生 `option`/`optgroup` 可读性 | **本地与公开 Sites 均通过** | 深色编辑器中的原生 select 弹层实测 `option` computed style：background `rgb(242, 247, 248)`（`#f2f7f8`）、color `rgb(16, 44, 53)`（`#102c35`）；选中文字色登记为 `#071b24`。公开 v12 复验得到相同 computed style。 |
| 缺失素材安全回退 | **自动测试通过；浏览器注错待固化** | 单元测试覆盖缺失、不适用和 loader error 回到 `builtin:procedural`；本轮正常巡检为 0 asset error，没有保留一次人为 404 注错录像。 |

### 性能、请求与内存

可重复证据为 [`levels/art/performance-audit.json`](../levels/art/performance-audit.json)，生成于 2026-08-12 01:43（Asia/Shanghai），状态 `pass`。Chrome 119 headless 通过 CDP 注入真实按键并记录连续 `requestAnimationFrame`；正式样板每个视口测 10 秒，`combined-vertical` 与 `combined-hazards` 各补测 10 秒，low-tier 测 5 秒。可见浏览器另记录同视口 6.5 秒 warm rolling sample，二者不能混作同一测量面。

首次冷启动从空缓存到正式关卡 interactive 为 588.4 ms；共 40 请求、2,284,679 transfer bytes、2,275,763 decoded bytes、0 失败和 0 应用错误。warm reload 到 interactive 为 178.8 ms；共 39 请求、1,978,301 transfer bytes、2,275,754 decoded bytes、0 失败和 0 应用错误。冷/暖启动均只有 15 个 `Image` 请求，15/15 都使用 `/media/` 路由，素材库 thumbnail 请求均为 0；进入玩法后运行时图片 loader 最终发出 16 个去重素材请求，16 ready、0 error。

下表“前一基线”来自主任务在改造前对相同视口的 in-app browser 读数，未写入当前性能 JSON；当前固定时长数据来自 headless CDP。两种浏览器面适合做方向性核对，不能计算严格加速比。真正同一可见浏览器面的 1280×720 前后读数另列在表后。

| 场景 / 视口 / 档位 | 测量窗口 | 运行时素材 | 图片 + tint RGBA 估算 | 平均 FPS | 平均 / P95 / 最差帧时 | 前一基线 | 结论 |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| `combined-horizontal` / 1280×720 / high | 10 秒 | 16 ready / 0 error | 2.66 + 3.76 MiB | 111.546 | 8.965 / 16.666 / 24.999 ms | 改造前同视口 in-app：36.4 FPS，27.44 / 40.30 / 80.40 ms | 通过；4 帧超过 16.7 ms，0 帧超过 33.3 ms。不同浏览器面不能用 FPS 比值作为严格加速比。 |
| `combined-horizontal` / 1600×1000 / high | 10 秒 | 16 ready / 0 error | 2.66 + 3.76 MiB | 99.899 | 10.010 / 16.666 / 49.998 ms | 改造前 in-app：36.2 FPS，27.61 / 33.70 / 58.30 ms | 通过；9 帧超过 16.7 ms，其中 3 帧超过 33.3 ms，0 帧超过 50 ms。 |
| `combined-horizontal` / 800×900 / high | 10 秒 | 16 ready / 0 error | 2.66 + 3.76 MiB | 117.499 | 8.511 / 8.333 / 24.999 ms | 改造前 in-app：53.3 FPS，18.77 / 26.30 / 27.00 ms | 通过；2 帧超过 16.7 ms，0 帧超过 33.3 ms。 |
| `combined-vertical` / 1280×720 / high | 10 秒 | 16 ready / 0 error | 2.66 + 6.42 MiB | 117.050 | 8.543 / 8.333 / 24.999 ms | 无同关旧固定时长基线 | 通过；摄像机横向范围 1127.124 px、纵向位移 176.229 px；1 帧超过 16.7 ms。 |
| `combined-hazards` / 1280×720 / high | 10 秒 | 16 ready / 0 error | 2.66 + 9.08 MiB | 105.887 | 9.444 / 16.666 / 24.999 ms | 无同关旧固定时长基线 | 通过；1 帧超过 16.7 ms，0 帧超过 33.3 ms。 |
| `combined-horizontal` / 1280×720 / low + 4× CPU throttle | 5 秒 | 16 ready / 0 error | 2.66 + 3.76 MiB | 95.834 | 10.435 / 16.666 / 24.999 ms | 受控降级样本，无同配置旧基线 | 通过降级功能门禁；17 帧超过 16.7 ms，0 帧超过 33.3 ms。自动降为 12 层上限、0.42 密度、2 px 最大 blur，`sceneDraws=9`；这是受控模拟，不是宿主低端机实测。 |

同一可见 in-app browser 的 1280×720 warm 样板由改造前 36.4 FPS、P95 40.30 ms、最差 80.40 ms，变为当前 JSON 记录的 64.3 FPS、P95 21.9 ms、最差 25.3 ms；当前画面同时为 `sceneDraws=10`、`objectAssetDraws=50`、`fallbackDraws=11`。这是较适合直接前后比较的一组，但仍是 rolling overlay 读数，不替代上表的固定时长 CDP 样本。

20 次正式关卡切换全部完成后，runtime 仍为 16 ready / 0 error；tint cache 为 93 variants / 15.66 MiB，最终 `cacheEntries=16`、`evictions=0`。强制 GC 后 CDP JS heap 相对切换前减少 1,536,876 bytes。最终 texture 合计 19,210,560 bytes（约 18.32 MiB）是按图片/Canvas 尺寸 × 4 RGBA bytes 得出的 **VisualRuntime 估算**；Chrome/CDP 未提供本 Canvas 页面可靠的独立 GPU 显存读数，因此本文不声称测得了显存。

跨内容性能抽样还覆盖最重 Celeste 白盒 `celeste.temple.a.d-01`（1280×720：119.249 FPS，P95 8.333 ms，最差 24.999 ms）和最重 Ori 白盒 `ori.mount-horu.central-shaft`（1280×720：119.999 / 8.333 / 8.808；1600×1000：120.049 / 8.333 / 8.333；800×900：119.949 / 8.333 / 16.666）。这些仅证明选定白盒在迁移、公共素材默认和程序化回退下的性能，不代表 908 个参考房间已完成逐房美术。

### 10 关视觉验收

浏览器 JSON 的 `formalLevelSweep.loadedLevelIds` 明确列出以下 10 关，汇总结果为 10 passed / 0 failed：各主题 palette 可区分，路线与碰撞 cue 可读，前景未遮住关键提示/HUD，scene/object 图片未见可见接缝或洋红边。表中“程序化基线 → 主题”是配置前后关系；本轮没有把 10 组同视口静态截图提交进仓库。固定时长 trace 已覆盖样板三视口、垂直关、危险密集关和 low-tier，其余正式关卡保留可见巡检证据。

| 关卡 | before → after | 构图/层次 | 接缝与可读性 | 帧率证据 | 本地结论 |
| --- | --- | --- | --- | --- | --- |
| `movement-lab-01` | 程序化基线 → 月绳幽径 | 8 层；冷青月色与亮绳索 | 汇总巡检通过 | 可见巡检；无独立 10 秒样本 | 视觉通过；静态 before/after 待固化。 |
| `hard-bar-lab` | 程序化基线 → 琥珀根庭 | 8 层；暖金根木与低雾密度 | 汇总巡检通过 | 可见巡检；无独立 10 秒样本 | 视觉通过；静态 before/after 待固化。 |
| `bash-lab` | 程序化基线 → 紫辉花林 | 8 层；紫罗兰树层与亮猛击核心 | 汇总巡检通过 | 可见巡检；无独立 10 秒样本 | 视觉通过；静态 before/after 待固化。 |
| `double-jump-lab` | 程序化基线 → 青苔跃谷 | 8 层；绿苔与清爽中景 | 汇总巡检通过 | 可见巡检；无独立 10 秒样本 | 视觉通过；静态 before/after 待固化。 |
| `glide-lab` | 程序化基线 → 雾风树冠 | 8 层；慢视差树冠与游雾 | 汇总巡检通过 | 可见巡检；无独立 10 秒样本 | 视觉通过；静态 before/after 待固化。 |
| `dash-lab` | 程序化基线 → 电光裂林 | 8 层；蓝紫高对比与增强光点 | 汇总巡检通过 | 可见巡检；无独立 10 秒样本 | 视觉通过；静态 before/after 待固化。 |
| `combined-speed` | 程序化基线 → 金萤飞径 | 8 层；暖金点与高速路线亮暗分离 | 汇总巡检通过 | 可见巡检；无独立 10 秒样本 | 视觉通过；静态 before/after 待固化。 |
| `combined-horizontal` | 程序化基线 → 深月长廊 | 样板 8 层；完整横向视差 | 汇总巡检通过 | 10 秒 × 3 视口 + low-tier；见性能表 | 视觉与性能通过；静态 before/after 待固化。 |
| `combined-vertical` | 程序化基线 → 天穹古树 | 8 层；冷蓝纵深与高耸树干 | 汇总巡检通过 | 10 秒 1280×720：117.050 FPS，P95 8.333 ms，最差 24.999 ms | 视觉与性能通过；静态 before/after 待固化。 |
| `combined-hazards` | 程序化基线 → 绯荆沼泽 | 8 层；暗紫沼泽与绯红危险物 | 汇总巡检通过 | 10 秒 1280×720：105.887 FPS，P95 16.666 ms，最差 24.999 ms | 视觉与性能通过；静态 before/after 待固化。 |

### 908 个参考白盒复验

本轮不仅执行 `npm run check`，还在参考内容指纹 `13ca025a74bdb299db7314c9a31011bc7f6be6b93e30c72aff07f03dfc39da39` 上刷新浏览器审计：908/908 load、2326 个 entrance、8.2 秒、0 failure/0 新日志；908/908 acceptance、3668 个 connection、908 次 re-entry、20.5 秒、0 failure/0 新日志；continuous run 44/44 collection、864 transitions、28.7 秒、0 reset/0 failure/0 新日志。它们证明参考白盒在当前统一文档、迁移和运行时链路中继续可加载、可连通、可安全回退；其边界仍是白盒而不是逐房原创场景美术，不能计入“全部房间已美术化”。具体证据见 `levels/reference/browser-load-audit.json`、`browser-acceptance-audit.json` 和 `continuous-run-audit.json`。

### Sites 发布与线上复验

首个公开验收版本为 v12。它使用已推送的精确 commit 和官方 Sites 打包器生成 980 文件归档；部署成功后重新打开公开地址完成真实浏览器工作流。v12 复验发现直接 `/assets/*.webp` 由 Sites 静态资源层响应为 `application/octet-stream` 且未使用项目期望的一小时缓存；静态 `_headers` 在该托管包装层也未改变线上响应。当前最终候选因此让浏览器请求 `/media/*`，由 Worker 映射到同一 `/assets/*` 文件并显式设置 MIME 与缓存头；registry、素材审计和归档仍以真实 `assets/` 文件为准。**该最终候选尚待主任务保存为新的 Sites 版本、部署并复验，不预填版本号。**

| 项目 | 当前轮结果 |
| --- | --- |
| 公开地址 | `https://cablester-game.visiontw.chatgpt.site`；2026-08-12 已重新打开公开版本复验。 |
| Sites 版本 | 历史验收版本 v12；当前 982 文件最终候选待主任务保存版本后填写，**不预设版本号**。 |
| 发布状态与时间 | v12 历史 deployment `appgdep_6a7b57439ae4819190c4c9d934087c86` 为 `succeeded`；当前最终候选的 deployment ID、状态与时间待主任务发布后填写。 |
| 线上入口与素材加载 | **通过**：未进入素材模式时 0 张素材图；进入后 17 张卡片、16 张缩略图且路径均在 `/thumbnails/`；场景编辑器显示 8 层。正式样板加载原创场景和物件图，未见洋红边或可见接缝。 |
| 线上保存/导入导出/试玩 | **通过**：公开版本显示“关卡已保存到这台设备”；通过真实 file chooser 导入 v1 JSON 并显示“已导入关卡，请确认后保存”；导出显示“关卡 JSON 已导出”；一键试玩正常切回游戏画布。 |
| 线上无缝场景、控件与 console | **通过**：`combined-horizontal` 横向主题场景、玩法路线和前景层级可读；原生 option 为浅底深字；console error/warning 均为 0。缺失素材回退由自动测试覆盖，本轮线上未人为制造 404。 |
| 遗留风险 | 当前已知：Sites `/media/` 响应头复验待主任务完成；逐关静态 before/after 未入库；1600×1000 样板最差 49.998 ms；单字段重置和人为 404 回退的独立浏览器证据待固化；GPU 显存只有估算。 |
| 下一轮建议 | 固化 10 组同视口静态 before/after；在真实低端设备复测 low-tier 与偶发长帧；增加显式 404 注错录像和单字段重置浏览器步骤；如继续美术化 908 个参考白盒，应建立独立 preset 规则，不能沿用正式 10 关的验收结论。 |
