# 场景分层模型与运行时

关卡文档 v2 的 `scene` 保存纯视觉场景数据，玩法物件继续保存在 `objects[]`。canonical 实现位于 `src/scene-layers.js`，编辑器和运行时都调用同一套 validation、不可变 mutation 和无缝 placement 计算。

## Scene schema

`scene` 自身使用 `schemaVersion: 1`：

```json
{
  "schemaVersion": 1,
  "layers": [
    {
      "id": "scene-background",
      "name": "远景高干林影",
      "role": "background",
      "depth": -100,
      "assets": [
        { "assetId": "scene:distant-trunk-grove", "weight": 1 }
      ],
      "visible": true,
      "locked": false,
      "parallax": 0.18,
      "scale": 1,
      "opacity": 0.72,
      "tint": "#7796ad",
      "blur": 3,
      "fog": 0.45,
      "blendMode": "source-over",
      "repeatX": true,
      "seamless": {
        "mode": "mirror",
        "tileWidth": 400,
        "overlap": 50
      },
      "seed": "forest-distant-trunks",
      "range": { "startX": null, "endX": null },
      "originX": 0,
      "originY": 720,
      "spacing": 0,
      "density": 1,
      "drawCap": 64
    }
  ]
}
```

上例只展示单个图层；可导入的完整 scene 必须恰好包含一个合法玩家层。

## 角色与默认值

`role` 可取 `background`、`midground`、`player`、`foreground`、`custom`。默认场景依次创建前四种角色：

| 角色 | 默认 depth | parallax | opacity | blur | fog | 默认锁定 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `background` | -100 | 0.18 | 0.72 | 3 | 0.45 | 否 |
| `midground` | -20 | 0.58 | 0.90 | 1 | 0.18 | 否 |
| `player` | 0 | 1.00 | 1.00 | 0 | 0 | 是 |
| `foreground` | 100 | 1.22 | 0.82 | 0 | 0.08 | 否 |
| `custom` | 20 | 0.85 | 1.00 | 0 | 0 | 否 |

Scene 必须恰好有一个玩家层。玩家层的 `role` 不可修改，`depth` 必须为 `0`，`parallax` 必须为 `1`，且不可删除；它可解锁后调整允许的视觉字段。其他锁定图层在解锁前不可更新、移动或删除。

## 正式关卡的 12 层组合

默认 scene 仍只有上表的 4 个角色层；`src/level-art-presets.js` 为 10 个正式关卡各增加 8 个自定义深度层，因此菜单实际使用的 10 份 `LEVELS` 均为 12 层。当前组合是：

- 4 个角色层：远景高干林影；中景古树；玩家附近苔藓灌丛；带权重混排暗藤和暗影蕨叶的前景；
- 4 个新增空间层：深远根峰、月影树冠、盘根石拱/苔根岩组中景地标、水青铃花近路点缀；
- 4 个既有自定义层：发光种荚、游雾、中远景树组、林间生物光点。

这些层共同引用当前 14 个 `scene` 素材；每关复用相同的可组合小素材，通过 seed、tint、opacity、parallax 和密度形成主题差异，不用单张超大背景覆盖整关。`low` 档的 12 层上限恰好容纳当前正式 preset，但仍会降低 density、单层 draw cap 和 blur；是否达到性能目标必须由本轮浏览器数据证明。

## 完整字段

| 字段 | 范围或语义 |
| --- | --- |
| `id` / `name` | 非空字符串；图层 ID 在 scene 内唯一。 |
| `role` | 五种 canonical 角色之一。 |
| `depth` | `-10000–10000`；数值越小越远，玩家基准为 0。 |
| `assets` | 至少一个 `{ assetId, weight }`；weight 为 `0.0001–100000`。 |
| `visible` / `locked` | 显示和编辑锁定状态。 |
| `parallax` | `-4–4`；控制横向视差，0 近似横向屏幕固定，1 跟随玩法世界，更大值产生近景加速。显式 `originY` 始终使用普通世界 Y。 |
| `scale` | `0.01–16`，同时影响 tile 宽度。 |
| `opacity` | `0–1`。 |
| `tint` | `#rrggbb` 或 `#rrggbbaa`。 |
| `blur` | `0–100`；运行时还会按质量档限制最大 blur。 |
| `fog` | `0–1`；以 tint 颜色对视口增加轻量雾层。 |
| `blendMode` | `source-over`、`multiply`、`screen`、`overlay`、`soft-light`、`lighter`。 |
| `repeatX` | 是否横向生成多个 placement。 |
| `seamless.mode` | `tile`、`mirror` 或 `random`。 |
| `seamless.tileWidth` | `1–100000`；素材在世界中的基础宽度。 |
| `seamless.overlap` | `0–100000` 且必须小于 tile width。 |
| `seed` | 非空确定性随机种子。 |
| `range.startX` / `endX` | 数字或 `null`；两者都有值时 start 不得大于 end。 |
| `originX` | `-10000000–10000000`，placement 网格原点。 |
| `originY` | 可选的 `-10000000–10000000` 世界坐标；表示素材底边锚点，Y 向下为正。缺失或 `null` 只用于兼容旧文档；编辑器载入时会以关卡 bounds 底边补齐。 |
| `spacing` | `-100000–100000`，附加间距；负值可产生重叠。 |
| `density` | `0.01–100`，越高 placement 越密。 |
| `drawCap` | 整数 `1–4096`，单图层配置上限。 |

场景素材必须在 AssetRegistry 中将 `applicableTypes` 标为 `scene` 或 `*`。编辑器的素材下拉、添加和替换都执行该适用性检查；手工 JSON 中的缺失或不适用素材由运行时安全回退，不能影响玩法。

## 无缝 placement

`calculateSeamlessPlacements` 的关键计算为：

```text
tileWidth = seamless.tileWidth × scale
overlap   = seamless.overlap × scale
step      = max(1, (tileWidth - overlap + spacing) / density)
center    = cameraX × parallax
```

随后根据视口、overscan、`originX` 和可选 range 计算候选 index：

- `repeatX: false` 时只考虑 index 0；
- `tile` 保持原方向；
- `mirror` 按奇偶 index 水平翻转；
- `random` 使用 `seed + index` 确定翻转；
- 多素材按 weight 和相同确定性 hash 选择；
- 候选过多时，以相机中心为基准截取到 `min(layer.drawCap, maxDraws)`。

相同 layer、seed、相机和视口输入始终得到相同 placement，不应在镜头移动时随机跳变。运行时还会在视口两侧保留一个完整 tile，或 `min(视口宽度 × 0.25, 320 px)`（取较大值）的驻留带，让 placement 在进入屏幕前已经绘制、离开屏幕后才回收；`drawCap` 不足以覆盖驻留带时会计入 `sceneResidencyDeficits` 诊断。接缝是否视觉可接受仍取决于素材本身的边缘、tileWidth、overlap、spacing 和 mode，必须在编辑器与浏览器中实测。

## 排序与渲染 pass

图层以 `depth` 升序绘制，相同 depth 保持关卡文档中的原始顺序。编辑器上移/下移会同时调整列表顺序和 depth，使实时预览与运行时语义一致。

运行时将图层分到四个 pass：

| 条件 | pass |
| --- | --- |
| `role === "player"` 或 `depth === 0` | `player` |
| `depth < -50` | `background` |
| `-50 <= depth < 0` | `midground` |
| `depth > 0` | `foreground` |

当前帧顺序是：基础渐变背景 → scene background → scene midground → scene player → 玩法世界 → 玩家 → scene foreground → 玩法提示 → HUD。前景可以覆盖玩家和世界，但不会覆盖关键 gameplay cue 或 HUD；美术验收仍必须确认它不遮挡路线、危险物、锚点、目标和交互提示。

带显式 `originY` 的场景层是可摆放的视觉关卡物件：`originX` 定义横向 placement 网格，`originY` 定义所有 placement 的底边世界锚点。编辑器直接在画布中命中并拖动它们，平移或缩放相机不会写回位置；Web 与 Godot 运行时都让 Y 按普通世界坐标跟随相机，横向仍使用 `parallax`。旧文档缺失 `originY` 时保留各运行时的历史回退，进入编辑器后会物化为关卡 bounds 底边，首次保存即得到跨端一致的显式坐标。

`repeatX: true` 或包含多个带权重素材时，画布中的每个可见贴片都是同一层网格的命中代理；拖动任一贴片会移动整层，而不是把生成贴片拆成独立实例。需要逐个摆放时，应创建多个 `repeatX: false` 的单素材层。

## 运行时加载与缓存

`VisualRuntime` 在加载关卡时收集 object visuals 和 scene layers 引用的非程序化素材，并以默认并发 6 预加载。菜单、编辑器试玩和参考房切换都使用 prepared-load gate：当前关卡与一跳相邻关卡的图片全部完成 decode（或明确进入 error 回退态）以后，才原子切换关卡；准备期间菜单保持可见，真实切房则冻结旧房玩法并保留旧画面。

- 菜单中的 3C 关按顺序预取前后相邻关；World Studio 试玩按 canonical `connections` 只准备当前 Chunk 与一跳邻居；
- 快速 A → B 请求使用 generation token，晚完成的 A 不会反向覆盖 B；
- 当前关与邻关的素材 ID 会在图片 LRU 中固定驻留，下一次 prepared load 再原子替换驻留集合；
- 图片失败会等待到稳定 error 状态后使用程序化回退，不会让加载门控死锁。

基础缓存行为仍为：

- 相同素材请求去重；图片使用异步 decode；
- 默认最多 96 个 cache entry，非 loading 项按 LRU 淘汰；
- 每个素材最多缓存 6 个 tint 变体；
- scene validation 与质量档选择结果按 scene 对象存入 `WeakMap`；
- `stats()` 暴露请求、命中、ready/loading/error、估算 decoded bytes、tint bytes、淘汰、scene/object/fallback draw 和 cull 数。

兼容旧的同步 `loadLevel()` 调用时，图片加载中仍可即时使用程序化 renderer；面向玩家的入口统一走 prepared-load，因此不会先显示程序化占位、随后突然替换图片。加载失败时物件持续使用原程序化 renderer；场景解析到 `builtin:procedural` 后，非玩家层绘制轻量程序化剪影，玩家层不额外绘制占位物。

## 自动质量降级

`qualityTier: "auto"` 根据 reduced motion、`navigator.deviceMemory`、`hardwareConcurrency` 和 DPR 选择档位：

- reduced motion、内存不高于 4 GB 或逻辑核不高于 4：`low`；
- 内存低于 8 GB、逻辑核低于 8 或 DPR 不低于 3：`balanced`；
- 其他情况：`high`。

| 档位 | 最大图层 | 单层最大 draw | 单帧 scene draw | density 倍率 | 最大 blur |
| --- | ---: | ---: | ---: | ---: | ---: |
| `high` | 48 | 256 | 1024 | 1.00 | 12 px |
| `balanced` | 24 | 128 | 512 | 0.72 | 6 px |
| `low` | 12 | 48 | 192 | 0.42 | 2 px |

当图层数超过档位上限时，运行时优先保留 player、midground、foreground、background，再保留 custom；同优先级选择更靠近玩家基准的 depth。此策略保证降级有确定性，但不是性能结果本身。首次加载、请求数、内存/显存、平均 FPS、P95 和最差帧时间必须在目标设备实测。

## 编辑与验收检查表

- [ ] 每个 scene 恰好一个合法 player layer；
- [ ] 锁定、显示、复制、删除和排序都进入统一历史；
- [ ] 素材只使用 `scene` / `*` 适用记录；
- [ ] tile、mirror、random 在长距离平移时无接缝、跳变和明显重复；
- [ ] range、origin、spacing、density 和 drawCap 在极值下仍通过 validation；
- [ ] 场景物件可在画布中选中、拖动和撤销，锁定层不可拖动，重复层按整层移动；
- [ ] 显式 originX/originY 在编辑器、Web 试玩和 Godot 中位置一致，平移/缩放不改写 canonical 坐标；
- [ ] 编辑器与试玩的视差、opacity、tint、blur、fog 和 blend 一致；
- [ ] 前景不遮挡关键路线和提示；
- [ ] low / balanced / high 都有浏览器证据和性能记录；
- [ ] 缺失、错误路径和不适用素材均安全回退。
