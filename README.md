# Cablester

Cablester 是一个高速横版移动游戏项目。仓库中的引擎无关 canonical World Package 是正式内容唯一权威：Web 负责本地世界/关卡生产、四级预览与 3C 实验，Godot 4.7.1 负责导入同一数据、正式运行、resolved snapshot、telemetry 与本地导出包。

## 当前阶段

第一阶段架构、执行边界和验收证据见 [`docs/CANONICAL_WORLD_PACKAGE.md`](docs/CANONICAL_WORLD_PACKAGE.md)、[`docs/PHASE_ONE_EXECUTION.md`](docs/PHASE_ONE_EXECUTION.md) 与 [`docs/PHASE_ONE_REPORT.md`](docs/PHASE_ONE_REPORT.md)。本地自动化基础已按 14 项停止条件收尾；当前允许通过 Git commit/push 同步源码和可移植证据供多机开发，但不部署网页，也不把历史 Sites 收据作为当前证据。真人主观手感与最终画面仍明确标为 `needed`，转入后续 Godot 应用开发，不冒充机器已批准。

后续开发全面以 Godot 应用为主；Web 保留为本地 canonical 数据编辑器、预览器和 3C 对等实验室，不再承担当前发布目标。

当前实现包括：

- 跑跳、墙抓与二段跳；
- 鼠标瞄准的软绳摆荡；
- 固定长度、双端连接的撑杆跳硬杆；
- 当前方向及八方向空中冲刺；
- 血量、蓝量、伤害与检查点；
- 固定测试关卡和整体旋转房间；
- 开始界面选择关卡；六个单项3C关卡和四个综合关卡；
- 原有关卡工坊：统一 v2 物件文档、画布编辑、种子生成、设备内草稿、JSON 导入导出和一键试玩；
- 世界工作室：canonical v3 World/Region/Chunk/Object、拓扑/状态/流式参数、稳定 ID、搜索、复制、撤销/重做、确定性仓库保存、diff、Worker validation 与 Web 试玩；
- 四级世界预览：世界、Region、Chunk 邻域，以及 Godot resolved snapshot/manifest/telemetry 回读；
- 关卡支持编辑器：七项 3C 开局能力切换、机制覆盖警告、关内拾取识别和一键补齐；
- 物件素材编辑器：分类、搜索、缩略图、单个/同类型替换、逐项/类型/项目默认重置、拉伸/九宫格/平铺和程序化安全回退；
- 场景分层编辑器：背景、中景、玩家层、前景与自定义深度层，支持视差、无缝重复、雾化、混合和质量降级；
- 统一 AssetRegistry：当前登记 1 个程序化回退和 25 个原创 ImageGen WebP 素材，其中包含 3 个暮种林模块化地标；
- 10 个正式关卡已接入各 12 层的统一森林视觉 preset，并按实际机制配置开局能力和不可抓取的关卡边缘空气墙；908 个参考房间保持白盒范围，加载时迁移并使用类型默认/程序化回退，不视为逐房间美术完成。

Godot 使用 `GODOT_VERSION` 固定的精确稳定 build；`scripts/godot.sh` 会拒绝错误版本。正式 World Package 位于 `worlds/formal/`，10 个 3C canonical 案例位于 `worlds/labs/`，派生诊断位于 `artifacts/godot/`，均不得在 `.tscn` 中另藏正式布局。

单项 3C 使用 `L0–L4` 标记体验验收状态，规则见 [`docs/ACCEPTANCE_LEVELS.md`](docs/ACCEPTANCE_LEVELS.md)。工程实现、共享固定输入的自动对等与真人批准是三种独立状态，详见 [`docs/3C_PARITY_MATRIX.md`](docs/3C_PARITY_MATRIX.md)；未通过轨迹容差时不能标为 `automated-pass`，机器结果也不能冒充真人批准。

Web Canvas 会根据 CSS 显示尺寸和设备像素比动态生成高清绘制缓冲，同时维持 `1280×720` 玩法逻辑坐标。Godot 的对应缩放方案见 [`docs/RESOLUTION_SCALING.md`](docs/RESOLUTION_SCALING.md)。

## 本地运行

```bash
npm run dev
```

终端会打印带一次性 repository capability 的本地地址；需要仓库读写时请打开该完整地址。直接访问 `http://localhost:4173` 只提供只读界面。

操作：

- `A/D`：移动；
- `Ctrl`：朝当前面向冲刺；按住 `W/A/S/D` 或方向键再按 `Ctrl` 可朝八个方向冲刺，空中使用一次，落地恢复；
- `Space`：跳跃，获得能力后可二段跳；
- `Shift`：靠墙时抓墙；
- 鼠标左键按住：朝指针方向发射软绳，只会吸附直线可达的第一层锚点、墙壁、天花板或斜面；绳头飞到目标后才建立约束；
- 松开鼠标左键：立即解除物理约束，绳头带柔软弯曲过程回收到角色；
- 软绳连接时按住 `W` 或上方向键持续收绳；收绳会快速加速，到达最短绳长时获得一次额外向心速度；绳索不能主动放长，`Space` 保持为跳跃与滑翔输入；
- `F`：命中直线可达的第一层墙壁、地面、斜面或伤害区域底部碰撞面后连接角色与命中点；杆长固定，`A/D` 沿圆弧切向加减速，再按 `F` 释放并保留切向速度；
- `Q`：靠近紫色六边支点后按住进入最长 0.9 秒猛击时停，移动鼠标选择方向；松开 `Q` 立即按当前方向猛击，若始终按住则在时停结束时自动释放；
- 下落时按住 `Space`：拥有滑翔能力时展开滑翔翼；
- `R`：随时触发一次 90 度旋转测试；
- `Backspace`：返回最近安全点；
- `P`：暂停；反引号：显示调试数据；
- `Esc`：返回关卡选择。

绳索或硬杆连接期间，`A/D` 不再直接修改水平速度：新按下方向时提供一次起步脉冲；与当前角速度同向时按现有速度泵速，反向时按现有速度比例制动。持续按住方向不会产生能够抵消重力的恒定推力，因此角色不会静止悬挂在固定角度。伤害区域底座具有单向碰撞，角色落入后会停在坑底，并在仍处于区域内时每秒损失 1 点生命。

软绳外观由实时张力驱动：发射和回收时会表现出额外柔软弯曲，快速通过摆荡最低点时接近拉直，接近最高点或出现松绳时会沿重力方向明显弯曲；绳形使用平滑插值连续过渡。移动或冲刺途中连接绳索、硬杆时保留切向惯性，绕支点运动后通过轻量阻尼逐渐减速，释放时继续保留当前速度。

## 检查

```bash
npm test
npm run check
npm run assets:audit
npm run world-studio:audit
npm run 3c:parity
npm run build
scripts/godot.sh --headless --path . -- --test-worlds
scripts/godot.sh --headless --path . -- --import-world worlds/formal/first-forest.world.json
godot/tools/rebuild_artifacts.sh
npm run godot:export-acceptance
```

主要手感参数集中在 [`src/config.js`](src/config.js)，完整关卡套件位于 [`src/levels.js`](src/levels.js)，软绳基准关卡位于 [`src/level.js`](src/level.js)。关卡目录见 [`docs/LEVEL_CATALOG.md`](docs/LEVEL_CATALOG.md)。

关卡文档统一使用 `objects[]`，每个物件都由 `type`、`position` 和类型专属 `properties` 描述，进入游戏前再编译为现有运行时关卡格式。开局 3C 支持以根字段 `startingAbilities` 为唯一数据源；视觉配置位于 `properties.visual`，分层场景位于同一文档的 `scene`，均不建立平行玩法数据。

相关文档：

- [`docs/PHASE_ONE_REPORT.md`](docs/PHASE_ONE_REPORT.md)：第一阶段本地 14 项停止条件、冻结证据和 Godot 后续方向；
- [`docs/LEVEL_EDITOR.md`](docs/LEVEL_EDITOR.md)：v2 文档、四模式工坊、能力支持、迁移、保存和运行时编译；
- [`docs/ASSET_LIBRARY.md`](docs/ASSET_LIBRARY.md)：AssetRegistry、当前素材清单、ImageGen 处理和授权边界；
- [`docs/SCENE_LAYERS.md`](docs/SCENE_LAYERS.md)：图层字段、无缝计算、渲染 pass、缓存和质量降级；
- [`docs/ART_RELEASE.md`](docs/ART_RELEASE.md)：10 关主题、908 参考白盒边界、本地美术验收，以及历史 Sites 快照；
- [`docs/LEVEL_CATALOG.md`](docs/LEVEL_CATALOG.md)：正式关卡目录；
- [`docs/REFERENCE_LEVEL_MANIFEST.md`](docs/REFERENCE_LEVEL_MANIFEST.md)：参考房间范围与计数。
