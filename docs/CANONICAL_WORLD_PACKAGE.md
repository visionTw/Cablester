# Canonical World Package vNext 冻结契约

状态：跨仓库接口冻结。Schema 版本为 `3`。任何改动都必须同时更新迁移、Web、Godot、roundtrip、golden fixture 与本文档。Godot 的精确版本门、导入器和派生证据由私有 `Game_Cablester` 维护。

## 1. 唯一权威与文件布局

- `Game_Cablester/worlds/formal/*.world.json`：私有正式世界与区域，唯一可编辑内容权威；本地编辑时映射为虚拟 `worlds/formal/`。
- `worlds/labs/*.world.json`：6 个专项关与 4 个综合案例的 canonical 数据。
- `worlds/registries/*.json`：type、asset、prefab registry。
- `worlds/fixtures/*.json`：迁移与跨端 golden fixture。
- `Game_Cablester/artifacts/godot/*.json`：私有 Godot resolved snapshot、normalized manifest 与 telemetry；均可删除重建。
- `Game_Cablester/godot/`：私有 prefab、运行时实现、导入器与测试。正式布局不得写入 `.tscn`。

Web 公开构建只读取 `worlds/labs/`。本地开发服务可显式映射私有 formal 目录；映射路径和正式内容都不进入公开构建。Godot 直接读取私有 formal，并消费从 Web 单向同步的 labs/registries/assets/replays。

## 2. 坐标与数值

- 世界单位：1 canonical unit = 1 Web logical pixel；Godot importer 按 `64 units = 1 metre` 记录比例，但 2D 节点坐标保持 1:1，避免二次舍入。
- 轴：右为 `+X`，下为 `+Y`。
- 旋转：`rotationDegrees`，顺时针为正。
- scale：`transform.scale` 影响玩法几何与碰撞；`properties.visual` 的 scale/offset/anchor 只影响美术。
- pivot：玩法 transform 以物件类型 registry 的 pivot 为准，默认中心；现有 v2 左上/端点语义由 type adapter 明确转换，不暗中猜测。
- 物件只保存 chunk-local transform；world transform = region transform × chunk transform × object transform。
- 可保存数值必须有限；负零序列化为 `0`；小数最多 6 位，去除无意义尾零；NaN/Infinity 拒绝保存。

通用 transform：

```json
{
  "position": { "x": 0, "y": 0 },
  "rotationDegrees": 0,
  "scale": { "x": 1, "y": 1 }
}
```

## 3. 顶层结构

```json
{
  "schemaVersion": 3,
  "manifest": {
    "worldId": "cablester-first-forest",
    "title": "…",
    "namespace": "formal",
    "contentVersion": "1.0.0",
    "contentHash": "sha256:…",
    "gameplayTuningVersion": "approved-1",
    "assetRegistryVersion": "1",
    "prefabRegistryVersion": "1",
    "typeRegistryVersion": "1"
  },
  "regions": [],
  "assetRegistry": { "version": "1", "entries": [] },
  "prefabRegistry": { "version": "1", "entries": [] },
  "typeRegistry": { "version": "1", "entries": [] },
  "gameplayTuning": {
    "version": "approved-1",
    "draft": {},
    "approved": {}
  }
}
```

每个 region 必须包含稳定 `id`、`name`、`transform`、`bounds`、路线/地标元数据与 `chunks[]`。每个 chunk 必须包含：

- `id`、`name`、`transform`、chunk-local `bounds`；
- `streaming`：预取距离、滞回、卸载延迟、keep-alive、内存估算；
- `connections[]`：稳定 ID、两端 chunk/entrance、方向、能力/flag 门、单向标记；
- `objects[]`、`scene`、`statePolicy`、`tags[]`。

正式物件：

```json
{
  "id": "全局稳定 ID",
  "type": "platform",
  "transform": {
    "position": { "x": 0, "y": 0 },
    "rotationDegrees": 0,
    "scale": { "x": 1, "y": 1 }
  },
  "properties": {},
  "links": [],
  "tags": []
}
```

World、Region、Chunk、Object ID 在同一 package 内分别唯一；Object ID 必须全局唯一。链接只能使用稳定 ID。

## 4. v1/v2 迁移

- v1 先执行现有 v1→v2 迁移，再执行 v2→v3。
- `position` 确定性变为 `transform.position`；补齐零旋转与单位 scale。
- v2 单关包装为一个 region/一个 chunk；bounds 与 metadata 迁入对应字段。
- 保留稳定 ID、type 专属 properties、`properties.visual`、`scene.layers`、`startingAbilities`、`acceptanceLevel`、`reference`、`statePolicy` 与允许的未知扩展字段。
- 迁移不修改输入对象。相同输入必须产生逐字节相同的 normalized 输出。

## 5. Canonical 序列化与 contentHash

- 使用 UTF-8、递归按 key 字典序排列、数组顺序保持、无额外空白的 stable JSON 作为哈希字节。
- 计算前把 `manifest.contentHash` 设为空字符串；其他字段全部参与。
- 算法为 SHA-256，小写十六进制，前缀 `sha256:`。
- 文件级保存使用同一 normalized 数据的 2 空格 JSON、末尾一个换行。
- Web 与 Godot 都必须重新计算；声明值不匹配时拒绝双端验收。

## 6. Registry 与未知类型

- type registry 定义 pivot、bounds adapter、可编辑属性、Godot runtime handler、碰撞/scale 语义和是否必须。
- prefab registry 只把逻辑 prefab ID 映射到 Godot prefab；不能包含正式布局。
- asset registry 使用逻辑 asset ID；Web 路径与 Godot 资源路径作为同一 entry 的平台映射。
- 正式 namespace 中未知或必需但无法解析的 type/prefab/asset/state 引用必须使 Godot 导入失败。明确允许回退的美术资源可生成 warning 与 fallback 状态。

## 7. Godot resolved snapshot v1

每次 headless 导入生成：

- `snapshotVersion`、`schemaVersion`、`contentVersion`、`sourceContentHash`；
- `importerVersion`、`godotBuildId`、生成时间；
- region/chunk 最终 transform、AABB、连接、依赖与 streaming；
- object ID/type/resolved transform、碰撞 bounds、状态引用、prefab/asset 解析；
- missing/fallback、warnings/errors；
- 可选缩略图、固定输入轨迹和性能 telemetry 引用。

Web 必须以四种互斥状态显示 snapshot：`current`、`stale-content-hash`、`incompatible`、`missing/import-failed`。旧 snapshot 不得伪装为当前结果。

## 8. Normalized manifest 与 semantic diff

Web 与 Godot 使用相同的 semantic projection，比较：

- 版本与 registry/tuning 版本；
- Region/Chunk/Object 数量与稳定 ID；
- type、resolved transform、properties、links/tags；
- connections、state keys、ability gates、asset/prefab ID。

允许差异只来自登记在 `godotDerivedAllowlist` 的字段（AABB、碰撞 shape ID、资源 UID、运行 telemetry 等）。除此之外必须为零。

## 9. 3C 双通道

- `gameplayTuning.draft` 只供 Web 实验室。
- `gameplayTuning.approved` 供正式 Web 内容和 Godot；包含输入定义、能力/状态语义、资源消耗与容差。
- 固定输入录制引用 approved 版本。未达容差的项目在迁移矩阵中保持 `pending`。

## 10. 模块边界与跨线 API

A 线拥有：`src/world-schema.js`、`src/world-hash.js`、`src/world-diff.js`、`src/world-registries.js`、`scripts/world-*`、`worlds/registries`、schema/roundtrip/golden 测试。

B 线拥有：`src/world-editor.js`、`src/world-preview.js`、`src/world-streaming.js`、`src/world-validation-worker.js`、世界工作室 HTML/CSS、Web 编辑/性能测试。

C 线拥有私有仓库中的 `project.godot`、`godot/**`、`artifacts/godot/**` 与 Godot headless 测试。

D/集成线拥有私有 `worlds/formal/**`、公开 `worlds/labs/**`、3C 内容、资产登记、跨端验收与最终证据。

冻结的 JavaScript API：

```js
migrateToWorldPackage(input, options) -> world
validateWorldPackage(world, options) -> issue[]
normalizeWorldPackage(world) -> world
computeContentHash(world) -> Promise<string>
serializeWorldPackage(world) -> Promise<string>
resolveWorldPackage(world, registries) -> resolvedWorld
createSemanticProjection(worldOrSnapshot) -> object
semanticDiff(canonical, normalizedManifest, allowlist) -> diff[]
chunkToLevelDocument(world, regionId, chunkId) -> v2-compatible document
applyLevelDocumentToChunk(world, regionId, chunkId, document) -> world
```

Godot CLI（在私有 `Game_Cablester` 执行）：

```text
scripts/godot.sh --headless --path . -- --import-world worlds/formal/first-forest.world.json
scripts/godot.sh --headless --path . -- --test-worlds
scripts/godot.sh --headless --fixed-fps 120 --path . -- --replay worlds/replays/first-forest-runtime-smoke.replay.json
```

接口改变必须由主线评审，并在 A/B/C/D 同一轮同步落地。
