# 关卡工坊与 v2 关卡文档

地形笔刷、组合图章与 canonical Chunk 回写流程见 [TERRAIN_BRUSH.md](TERRAIN_BRUSH.md)。

Cablester 的关卡工坊从开始菜单进入，提供五种共用同一份关卡文档的模式：`物件编辑`、`地形刷`、`关卡支持`、`物件素材` 和 `场景分层`。五个模式共用撤销/重做历史、本地保存、JSON 导入导出和一键试玩；视觉编辑只改变美术配置，不改变碰撞、交互或玩法语义。地形刷会直接展开为既有玩法物件与少量场景图层，不创建第二套运行时地形格式。

素材登记与生成规范见 [ASSET_LIBRARY.md](ASSET_LIBRARY.md)，场景图层字段和无缝计算见 [SCENE_LAYERS.md](SCENE_LAYERS.md)，正式关卡本地写回见 [LOCAL_FORMAL_LEVEL_WORKFLOW.md](LOCAL_FORMAL_LEVEL_WORKFLOW.md)。

## 基本工作流

1. 在“物件编辑”中放置或选择物件，编辑位置和玩法属性。
2. 在“地形刷”中连续绘制平台/斜面，或放置会立即展开的组合图章；20px 吸附是可选辅助，不是 canonical 真源。
3. 在“关卡支持”中设置出生即用的七项 3C 能力，并处理能力物件覆盖警告。
4. 在“物件素材”中按分类、关键词和适用类型筛选素材，预览后应用到单个物件或同类型物件。
5. 在“场景分层”中编辑背景、中景、玩家层、前景或任意自定义深度层。
6. 使用撤销/重做检查修改，再一键试玩当前草稿。
7. 保存到当前浏览器，或导出 JSON 进入版本控制和跨设备传递。由 World Studio 打开的 canonical Chunk 则必须点击“应用到当前 Chunk”，回到 World Studio 验证并显式保存。

内置正式关卡和参考房间会以副本形式打开，不会回写源码。确定性生成器仍可按 seed、路线长度和难度创建基础路线，再进入上述五个模式继续调整。

## v2 顶层结构

关卡文档版本由 `schemaVersion: 2` 标识。顶层字段如下：

| 字段 | 用途 |
| --- | --- |
| `schemaVersion` | 当前必须为 `2`；v1 通过 `migrateLevelDocument` 升级。 |
| `metadata` | 至少包含 `id`、`name`；还可包含 `category`、`summary`、`acceptanceLevel`、`mode`。 |
| `bounds` | 关卡世界边界 `{ x, y, w, h }`，宽高必须为正数。 |
| `dashCapacity` | 冲刺容量，整数 `1–3`。 |
| `startingAbilities` | canonical 开局能力数组；支持 `rope`、`hardBar`、`bash`、`doubleJump`、`glide`、`dash`、`wallGrab`。显式空数组表示出生时没有能力。 |
| `reference` / `statePolicy` | 参考房间的来源信息和跨房间状态策略；普通关卡可省略。 |
| `objects` | 统一玩法物件数组。 |
| `scene` | 与玩法物件分离的分层场景数据。 |

玩法物件始终使用统一结构：

```json
{
  "id": "platform-1",
  "type": "platform",
  "position": { "x": 120, "y": 640 },
  "properties": {
    "w": 360,
    "h": 120,
    "visual": {
      "assetId": "gameplay:moss-platform",
      "scaleX": 1,
      "scaleMode": "asset",
      "tileScale": 1,
      "scaleY": 1,
      "anchorX": 0.5,
      "anchorY": 0.5,
      "offsetX": 0,
      "offsetY": 0,
      "flipX": false,
      "flipY": false,
      "drawLayer": 0,
      "opacity": 1,
      "tint": "#ffffff"
    }
  }
}
```

`type` 决定玩法语义和类型专属属性，`position` 是共享位置，`properties.visual` 只描述外观。不要为换素材复制一套平行的 gameplay 数据。

## 当前物件库

`src/level-objects.js` 当前定义 25 种可编辑物件：

- 关卡结构：`spawn`、`goal`、`checkpoint`、`roomEntrance`、`roomExit`、`boundaryWall`；
- 地形：`platform`、`slope`、`movingObject`、`fragilePlatform`；
- 危险与机关：`hazard`、`windZone`、`liquidZone`、`darknessZone`、`rotationTrigger`、`gate`、`stateTrigger`；
- 交互物件：`anchor`、`bashTarget`、`energyOrb`、`dashRefill`、`launcher`、`abilityPickup`；
- 引导与装饰：`sign`、`backgroundSeed`。

每种类型的玩法属性、默认值、范围和下拉选项都来自 `LEVEL_OBJECT_LIBRARY`。新增类型时必须同时完成物件定义、运行时集合映射、编译/反编译、边界计算、程序化回退绘制、素材适用类型和测试。

`boundaryWall` 是空气墙：保存宽高、`blockingSide` 和是否允许绳索/硬杆连接。`left/right/top/bottom` 表示角色应保留在命名侧，`all` 表示完整实体矩形；默认不可连接，也不会产生隐形墙抓或落地状态。工坊始终以粉色虚线显示其碰撞范围和生效面，试玩时程序化默认保持不可见；只有显式配置适用素材时才绘制素材。正式十关均在 bounds 外沿配置左右空气墙，保留底部坠落出口，垂直综合关另配置顶部阻挡。

## 关卡支持与 3C 能力

“关卡支持”模式直接编辑根字段 `startingAbilities`，不建立第二份能力配置。七项开关、启用全部、全部关闭、恢复项目默认和“补齐机制所需”操作都会进入同一撤销/重做历史，并随本地保存、JSON 导入导出和一键试玩完整往返。运行时只在字段缺失时采用项目默认；显式 `[]` 会保持为无开局能力，不再被默认能力覆盖。

工坊会从统一 `objects[]` 推导能力覆盖：`anchor`/移动锚点检查软绳，`bashTarget`/移动猛击支点检查猛击，`dashRefill` 检查冲刺，`windZone` 建议滑翔，`gate` 和 `roomExit` 检查其 `requiredAbility`。开局能力或关内 `abilityPickup` 任一存在即视为数据覆盖；由于静态检查无法证明拾取顺序可达，最终仍须一键试玩。覆盖提示不会静默改动碰撞、物件或路线，只有作者触发“补齐机制所需”时才把缺项加入 `startingAbilities`。

缺失字段的旧 v1/v2 文档迁移为项目默认开局能力；未知能力、重复能力或非数组配置会被 validation 拒绝。当前十个正式关卡的可检测机制均有能力覆盖。

## 物件素材配置

每个物件的 `properties.visual` 必须包含完整的 canonical 配置：

| 字段 | 范围或语义 |
| --- | --- |
| `assetId` | 非空素材 ID，最长 256 字符。 |
| `scaleX` / `scaleY` | `0.01–16`，以玩法 bounds 为基准缩放。 |
| `scaleMode` | `asset`、`stretch`、`nine-slice` 或 `tile`；`asset` 使用 registry 登记的默认策略。 |
| `tileScale` | `0.1–8`，调节九宫格边/中心以及整图平铺的纹理密度。 |
| `anchorX` / `anchorY` | `0–1`，定义素材相对物件中心的锚点。 |
| `offsetX` / `offsetY` | `-100000–100000`，只移动美术，不移动碰撞。 |
| `flipX` / `flipY` | 水平/垂直翻转。 |
| `drawLayer` | 整数 `-1000–1000`；数值越大越晚绘制。相同值保持原始物件顺序。 |
| `opacity` | `0–1`。 |
| `tint` | `#rrggbb` 或 `#rrggbbaa`。 |

“物件素材”模式支持：

- 分类、搜索、缩略图和“只看当前类型适用素材”；
- 单个物件应用和同类型批量应用；
- 当前物件恢复类型默认、同类型全部恢复类型默认；
- 当前物件或整份文档恢复项目默认；
- 每个 visual 字段单独重置；
- 画布与 Inspector 同步显示缩放策略、九宫格切线、图块倍率、锚点、偏移、翻转、透明度和色调效果；
- 素材缺失、不适用、尚未加载或加载失败时显示程序化安全回退。

类型默认和项目默认不是同一概念：当前 registry 的项目默认是 `builtin:procedural`；部分玩法类型拥有 ImageGen 类型默认。完整映射见 [ASSET_LIBRARY.md](ASSET_LIBRARY.md)。

## 场景分层

`scene` 与 `objects` 位于同一关卡文档，但职责分开：`objects` 决定玩法，`scene` 只决定分层美术。默认场景包含背景、中景、玩家层和前景；玩家层必须是唯一的 `role: "player"`，并固定为 `depth: 0`、`parallax: 1`。

“场景分层”模式支持新增、显示/隐藏、锁定、排序、复制和删除图层；编辑世界位置、多个带权重素材、深度、视差、缩放、透明度、色调、模糊、雾化、混合方式、横向重复、随机种子、出现范围、间距、密度和绘制上限。场景素材选择器只列 `applicableTypes` 包含 `scene` 或 `*` 的素材，添加和替换时再次校验。

背景、中景和前景仍保存在 `scene.layers`，不会混入决定碰撞与玩法的 `objects[]`；但在画布中的操作方式与关卡物件一致。左键点击场景素材即可选中并拖动其 `originX` / `originY`，右键或 `Alt` + 拖动用于平移画布，滚轮只缩放视图。场景模式优先命中场景素材，因此与平台重叠时也能选择；锁定层可选中查看但不能移动。属性面板的“网格起点 X”是横向 placement 网格的左起点，“位置 Y（底部锚点）”是 Y 向下为正的世界坐标；画布十字标记当前所选贴片的底部中心，用于观察底边 Y，并不把重复贴片中心冒充为网格起点 X。

横向重复层或带权重多素材层仍是一个 canonical 图层：拖动任意可见贴片会移动整层生成网格。要逐个摆放某棵树或装饰，应新建多个关闭“横向重复”的单素材层。

默认迁移场景仍是 4 个角色层；10 个公开 3C 测试关由 `LEVEL_ART_PRESET_BY_ID` 扩展为各 12 层（4 个角色层 + 8 个自定义深度层），并共同使用当前 14 个 scene 素材。

图层排序与运行时都以 `depth` 为首要依据；工坊的上移/下移会同步调整深度，避免列表顺序与实际绘制顺序分离。详细字段、计算公式和性能上限见 [SCENE_LAYERS.md](SCENE_LAYERS.md)。

## 保存、迁移与 roundtrip

- 当前浏览器存储键为 `cablester.level-editor.documents.v2`。
- 启动时仍读取旧的 `cablester.level-editor.documents.v1`；每份 v1 文档会先迁移，再进入 active document。
- JSON 导入、内置文档载入、历史恢复和参考文档加入工坊都统一调用 `migrateLevelDocument`。
- v1 迁移为每个物件补齐 `properties.visual`，并补充默认 `scene`；v1/v2 若缺少 `startingAbilities` 则补项目默认；输入对象不被原地修改。
- 旧 scene layer 缺少 `originY` 时，工坊副本以关卡 bounds 底边补齐世界锚点；保存或导出后 Web 与 Godot 运行时按同一显式坐标放置。
- 保存使用浏览器 `localStorage`，只在当前设备与浏览器可用；跨设备和版本控制必须导出 JSON。
- 导出前先验证 v2 文档；试玩前先编译并运行现有关卡验证。

撤销/重做保存整份 active document 快照，因此开局能力、物件属性、visual 映射、场景图层和文档设置会一起恢复，不存在多套独立历史。

## 运行时编译边界

`compileLevelDocument` 将 `objects[]` 编译回游戏当前使用的 `platforms`、`hazards`、`anchors` 等集合，并另外输出：

- `visuals[objectId]`：对象 ID 到 visual 配置的映射；
- `visualOrder[type]`：同类型运行时数组与对象 ID 的稳定对应关系；
- `scene`：原样关联的 canonical 场景配置。
- `startingAbilities`：规范化为稳定顺序的唯一开局能力数组。
- `boundaryWalls`：从统一物件编译出的独立碰撞集合，不混入普通平台语义。

因此物理、碰撞、检查点、能力和房间转换继续读取原有运行时集合；视觉运行时只消费 `visuals`、`visualOrder` 和 `scene`。反向 `levelToDocument` 会保留 visual、scene、`acceptanceLevel`、参考来源和状态策略，保证文档 roundtrip 不丢失这些信息。

## 验证与扩展清单

修改文档模型或编辑器后至少检查：

1. v1/v2 迁移、能力支持、v2 validation 和 JSON roundtrip；
2. 单物件/同类型素材替换与各级重置；
3. scene 新增、更新、排序、复制、删除、画布拖动/撤销、锁定和玩家层约束；
4. 缺失、不适用和加载失败素材的回退；
5. 无缝 placement 的确定性、范围和 draw cap；
6. `npm test`、`npm run check`、`npm run assets:audit`、`npm run build`；
7. 浏览器中的五个模式入口、地形笔划与图章、场景物件命中与拖动、相机平移/缩放后锚点、能力开关与覆盖提示、原生下拉可读性、保存/导入/试玩和实际关卡表现。

浏览器、性能和构建结果不得从旧记录推断；每次交付都应重新运行测试并记录当前内容哈希。
