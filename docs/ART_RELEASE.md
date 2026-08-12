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
- 4 个基础角色层：远景树干、中景古树、玩家附近灌木，以及带权重混排暗藤/暗影蕨叶的前景；
- 8 个自定义层：深远根峰、月影树冠、盘根遗迹、水青铃花、发光植物、游雾、中远景树组、生物光点；
- 共 12 个 scene layer，引用当前 14 个场景素材；平台默认素材 `gameplay:moss-platform` 使用标准九宫格：四角固定、四边单轴拉伸、中心双轴拉伸；
- slope、风场、液体、黑暗、旋转、移动物件、机关门等尚无专用图片时继续使用 type/project 默认和程序化安全表现。

正式关卡的能力和边界仍属于玩法数据，不由美术 preset 注入：`startingAbilities` 直接来自关卡文档；10 关都在 bounds 左右外沿配置不可抓取的单向 `boundaryWall`，`combined-vertical` 另有顶部空气墙，底部保持开放。

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
| `combined-horizontal` | 综合 · 水平穿越 | 深月长廊 | 样板关；原色资产、完整 12 层场景和长距离横向视差。 |
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
4. 在浏览器逐项验收四个编辑模式、关卡支持、九宫格预览、空气墙编辑、保存、导入导出、一键试玩和原生下拉可读性。
5. 记录正式关卡的首次加载、请求、内存、平均 FPS、P95 和最差帧；至少覆盖样板、垂直关、危险密集关和 low-tier。
6. 对 10 关逐一保存同视口 before/after 截图或视频证据，并记录遮挡、接缝和主题一致性结论。
7. 构建通过后发布到 Sites；记录版本和状态，再重新打开公开地址确认新入口、素材请求、编辑保存和试玩。
8. 只有上述证据全部属于当前 commit/构建，才可把本轮发布标记为完成。

## 当前增量候选（2026-08-12）

当前代码与磁盘配置、浏览器验收、性能审计、参考白盒复验和 Sites 公开版本均已有当前证据：

- AssetRegistry 为 23 条：`builtin:procedural` + 22 个 ImageGen 透明 WebP；图片分为 8 gameplay + 14 scene，22 个主图为 456,262 bytes，22 个缩略图为 116,680 bytes。
- 2026-08-12 新增 6 个小型场景素材：`scene:moonlit-canopy-cluster`、`scene:distant-root-spires`、`scene:root-stone-arch`、`scene:shadow-fern-cluster`、`scene:moss-root-boulders`、`scene:aqua-bell-flowers`。完整尺寸、字节、路径、提示词、生成方式和授权见 [ASSET_LIBRARY.md](ASSET_LIBRARY.md) 与 registry。
- 10 个正式 `LEVELS` 各为 12 个 scene layer；开局能力通过 canonical `startingAbilities` 配置，机制缺口由“关卡支持”模式提示；每关有左右空气墙，垂直综合关另有顶部空气墙。
- 平台类型默认素材已登记九宫格切片，物件 visual 可选 `asset`、`stretch`、`nine-slice`、`tile` 和 `tileScale`，仍不改变碰撞。

当前证据文件为 [`levels/art/browser-acceptance-audit.json`](../levels/art/browser-acceptance-audit.json)、[`levels/art/performance-audit.json`](../levels/art/performance-audit.json)、[`levels/reference/browser-load-audit.json`](../levels/reference/browser-load-audit.json)、[`levels/reference/browser-acceptance-audit.json`](../levels/reference/browser-acceptance-audit.json) 和 [`levels/reference/continuous-run-audit.json`](../levels/reference/continuous-run-audit.json)。

| 门禁 | 当前状态 | 当前证据或剩余门禁 |
| --- | --- | --- |
| `npm run assets:audit` | **通过：22 个生成素材，44/44 文件，0 错误** | 本文档更新时在当前工作树重跑；559.5 KiB on disk、4994.1 KiB decoded。若素材或 registry 再改必须重跑。 |
| `npm test` / `npm run check` / `npm run build` | **通过** | `npm test` 152/152、0 失败（Node 2.913 秒）；`npm run check` 为 10 个正式关 + 908 个参考房；`npm run build` 生成 997 个文件、17,970,537 bytes，`node --check dist/server/index.js` 与 `git diff --check` 通过。 |
| 本地浏览器 | **通过** | 2026-08-12 22:00–22:10（Asia/Shanghai）：`combined-horizontal` 首个可见画面已是 22 ready / 0 loading / 0 error；真实右移、跳跃和冲刺 10 秒以上时请求数保持 22，九宫格试玩只出现单一顶部苔藓带；console error/warning 为 0。 |
| 性能 | **通过** | `status: pass`；输入指纹 `41192789b335fcbd40796e092645a3b05341957cc60667af03007e35fb688023`，覆盖 72 个文件；所有正式/参考样本均 `loading=0`、`error=0`、`sceneResidencyDeficits=0`，20 次切关新增请求为 0。 |
| 908 参考白盒 | **通过当前工程门禁** | 内容指纹 `a92443959bb2a1c140239f64a7298a8d1455499556a92e1837210fd005fc6849`，934 文件（908 room + 26 runtime）；load、逐房 acceptance 和 44 集合连续主路线均通过。主观手感与原作保真仍需人工判断。 |
| Sites | **通过：v18 已公开发布并在线复验** | runtime commit `9aa94398f399f3cd2754cf972086c31ccdca5012`，deployment `appgdep_6a7c7fc9357881919216b5fa808cc513` 状态 `succeeded`；公开首帧、九宫格、素材响应头与控制台均复验通过。 |

### 当前本地浏览器验收

Codex in-app browser 在 1280×720 截图面、`http://127.0.0.1:4173/` 完成可见巡检。10 个正式关卡全部从菜单进入，12 层场景共同显示新增深远背景、中景地标、近路铃花与前景蕨叶；九宫格平台保持碰撞轮廓可读，空气墙在试玩中没有产生可见杂物，前景也未盖住 HUD 和玩法提示。

| 项目 | 结果 | 当前证据 |
| --- | --- | --- |
| 四模式入口 | **通过** | `物件编辑`、`关卡支持`、`物件素材`、`场景分层` 均有明显入口。 |
| 关卡支持 | **通过** | 7 项能力开关可用；软绳实验场开局为 rope、hardBar、dash、wallGrab；关闭 hardBar 会出现覆盖警告，undo 可恢复；10 个正式关和 908 个参考房间的自动能力覆盖分析均通过。 |
| 素材与九宫格 | **通过** | 23 张 registry 卡、22 张图片缩略图；platform 有 2 张适用卡；Inspector 实时 Canvas 可见 `nine-slice`，切线为 L96/R96/T32/B34 px，`tileScale` 范围为 0.1–8，编辑器和运行时变换一致。 |
| 空气墙 | **通过** | 工坊以虚线 bounds 显示空气墙；10 关试玩未产生运行时视觉杂物。 |
| 场景分层 | **通过** | 初始 12 层，picker 15 个选项；实时画布、新建/undo 和恢复 12 层通过；可见深远根峰、月影树冠、盘根遗迹和水青铃花层。 |
| 文档工作流 | **通过** | 设备内保存、真实 file chooser 导入 `levels/reference/celeste/prologue/a/0.json`（v1→v2）、导出和一键试玩均通过。 |
| 原生控件与日志 | **通过** | 关卡、分类、缩放模式、scene role/asset、blend 和 seamless 下拉均可读；本轮新 console error/warning 为 0。 |

### 当前性能、请求与内存

标准性能审计生成于 2026-08-12 22:00（Asia/Shanghai），Chrome 119 headless 通过真实 `startPrepared` 门禁和 CDP 按键记录连续 `requestAnimationFrame`。冷启动从空缓存到 10 个正式关 interactive 为 217.1 ms：49 请求、21 个 Image、0 失败和 0 应用错误；warm reload 为 141.1 ms：48 请求、21 个 Image 且全部命中缓存、0 失败和 0 应用错误。

| 场景 / 视口 / 档位 | 测量窗口 | 平均 FPS | 平均 / P95 / 最差帧时 | 运行时结论 |
| --- | ---: | ---: | ---: | --- |
| `combined-horizontal` / 1280×720 / high | 10 秒 | 76.099 | 13.141 / 24.999 / 24.999 ms | camera range 1656.080；开始/结束均 22 ready、0 loading/error/驻留缺口。 |
| `combined-horizontal` / 1600×1000 / high | 10 秒 | 61.828 | 16.174 / 24.999 / 33.332 ms | 0 loading/error/驻留缺口。 |
| `combined-horizontal` / 800×900 / high | 10 秒 | 83.434 | 11.985 / 16.666 / 24.999 ms | 0 loading/error/驻留缺口。 |
| `combined-vertical` / 1280×720 / high | 10 秒 | 74.824 | 13.365 / 16.666 / 24.999 ms | 0 loading/error/驻留缺口。 |
| `combined-hazards` / 1280×720 / high | 10 秒 | 70.641 | 14.156 / 24.999 / 24.999 ms | 0 loading/error/驻留缺口。 |
| `combined-horizontal` / 1280×720 / low + 4× CPU throttle | 5 秒 | 95.955 | 10.422 / 16.666 / 24.999 ms | 16 scene draw；0 loading/error/驻留缺口，camera range 1230.811。 |

20/20 次正式关卡切换后没有新增网络请求；VisualRuntime 为 22 ready / 0 loading / 0 error、0 驻留缺口、22 cache entries、0 eviction。强制 GC 后 CDP retained JS heap 相对切换前减少 1,438,544 bytes（约 1.37 MiB）。纹理估算仍为 decoded 4,489,808 bytes + tint 25,905,504 bytes = 30,395,312 bytes（约 28.99 MiB）；这是按图片/Canvas 尺寸乘 RGBA 4 bytes 的 VisualRuntime 估算，不是实测 GPU 显存。

### 当前 10 关视觉验收

当前浏览器 sweep 为 10 passed / 0 failed；下表全部是 12 层正式 preset，而不是上一轮 8 层快照。没有为每关提交静态 before/after 文件，因此“程序化基线 → 主题”仍是配置关系；可见巡检与固定时长性能数据是当前证据。

| 关卡 | before → after | 当前 12 层构图 | 帧率证据 | 当前结论 |
| --- | --- | --- | --- | --- |
| `movement-lab-01` | 程序化基线 → 月绳幽径 | 冷青月色、远根/树冠、盘根地标与亮绳索 | 10/10 可见 sweep | 通过；rope/hardBar/dash/wallGrab 开局支持已核对。 |
| `hard-bar-lab` | 程序化基线 → 琥珀根庭 | 暖金根木、低雾、铃花和暗蕨前景 | 10/10 可见 sweep | 通过；hardBar 能力支持与九宫格平台可读。 |
| `bash-lab` | 程序化基线 → 紫辉花林 | 紫罗兰树层、盘根遗迹与高亮猛击核心 | 10/10 可见 sweep | 通过；关键猛击支点未被新前景遮挡。 |
| `double-jump-lab` | 程序化基线 → 青苔跃谷 | 绿苔平台、远根纵深和清爽中景 | 10/10 可见 sweep | 通过；路线和平台轮廓可读。 |
| `glide-lab` | 程序化基线 → 雾风树冠 | 慢视差树冠、游雾、铃花与深远根峰 | 10/10 可见 sweep | 通过；风场路线与 HUD 保持可读。 |
| `dash-lab` | 程序化基线 → 电光裂林 | 蓝紫高对比、光点和中景遗迹 | 10/10 可见 sweep | 通过；高速路线与空气墙无可见穿帮。 |
| `combined-speed` | 程序化基线 → 金萤飞径 | 暖金点、根石地标与前中后景分离 | 10/10 可见 sweep | 通过；能力覆盖和关键交互可读。 |
| `combined-horizontal` | 程序化基线 → 深月长廊 | 样板 12 层；完整长距离横向视差 | 10 秒 × 3 视口 + low-tier | 视觉与性能通过；三视口最差帧不高于 33.332 ms。 |
| `combined-vertical` | 程序化基线 → 天穹古树 | 冷蓝纵深、高耸树干与顶部空气墙 | 74.824 FPS；P95 16.666 ms；最差 24.999 ms | 视觉与性能通过。 |
| `combined-hazards` | 程序化基线 → 绯荆沼泽 | 暗紫沼泽、绯红危险物与暗蕨压边 | 70.641 FPS；P95 24.999 ms；最差 24.999 ms | 视觉与性能通过；危险物和提示未被遮挡。 |

### 当前 908 个参考白盒复验

三份审计共享内容指纹 `a92443959bb2a1c140239f64a7298a8d1455499556a92e1837210fd005fc6849`，覆盖 934 个文件（908 room + 26 runtime）：

- load：908/908 房、2326 个 entrance，29.2 秒，0 failure，0 新日志；
- acceptance：908/908 房、3668 个 connection、908 次 checkpoint reset 和 908 次 menu re-entry，48.3 秒，0 failure，0 新日志；
- continuous run：44/44 集合、908 房、864 次顺序 transition、0 death/reset，18.8 秒，0 failure，0 新日志。

这些结果证明当前指纹下的参考白盒可加载、可重置、可连通，并能完成每个集合的一条顺序主路线；它们不证明所有支路的人工手感、原作坐标或逐房美术保真。参考房间仍不计入“全部房间已原创美术化”。

### 当前 Sites 发布与线上复验

当前预载/九宫格运行时作为 Sites v18 公开发布，runtime commit 为 `9aa94398f399f3cd2754cf972086c31ccdca5012`。归档包含 997 个文件、18,728,960 bytes；deployment `appgdep_6a7c7fc9357881919216b5fa808cc513` 于 2026-08-12 22:14（Asia/Shanghai）达到 `succeeded`。公开地址为 `https://cablester-game.visiontw.chatgpt.site`。

发布后重新加载正式域名并完成以下复验：

- 菜单仍显示 10 个正式关、关卡工坊与 908/908 参考白盒入口；
- `combined-horizontal` 首个可见画面直接显示完整前中后景和单一顶部苔藓平台，没有程序化占位再切图；
- 本地与正式 CDP 证据交叉确认 10 秒真实移动期间 requests 保持 22、loading/error 为 0，20 次切关新增网络请求为 0；
- `/media/game/terrain/moss-root-platform.webp` 与 `/media/game/scene/background/distant-trunk-grove.webp` 均返回 HTTP 200、`content-type: image/webp`、`cache-control: public, max-age=3600, must-revalidate`，复验时 `cf-cache-status: HIT`；
- 正式域名浏览器 console error/warning 为 0。

## 上一轮证据快照（16 素材 / 8 层，仅作历史基线）

> 以下记录对应新增 6 项场景素材、12 层 preset、九宫格、关卡支持和空气墙之前的 16 素材/8 层工作树。保留它只为前后比较；其中任何“当前”“通过”或线上结果都只描述该历史快照，不得外推到上面的当前增量候选。仓库中的 active audit JSON 已由本轮证据覆盖，所以下方旧数值是历史抄录，不再声称由当前 JSON 支持。

### 版本、测试与构建

| 项目 | 历史快照结果 | 证据 |
| --- | --- | --- |
| commit / 工作树指纹 | 基线 `HEAD 7b50c35e28af10d49be1b18a3f9c77afc2d7f4b7`；首个公开验收 commit `81c5d9bbcb1b3fe36080577561ae847800bcb250` | 当时记录的性能输入指纹为 `95f58ed35e51b841e61ed8c574a00057c76b293733bec2a96bde22fa5bb36844`，覆盖 57 个性能相关文件；active JSON 现已是本轮 `41192789…` 证据。 |
| `npm test` | **通过：116/116，0 失败** | 2026-08-12 在最终工作树重新运行 `node --test`，总耗时 4.658 秒；包含 registry、canonical asset path、实际本地素材交付服务、单物件/同类型替换、v1/v2 roundtrip、scene、回退、素材像素审计和性能证据指纹门禁。 |
| `npm run check` | **通过：10 个正式关卡 + 908 个参考房间** | 当前命令输出 `10 built-in levels and 908 authored reference rooms passed structural validation.`；参考内容指纹 `13ca025a74bdb299db7314c9a31011bc7f6be6b93e30c72aff07f03dfc39da39` 覆盖 931 文件（908 room + 23 runtime）。 |
| `npm run assets:audit` | **通过：16 个生成素材，32/32 文件，0 错误** | 16 个运行时 WebP + 16 个缩略图共 391.5 KiB；像素解码估算 3129.1 KiB；残留洋红像素为 0，透明边缘最大 alpha 4/255，最差缩略图 RGB MAE 2.999。 |
| `npm run build` | **通过** | 最终候选 `dist/` 共 982 个文件、17,691,849 bytes，包含 16 个运行时素材、16 个缩略图、canonical asset path 模块、优先接管 `/media/*` 的 Worker 与静态资源 `_headers`；命令输出 `Cablester Sites build created in dist/.`。 |

### ImageGen 素材批次与授权

该历史快照的 registry 为 17 条：`builtin:procedural` 安全回退 + 16 个 ImageGen 透明 WebP。其当时的完整文件路径、真实尺寸/字节数、提示词、适用物件类型、生成方式和 license 均登记在对应源码快照；当前机器可读清单见 [`src/asset-library.js`](../src/asset-library.js)，当前处理规范见 [`docs/ASSET_LIBRARY.md`](ASSET_LIBRARY.md)。

| 分组 | 已接入素材 ID | 生产与 QA 结果 |
| --- | --- | --- |
| 玩法物件（8） | `gameplay:moss-platform`、`gameplay:thorn-hazard`、`gameplay:rope-anchor`、`gameplay:energy-orb`、`gameplay:bash-blossom`、`gameplay:checkpoint-lantern`、`gameplay:spawn-gate`、`gameplay:goal-gate` | 均由内置 ImageGen `gpt-image-2` 生成纯 `#ff00ff` 背景源图，再本地去色键污染、裁切、缩放并以 WebP quality 88 输出；已进入 type default、编辑器缩略图和正式关卡 preset。 |
| 场景层（8） | `scene:moss-bush-cluster`、`scene:cyan-seed-plant`、`scene:overhang-vine-branch`、`scene:ancient-amber-tree`、`scene:distant-trunk-grove`、`scene:mid-tree-cluster`、`scene:cyan-mist-band`、`scene:forest-light-motes` | 已进入场景素材选择器和 10 关八层 scene preset；本地巡检未见洋红边、明显接缝或遮挡关键 HUD/提示。 |

该快照的 16 项素材把 registry license 统一记录为 `Original AI-generated project asset`，使用范围仅声明为 **Cablester 项目运行时、编辑器、文档和公开 Sites 部署**；来源记录为 2026-08-11 使用 OpenAI 内置 ImageGen 为 Cablester 生成，未使用第三方游戏资源。该项目内记录不替代发布主体对 OpenAI 条款、商标、版权或其他适用法律的审查，registry 也没有声明独立素材包再分发范围。提示词只使用梦幻森林、生物光、手绘质感、剪影层次、冷暖色彩和空间纵深等通用语言，没有要求复制《Ori》原画、角色、标志或具体场景构图。

### 历史本地浏览器验收

历史证据为 2026-08-12 00:54（Asia/Shanghai）在 1280×720 Codex in-app browser 对 `http://127.0.0.1:4175/` 的巡检：当时记录 10/10 正式关卡加载、16/16 图片 ready、0 asset error 和 0 新 console error/warning；active browser audit JSON 现已由本轮 22 素材/12 层结果覆盖。

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

### 历史性能、请求与内存

该历史性能记录生成于 2026-08-12 01:43（Asia/Shanghai），状态为 `pass`；active performance audit JSON 现已由本轮指纹 `41192789…` 覆盖。Chrome 119 headless 当时通过 CDP 注入真实按键并记录连续 `requestAnimationFrame`；正式样板每个视口测 10 秒，`combined-vertical` 与 `combined-hazards` 各补测 10 秒，low-tier 测 5 秒。可见浏览器另记录同视口 6.5 秒 warm rolling sample，二者不能混作同一测量面。

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

### 历史 10 关视觉验收

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

### 历史 908 个参考白盒复验

历史快照当时在参考内容指纹 `13ca025a74bdb299db7314c9a31011bc7f6be6b93e30c72aff07f03dfc39da39` 上记录：908/908 load、2326 个 entrance、8.2 秒、0 failure/0 新日志；908/908 acceptance、3668 个 connection、908 次 re-entry、20.5 秒、0 failure/0 新日志；continuous run 44/44 collection、864 transitions、28.7 秒、0 reset/0 failure/0 新日志。active reference audit JSON 已由上文指纹 `a9244395…` 的本轮结果覆盖；这些旧数值只用于前后比较。

### 历史 Sites 发布与线上复验

首个公开验收版本为 v12。它使用已推送的精确 commit 和官方 Sites 打包器生成 980 文件归档；部署成功后重新打开公开地址完成真实浏览器工作流。v12 复验发现直接 `/assets/*.webp` 由 Sites 静态资源层响应为 `application/octet-stream` 且未使用项目期望的一小时缓存；静态 `_headers` 在该托管包装层也未改变线上响应。当时的后续候选因此改为让浏览器请求 `/media/*`，由 Worker 映射到同一 `/assets/*` 文件并显式设置 MIME 与缓存头；这段历史不代表当前 22 素材/12 层候选已经部署。

| 项目 | 历史快照结果 |
| --- | --- |
| 公开地址 | `https://cablester-game.visiontw.chatgpt.site`；2026-08-12 已重新打开公开版本复验。 |
| Sites 版本 | 历史验收版本 v12；当时 982 文件的后续候选未在这份快照中填写版本号。 |
| 发布状态与时间 | v12 历史 deployment `appgdep_6a7b57439ae4819190c4c9d934087c86` 为 `succeeded`。 |
| 线上入口与素材加载 | **通过**：未进入素材模式时 0 张素材图；进入后 17 张卡片、16 张缩略图且路径均在 `/thumbnails/`；场景编辑器显示 8 层。正式样板加载原创场景和物件图，未见洋红边或可见接缝。 |
| 线上保存/导入导出/试玩 | **通过**：公开版本显示“关卡已保存到这台设备”；通过真实 file chooser 导入 v1 JSON 并显示“已导入关卡，请确认后保存”；导出显示“关卡 JSON 已导出”；一键试玩正常切回游戏画布。 |
| 线上无缝场景、控件与 console | **通过**：`combined-horizontal` 横向主题场景、玩法路线和前景层级可读；原生 option 为浅底深字；console error/warning 均为 0。缺失素材回退由自动测试覆盖，本轮线上未人为制造 404。 |
| 当时遗留风险 | Sites `/media/` 响应头复验待完成；逐关静态 before/after 未入库；1600×1000 样板最差 49.998 ms；单字段重置和人为 404 回退的独立浏览器证据待固化；GPU 显存只有估算。 |
| 当时下一轮建议 | 固化 10 组同视口静态 before/after；在真实低端设备复测 low-tier 与偶发长帧；增加显式 404 注错录像和单字段重置浏览器步骤；如继续美术化 908 个参考白盒，应建立独立 preset 规则，不能沿用正式 10 关的验收结论。 |
