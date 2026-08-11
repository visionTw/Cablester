# AssetRegistry 与 ImageGen 素材管线

`src/asset-library.js` 是 Cablester 素材元数据、类型默认、搜索、适用性验证和安全回退的唯一 canonical 来源。编辑器和运行时使用同一个 `DEFAULT_ASSET_REGISTRY`，不要在 UI、关卡 preset 或构建脚本中维护第二份素材清单。

## Registry 结构

AssetRegistry 自身使用 `schemaVersion: 1`，与关卡文档的 `schemaVersion: 2` 是两个独立版本号：

```json
{
  "schemaVersion": 1,
  "projectDefaultAssetId": "builtin:procedural",
  "typeDefaults": {
    "platform": "gameplay:moss-platform"
  },
  "assets": []
}
```

每个素材记录必须包含：

| 字段 | 说明 |
| --- | --- |
| `id` | 全局唯一、稳定的素材 ID。 |
| `label` / `description` | 编辑器显示名和用途说明。 |
| `category` | 搜索和分类用的稳定类别。 |
| `kind` | `procedural` 或 `image`。 |
| `path` / `thumbnailPath` | 仓库中的实际文件与编辑器缩略图路径；图片必须是 canonical `./assets/game/...` AVIF/JPEG/PNG/WebP 路径，拒绝 dot segment、反斜杠、编码分隔符和目录外路径；程序化素材的 `path` 为 `null`。浏览器请求通过对应 `/media/game/...` Worker 交付路由发送，registry 仍保留可审计的真实文件路径。 |
| `applicableTypes` | 可应用的物件类型，场景素材使用 `scene`，全局回退使用 `*`。 |
| `tags` | 中英文搜索标签。 |
| `prompt` | 实际生成提示词；程序化素材为 `null`。 |
| `generationMethod` | 生成模型与本地处理方式。 |
| `width` / `height` / `fileSizeBytes` | 最终运行时文件的真实尺寸和字节数。 |
| `license` | `name`、`scope`、`source` 三项授权与来源说明。 |

Registry validation 会拒绝重复 ID、未知字段、缺失路径、非法尺寸、空适用类型、缺失 license，以及指向缺失或不适用素材的 type default。

## 当前素材清单

当前 registry 共 17 条记录：1 个内置程序化回退和 16 个透明 WebP 图片。16 个运行时图片合计 317,794 bytes（约 310.3 KiB），16 个缩略图合计 83,150 bytes（约 81.2 KiB）。这些数字来自当前文件与 registry，不代表网络传输或解码内存基线。

可重复素材审计命令为 `npm run assets:audit`。它从 registry 读取 16 个图片记录，检查 32 个主图/缩略图的路径、WebP RGBA 解码、登记尺寸和字节数、透明边距、边缘 alpha、洋红残留、缩略图尺寸与重采样相似度，并报告磁盘与估算解码占用。当前工作树的最新本地审计为 16/16 素材、32/32 文件通过；这属于文件 QA，不替代浏览器请求、显存或帧率测试。

### 玩法与布局素材

| 素材 ID | 名称 | 分类 / 适用类型 | 尺寸 | 字节 | 文件 |
| --- | --- | --- | ---: | ---: | --- |
| `gameplay:moss-platform` | 荧光苔藓根木平台 | terrain / `platform` | 512×120 | 20,168 | `assets/game/terrain/moss-root-platform.webp` |
| `gameplay:thorn-hazard` | 绯红荆棘藤 | danger / `hazard` | 512×124 | 35,428 | `assets/game/gameplay/crimson-thorn-vine.webp` |
| `gameplay:rope-anchor` | 水晶种荚锚点 | interaction / `anchor` | 177×192 | 12,946 | `assets/game/gameplay/crystal-rope-anchor.webp` |
| `gameplay:energy-orb` | 叶环能量种子 | gameplay / `energyOrb`, `dashRefill` | 154×160 | 14,330 | `assets/game/gameplay/leaf-energy-orb.webp` |
| `gameplay:bash-blossom` | 紫辉猛击花 | interaction / `bashTarget` | 141×160 | 14,974 | `assets/game/gameplay/violet-bash-blossom.webp` |
| `gameplay:checkpoint-lantern` | 种灯检查点 | gameplay / `checkpoint` | 98×192 | 10,070 | `assets/game/gameplay/seed-lantern-checkpoint.webp` |
| `gameplay:spawn-gate` | 根木出生门 | layout / `spawn` | 160×188 | 12,780 | `assets/game/layout/root-spawn-gate.webp` |
| `gameplay:goal-gate` | 金辉终点门 | layout / `goal` | 136×192 | 19,014 | `assets/game/layout/golden-goal-gate.webp` |

### 场景素材

| 素材 ID | 名称 | 分类 | 尺寸 | 字节 | 文件 |
| --- | --- | --- | ---: | ---: | --- |
| `scene:moss-bush-cluster` | 苔藓草灌丛 | vegetation | 256×115 | 11,710 | `assets/game/scene/vegetation/moss-bush-cluster.webp` |
| `scene:cyan-seed-plant` | 青露发光植物 | vegetation | 120×174 | 13,090 | `assets/game/scene/vegetation/cyan-seed-plant.webp` |
| `scene:overhang-vine-branch` | 前景垂藤暗枝 | foliage | 384×111 | 14,910 | `assets/game/scene/foreground/overhang-vine-branch.webp` |
| `scene:ancient-amber-tree` | 琥珀树洞古树 | trees | 256×339 | 42,060 | `assets/game/scene/trees/ancient-amber-tree.webp` |
| `scene:distant-trunk-grove` | 远景高干林影 | background | 337×320 | 46,290 | `assets/game/scene/background/distant-trunk-grove.webp` |
| `scene:mid-tree-cluster` | 中远景三树组 | trees | 149×192 | 17,036 | `assets/game/scene/trees/mid-tree-cluster.webp` |
| `scene:cyan-mist-band` | 青蓝游雾带 | atmosphere | 512×86 | 15,556 | `assets/game/scene/atmosphere/cyan-mist-band.webp` |
| `scene:forest-light-motes` | 林间生物光点 | atmosphere | 384×146 | 17,432 | `assets/game/scene/atmosphere/forest-light-motes.webp` |

所有图片都有对应的 `assets/game/thumbnails/*-thumb.webp`。每项素材的完整实际提示词、generation method、尺寸、字节数和 license 原文保存在 [`src/asset-library.js`](../src/asset-library.js)；文档清单用于检索，registry 才是机器可读的审计记录。

## 类型默认与项目默认

当前项目默认始终是 `builtin:procedural`。以下类型配置了图片 type default：

| 物件类型 | 类型默认素材 |
| --- | --- |
| `platform` | `gameplay:moss-platform` |
| `hazard` | `gameplay:thorn-hazard` |
| `anchor` | `gameplay:rope-anchor` |
| `energyOrb`, `dashRefill` | `gameplay:energy-orb` |
| `bashTarget` | `gameplay:bash-blossom` |
| `checkpoint` | `gameplay:checkpoint-lantern` |
| `spawn` | `gameplay:spawn-gate` |
| `goal` | `gameplay:goal-gate` |

其余 15 种物件的类型默认仍是 `builtin:procedural`。编辑器的“恢复类型默认”回到上表映射；“恢复项目默认”回到程序化表现。两种操作不能混为一谈。

## ImageGen 生产流程

新增图片素材必须使用内置 ImageGen（`gpt-image-2`），并按小尺寸、可复用、可直接进入游戏的 sprite 生产：

1. 先确认已有编辑器字段、适用类型和运行时回退能够承载该素材。
2. 为单个可复用物件编写原创提示词；描述梦幻森林、生物光、手绘 gouache、剪影层次、冷暖点缀和缩小后可读性。
3. 不生成整关概念图、超大背景、角色仿作、游戏标志或仅供展示的孤立画面。
4. 需要透明背景时，提示模型输出精确纯色 `#ff00ff` 背景和有边距的单一物件，再执行 chroma-key alpha 提取。
5. 使用 `scripts/process-game-asset.py` 对已抠图 RGBA 做 key-colour unmatte、可见区域裁切、等比缩小，并输出 WebP 及匹配缩略图；当前资产使用 quality 88。
6. 用最终文件的真实宽高和字节数登记 registry，同时保存完整 prompt、generation method、适用类型和 license。
7. 立即检查透明边缘、缩略图、不同缩放、色调/翻转、重复接缝、编辑器回退和运行时回退，再开始下一项素材。
8. 运行 `npm run assets:audit`，确认 registry 与 32 个最终文件一致。
9. 构建时 `scripts/build.mjs` 会把整个 `assets/` 目录复制到 Sites client；`assetDeliveryUrl` 把浏览器请求映射到 `/media/`，Worker 再读取对应 `/assets/` 文件并设置 MIME 与一小时浏览器缓存。部署前仍须用公开地址检查实际响应头。

处理脚本示例：

```bash
python3 scripts/process-game-asset.py \
  --input /path/to/keyed-rgba.png \
  --source /path/to/imagegen-flat-background.png \
  --out assets/game/scene/vegetation/example.webp \
  --thumbnail assets/game/thumbnails/example-thumb.webp \
  --max-width 256 \
  --max-height 192
```

`--input` 应是 chroma-key helper 生成的 RGBA；`--source` 是原始纯色背景输出，用于采样并去除半透明像素中的 key 色污染。临时生成文件不应进入运行时素材目录。

## 原创与授权边界

当前 ImageGen 素材的 registry license 统一声明：

- 名称：`Original AI-generated project asset`；
- 范围：Cablester 运行时、编辑器、文档和公开 Sites 部署；
- 来源：2026-08-11 使用 OpenAI 内置 ImageGen 为 Cablester 生成，未使用第三方游戏资源。

创作可以提炼“梦幻森林、生物光、手绘质感、剪影层次、冷暖色彩、空间纵深”等通用视觉语言，但不得复制、描摹、提取或分发《Ori》系列原画、角色、标志或未经授权资源。提示词不得要求复现特定受保护角色、场景构图或 logo；参考作品名称不应作为资源内容的一部分。

上述 license 是项目内的来源与预期使用范围记录，不替代发布主体需要完成的法律或平台条款审查。

## 解析与安全回退

物件素材解析按以下顺序进行：

1. 请求的素材存在、适用于当前物件类型且未标记加载失败时使用它；
2. 否则尝试当前物件的 type default；
3. 再尝试 project default；
4. 最终回到 `builtin:procedural`。

场景使用虚拟适用类型 `scene`，因此只接受 `applicableTypes` 包含 `scene` 或 `*` 的素材。加载中、缺失、不适用和加载失败都不能改变玩法；对象继续使用原 Canvas 绘制，场景使用程序化层元素或保留基础背景。

## 新素材登记检查表

- [ ] ID、文件名、目录和类别稳定且不重复；
- [ ] `applicableTypes` 精确，不用 `*` 掩盖错误分类；
- [ ] 运行时 WebP 与缩略图都存在并能解码；
- [ ] 真实宽高和 `fileSizeBytes` 与文件一致；
- [ ] prompt、generation method 和 license 完整；
- [ ] 透明边缘无洋红污染和明显白边；
- [ ] 小尺寸、放大、翻转和 tint 表现可接受；
- [ ] tile/mirror/random 重复没有明显接缝或穿帮；
- [ ] 缺失和加载失败路径回到程序化表现；
- [ ] `npm run assets:audit` 无错误且没有未登记/缺失文件；
- [ ] 素材已进入编辑器、正式关卡配置和运行时验证，而非只落盘。
