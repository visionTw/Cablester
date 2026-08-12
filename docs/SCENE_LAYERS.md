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
| `parallax` | `-4–4`；0 近似屏幕固定，1 跟随玩法世界，更大值产生近景加速。 |
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

相同 layer、seed、相机和视口输入始终得到相同 placement，不应在镜头移动时随机跳变。接缝是否视觉可接受仍取决于素材本身的边缘、tileWidth、overlap、spacing 和 mode，必须在编辑器与浏览器中实测。

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

编辑器与运行时都把场景素材贴在当前视口底边，使用同一 parallax、placement 宽高比、opacity、tint、blur、fog 和 blend 语义。编辑器通过缩放和平移改变预览相机，不会写回关卡数据。

## 运行时加载与缓存

`VisualRuntime` 在加载关卡时收集 object visuals 和 scene layers 引用的非程序化素材，并以默认并发 6 预加载：

- 相同素材请求去重；图片使用异步 decode；
- 默认最多 96 个 cache entry，非 loading 项按 LRU 淘汰；
- 每个素材最多缓存 6 个 tint 变体；
- scene validation 与质量档选择结果按 scene 对象存入 `WeakMap`；
- `stats()` 暴露请求、命中、ready/loading/error、估算 decoded bytes、tint bytes、淘汰、scene/object/fallback draw 和 cull 数。

图片加载中或失败时不会阻塞游戏。物件回到原程序化 renderer；场景解析到 `builtin:procedural` 后，非玩家层绘制轻量程序化剪影，玩家层不额外绘制占位物。只引用 `builtin:procedural` 的默认 scene 在正式运行时跳过，因此 908 个参考白盒仍保留基础 Canvas 背景，不会凭空套用正式关卡森林层。

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

当图层数超过档位上限时，运行时优先保留 player、midground、foreground、background，再保留 custom；同优先级选择更靠近玩家基准的 depth。此策略保证降级有确定性，但不是性能结果本身。首次加载、请求数、内存/显存、平均 FPS、P95 和最差帧时间必须按 [ART_RELEASE.md](ART_RELEASE.md) 在目标设备实测。

## 编辑与验收检查表

- [ ] 每个 scene 恰好一个合法 player layer；
- [ ] 锁定、显示、复制、删除和排序都进入统一历史；
- [ ] 素材只使用 `scene` / `*` 适用记录；
- [ ] tile、mirror、random 在长距离平移时无接缝、跳变和明显重复；
- [ ] range、origin、spacing、density 和 drawCap 在极值下仍通过 validation；
- [ ] 编辑器与试玩的 Y 位置、视差、opacity、tint、blur、fog 和 blend 一致；
- [ ] 前景不遮挡关键路线和提示；
- [ ] low / balanced / high 都有浏览器证据和性能记录；
- [ ] 缺失、错误路径和不适用素材均安全回退。
