# 关卡工坊与 v2 关卡文档

Cablester 的关卡工坊从开始菜单进入，提供三种共用同一份关卡文档的模式：`物件编辑`、`物件素材` 和 `场景分层`。三个模式共用撤销/重做历史、本地保存、JSON 导入导出和一键试玩；视觉编辑只改变美术配置，不改变碰撞、交互或玩法语义。

素材登记与生成规范见 [ASSET_LIBRARY.md](ASSET_LIBRARY.md)，场景图层字段和无缝计算见 [SCENE_LAYERS.md](SCENE_LAYERS.md)，最终美术验收与发布记录见 [ART_RELEASE.md](ART_RELEASE.md)。

## 基本工作流

1. 在“物件编辑”中放置或选择物件，编辑位置和玩法属性。
2. 在“物件素材”中按分类、关键词和适用类型筛选素材，预览后应用到单个物件或同类型物件。
3. 在“场景分层”中编辑背景、中景、玩家层、前景或任意自定义深度层。
4. 使用撤销/重做检查修改，再一键试玩当前草稿。
5. 保存到当前浏览器，或导出 JSON 进入版本控制和跨设备传递。

内置正式关卡和参考房间会以副本形式打开，不会回写源码。确定性生成器仍可按 seed、路线长度和难度创建基础路线，再进入上述三个模式继续调整。

## v2 顶层结构

关卡文档版本由 `schemaVersion: 2` 标识。顶层字段如下：

| 字段 | 用途 |
| --- | --- |
| `schemaVersion` | 当前必须为 `2`；v1 通过 `migrateLevelDocument` 升级。 |
| `metadata` | 至少包含 `id`、`name`；还可包含 `category`、`summary`、`acceptanceLevel`、`mode`。 |
| `bounds` | 关卡世界边界 `{ x, y, w, h }`，宽高必须为正数。 |
| `dashCapacity` | 冲刺容量，整数 `1–3`。 |
| `startingAbilities` | 初始能力 ID 数组。 |
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

`src/level-objects.js` 当前定义 24 种可编辑物件：

- 关卡结构：`spawn`、`goal`、`checkpoint`、`roomEntrance`、`roomExit`；
- 地形：`platform`、`slope`、`movingObject`、`fragilePlatform`；
- 危险与机关：`hazard`、`windZone`、`liquidZone`、`darknessZone`、`rotationTrigger`、`gate`、`stateTrigger`；
- 交互物件：`anchor`、`bashTarget`、`energyOrb`、`dashRefill`、`launcher`、`abilityPickup`；
- 引导与装饰：`sign`、`backgroundSeed`。

每种类型的玩法属性、默认值、范围和下拉选项都来自 `LEVEL_OBJECT_LIBRARY`。新增类型时必须同时完成物件定义、运行时集合映射、编译/反编译、边界计算、程序化回退绘制、素材适用类型和测试。

## 物件素材配置

每个物件的 `properties.visual` 必须包含完整的 canonical 配置：

| 字段 | 范围或语义 |
| --- | --- |
| `assetId` | 非空素材 ID，最长 256 字符。 |
| `scaleX` / `scaleY` | `0.01–16`，以玩法 bounds 为基准缩放。 |
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
- 画布与 Inspector 同步显示缩放、锚点、偏移、翻转、透明度和色调效果；
- 素材缺失、不适用、尚未加载或加载失败时显示程序化安全回退。

类型默认和项目默认不是同一概念：当前 registry 的项目默认是 `builtin:procedural`；部分玩法类型拥有 ImageGen 类型默认。完整映射见 [ASSET_LIBRARY.md](ASSET_LIBRARY.md)。

## 场景分层

`scene` 与 `objects` 位于同一关卡文档，但职责分开：`objects` 决定玩法，`scene` 只决定分层美术。默认场景包含背景、中景、玩家层和前景；玩家层必须是唯一的 `role: "player"`，并固定为 `depth: 0`、`parallax: 1`。

“场景分层”模式支持新增、显示/隐藏、锁定、排序、复制和删除图层；编辑多个带权重素材、深度、视差、缩放、透明度、色调、模糊、雾化、混合方式、横向重复、随机种子、出现范围、间距、密度和绘制上限。场景素材选择器只列 `applicableTypes` 包含 `scene` 或 `*` 的素材，添加和替换时再次校验。

图层排序与运行时都以 `depth` 为首要依据；工坊的上移/下移会同步调整深度，避免列表顺序与实际绘制顺序分离。详细字段、计算公式和性能上限见 [SCENE_LAYERS.md](SCENE_LAYERS.md)。

## 保存、迁移与 roundtrip

- 当前浏览器存储键为 `cablester.level-editor.documents.v2`。
- 启动时仍读取旧的 `cablester.level-editor.documents.v1`；每份 v1 文档会先迁移，再进入 active document。
- JSON 导入、内置文档载入、历史恢复和参考文档加入工坊都统一调用 `migrateLevelDocument`。
- v1 迁移为每个物件补齐 `properties.visual`，并补充默认 `scene`；输入对象不被原地修改。
- 保存使用浏览器 `localStorage`，只在当前设备与浏览器可用；跨设备和版本控制必须导出 JSON。
- 导出前先验证 v2 文档；试玩前先编译并运行现有关卡验证。

撤销/重做保存整份 active document 快照，因此物件属性、visual 映射、场景图层和文档设置会一起恢复，不存在三套独立历史。

## 运行时编译边界

`compileLevelDocument` 将 `objects[]` 编译回游戏当前使用的 `platforms`、`hazards`、`anchors` 等集合，并另外输出：

- `visuals[objectId]`：对象 ID 到 visual 配置的映射；
- `visualOrder[type]`：同类型运行时数组与对象 ID 的稳定对应关系；
- `scene`：原样关联的 canonical 场景配置。

因此物理、碰撞、检查点、能力和房间转换继续读取原有运行时集合；视觉运行时只消费 `visuals`、`visualOrder` 和 `scene`。反向 `levelToDocument` 会保留 visual、scene、`acceptanceLevel`、参考来源和状态策略，保证文档 roundtrip 不丢失这些信息。

## 验证与扩展清单

修改文档模型或编辑器后至少检查：

1. v1 迁移、v2 validation 和 JSON roundtrip；
2. 单物件/同类型素材替换与各级重置；
3. scene 新增、更新、排序、复制、删除和玩家层约束；
4. 缺失、不适用和加载失败素材的回退；
5. 无缝 placement 的确定性、范围和 draw cap；
6. `npm test`、`npm run check`、`npm run assets:audit`、`npm run build`；
7. 浏览器中的模式入口、原生下拉可读性、保存/导入/试玩和实际关卡表现。

浏览器、性能和 Sites 结果不得从旧记录推断；每次发布都应填写 [ART_RELEASE.md](ART_RELEASE.md) 的当次证据区。
