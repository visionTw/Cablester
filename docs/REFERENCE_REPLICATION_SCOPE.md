# 参考关卡白盒复刻范围

## 目标与边界

本地关卡库只复现区域/房间结构、连接顺序、空间拓扑、挑战节奏和机制组合。所有可游玩内容使用 Cablester 自己的 Canvas 几何、占位表现和原创本地名称。不得复制、导入或提取原作美术、贴图、音频、字体、剧情文本、角色素材、瓦片、实体 payload 或安装目录文件。

参考研究仅使用合法游戏体验、公开地图、攻略和公开视频。公开来源中的房间坐标只作为拓扑研究依据，不作为可发布资产，也不声称是精确官方坐标。不能确认的连接、尺寸或机制必须保留为低置信度和待核对差异。

## 目标版本与总量

| 游戏 | 目标版本 | 层级 | 必需总量 | 当前已验证 |
|---|---|---:|---:|---:|
| Celeste | PC 1.4.0.0 房间布局基线；同时跟踪官方 1.4.1.0 行为变更 | 11 章节 / 27 个 Side 集合 | 804 房间 | 804 |
| Ori 1 | Ori and the Blind Forest: Definitive Edition | 1 世界 / 17 区域 | 104 个原创白盒分区 | 104 |

Celeste 的 804 个可枚举唯一房间包含公开目录列出的主要隐藏房、收集路线房和 Farewell 金草莓附加房；不为不改变布局的金草莓重复挑战复制地图。PICO-8 只列入额外清单，不计入主范围完成率。

来源计数存在一处公开差异：Berry Camp Side 声明值合计 805，但固定 JSON 快照只枚举 804 个唯一房间。差异全部来自 Summit B-Side（声明 29、枚举 28）；其 7 个分段各枚举 4 房，社区章节资料也描述每个分段恰有 4 房，所以清单采用 28 和总计 804。该差异在后续合法游戏体验核对前保持公开，不虚构第 29 房。

Ori 没有稳定的官方“房间”边界，因此使用 17 个公开命名区域和 104 个原创本地分区。分区是加载、重置和验证单位，不被描述成原作官方房间。连续世界连接、回访能力门和状态变化仍按世界级图保存。

## 来源和可信度

- [Berry Camp public Celeste room catalog](https://github.com/berrycamp/berrycamp.github.io/blob/b5e393d9fc28ad85fe59c41031f96c24ffdc7b3a/data/celeste.json) — high-for-room-identity-medium-for-connections; Only room identity, checkpoint order, public map bounds and spawn/edge hints are retained. Images, tiles, entities and game assets are discarded.
- [Official Celeste changelog](https://www.celestegame.com/changelog.html) — high; Version scope and behavior differences.
- [Celeste community wiki chapter and mechanic pages](https://celestegame.fandom.com/wiki/Chapters) — medium; Chapter structure and mechanic-introduction cross-check only.
- [Celeste community wiki: Start (The Summit B-Side)](https://celestegame.fandom.com/wiki/Start_(The_Summit_B-Side)) — medium-high-for-7b-subchapter-count; Cross-check that each of the seven Summit B-Side subchapters contains four rooms.
- [Ori and the Blind Forest community location index](https://oriandtheblindforest.fandom.com/wiki/Category:Locations_(Blind_Forest)) — medium-high-for-named-areas; Named area coverage and major ability/location relationships.
- [Ori and the Blind Forest: Definitive Edition complete guide](https://www.soloplayguide.com/games/ori-and-the-blind-forest-definitive-edition/complete-guide) — medium-high-for-progression; Twenty-seven progression sections, major return trips and escape ordering.
- [Ori Definitive Edition location index](https://oriandtheblindforest.fandom.com/wiki/Category:Definitive_Edition_Locations) — medium-high; Black Root Burrows and Lost Grove scope.

可信度规则：

- high：官方版本信息或固定公开目录中的稳定 ID/计数；
- medium：多个公开地图、攻略或视频可以相互印证的拓扑/顺序；
- low：由地图邻接、房间排列或单一资料推定，必须在白盒制作前再次核对；
- 任何近似都必须保留在 manifest 的 `unknownDifferences[]`，不能在验证前升级为“精确复刻”。

## 不在范围内的动作

- 不发布、不部署、不推送远端；
- 不迁移 Godot；
- 不解包原作安装目录；
- 不保存 Berry Camp 的图片、瓦片或实体数据；
- 不用原作故事文本、字体、音乐、音效或角色资产。
