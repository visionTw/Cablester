# Cablester

Cablester 是一个高速横版移动游戏原型。当前阶段使用浏览器 Canvas 快速验证软绳摆荡、硬杆支撑、八方向冲刺、猛击、二段跳、滑翔、血蓝资源和关卡旋转；体验验收后再迁移到 Godot 4.x。

## 当前阶段

开发规划和验收标准见 [`docs/DEVELOPMENT_PLAN.md`](docs/DEVELOPMENT_PLAN.md)。

浏览器原型 0.4 已支持：

- 跑跳、墙抓与二段跳；
- 鼠标瞄准的软绳摆荡；
- 固定长度、双端连接的撑杆跳硬杆；
- 当前方向及八方向空中冲刺；
- 血量、蓝量、伤害与检查点；
- 固定测试关卡和整体旋转房间；
- 开始界面选择关卡；六个单项3C关卡和四个综合关卡；
- 关卡工坊：统一 v2 物件文档、画布编辑、种子生成、设备内保存、JSON 导入导出和一键试玩；
- 关卡支持编辑器：七项 3C 开局能力切换、机制覆盖警告、关内拾取识别和一键补齐；
- 物件素材编辑器：分类、搜索、缩略图、单个/同类型替换、逐项/类型/项目默认重置、拉伸/九宫格/平铺和程序化安全回退；
- 场景分层编辑器：背景、中景、玩家层、前景与自定义深度层，支持视差、无缝重复、雾化、混合和质量降级；
- 统一 AssetRegistry：当前登记 1 个程序化回退和 22 个原创 ImageGen WebP 素材，其中 8 个玩法素材、14 个场景素材；
- 10 个正式关卡已接入各 12 层的统一森林视觉 preset，并按实际机制配置开局能力和不可抓取的关卡边缘空气墙；908 个参考房间保持白盒范围，加载时迁移并使用类型默认/程序化回退，不视为逐房间美术完成。

当前实现状态和试玩问题见 [`docs/PROTOTYPE_VALIDATION.md`](docs/PROTOTYPE_VALIDATION.md)。浏览器版通过体验验收前不会开始 Godot 迁移。

单项3C使用 `L0–L4` 标记验收状态，规则见 [`docs/ACCEPTANCE_LEVELS.md`](docs/ACCEPTANCE_LEVELS.md)。只有达到 `L1` 及以上的能力才开放 Godot 同步开发；当前软绳、猛击和二段跳为 `L1`，其余单项能力暂为 `L0`。

Web Canvas 会根据 CSS 显示尺寸和设备像素比动态生成高清绘制缓冲，同时维持 `1280×720` 玩法逻辑坐标。Godot 的对应缩放方案见 [`docs/RESOLUTION_SCALING.md`](docs/RESOLUTION_SCALING.md)。

## 本地运行

```bash
npm run dev
```

然后访问 `http://localhost:4173`。

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
npm run build
```

主要手感参数集中在 [`src/config.js`](src/config.js)，完整关卡套件位于 [`src/levels.js`](src/levels.js)，软绳基准关卡位于 [`src/level.js`](src/level.js)。关卡目录见 [`docs/LEVEL_CATALOG.md`](docs/LEVEL_CATALOG.md)。

关卡文档统一使用 `objects[]`，每个物件都由 `type`、`position` 和类型专属 `properties` 描述，进入游戏前再编译为现有运行时关卡格式。开局 3C 支持以根字段 `startingAbilities` 为唯一数据源；视觉配置位于 `properties.visual`，分层场景位于同一文档的 `scene`，均不建立平行玩法数据。

相关文档：

- [`docs/LEVEL_EDITOR.md`](docs/LEVEL_EDITOR.md)：v2 文档、四模式工坊、能力支持、迁移、保存和运行时编译；
- [`docs/ASSET_LIBRARY.md`](docs/ASSET_LIBRARY.md)：AssetRegistry、当前素材清单、ImageGen 处理和授权边界；
- [`docs/SCENE_LAYERS.md`](docs/SCENE_LAYERS.md)：图层字段、无缝计算、渲染 pass、缓存和质量降级；
- [`docs/ART_RELEASE.md`](docs/ART_RELEASE.md)：10 关主题、908 参考白盒边界，以及浏览器、性能和 Sites 发布证据模板；
- [`docs/LEVEL_CATALOG.md`](docs/LEVEL_CATALOG.md)：正式关卡目录；
- [`docs/REFERENCE_LEVEL_MANIFEST.md`](docs/REFERENCE_LEVEL_MANIFEST.md)：参考房间范围与计数。
