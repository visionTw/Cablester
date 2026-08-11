# 参考关卡连接图审计

本报告只审计机器可读连接图、JSON 出口覆盖和目标入口解析。它不能替代实际输入下的路线通关、机制手感或高保真核对。

## 总结

- 必需条目：908；集合：44；候选有向连接：3678；
- JSON 已实现候选连接：3678/3678；缺少 0；
- JSON 额外出口：2；无效目标或入口：0；
- 弱连通集合：44/44；从首房可双向覆盖全部集合：44/44。

手工代表房只实现已核对的连接，因此“缺少候选连接”不自动视为错误；候选低置信度边也不能因为生成器已放出口就升级为已验证。

## 集合结果

| 集合 | 游戏 | 房间 | 内部边 | 弱连通分量 | 首房正向 | 首房反向 | 首房双向全覆盖 |
|---|---|---:|---:|---:|---:|---:|---|
| `celeste.prologue.a` | celeste | 6 | 20 | 1 | 6/6 | 6/6 | 是 |
| `celeste.city.a` | celeste | 38 | 178 | 1 | 38/38 | 38/38 | 是 |
| `celeste.city.b` | celeste | 16 | 60 | 1 | 16/16 | 16/16 | 是 |
| `celeste.city.c` | celeste | 3 | 8 | 1 | 3/3 | 3/3 | 是 |
| `celeste.site.a` | celeste | 45 | 212 | 1 | 45/45 | 45/45 | 是 |
| `celeste.site.b` | celeste | 17 | 64 | 1 | 17/17 | 17/17 | 是 |
| `celeste.site.c` | celeste | 3 | 8 | 1 | 3/3 | 3/3 | 是 |
| `celeste.resort.a` | celeste | 65 | 372 | 1 | 65/65 | 65/65 | 是 |
| `celeste.resort.b` | celeste | 24 | 92 | 1 | 24/24 | 24/24 | 是 |
| `celeste.resort.c` | celeste | 3 | 8 | 1 | 3/3 | 3/3 | 是 |
| `celeste.ridge.a` | celeste | 48 | 208 | 1 | 48/48 | 48/48 | 是 |
| `celeste.ridge.b` | celeste | 20 | 76 | 1 | 20/20 | 20/20 | 是 |
| `celeste.ridge.c` | celeste | 3 | 8 | 1 | 3/3 | 3/3 | 是 |
| `celeste.temple.a` | celeste | 85 | 400 | 1 | 85/85 | 85/85 | 是 |
| `celeste.temple.b` | celeste | 25 | 110 | 1 | 25/25 | 25/25 | 是 |
| `celeste.temple.c` | celeste | 3 | 8 | 1 | 3/3 | 3/3 | 是 |
| `celeste.reflection.a` | celeste | 64 | 266 | 1 | 64/64 | 64/64 | 是 |
| `celeste.reflection.b` | celeste | 28 | 108 | 1 | 28/28 | 28/28 | 是 |
| `celeste.reflection.c` | celeste | 3 | 8 | 1 | 3/3 | 3/3 | 是 |
| `celeste.summit.a` | celeste | 95 | 440 | 1 | 95/95 | 95/95 | 是 |
| `celeste.summit.b` | celeste | 28 | 108 | 1 | 28/28 | 28/28 | 是 |
| `celeste.summit.c` | celeste | 3 | 8 | 1 | 3/3 | 3/3 | 是 |
| `celeste.epilogue.a` | celeste | 4 | 10 | 1 | 4/4 | 4/4 | 是 |
| `celeste.core.a` | celeste | 39 | 154 | 1 | 39/39 | 39/39 | 是 |
| `celeste.core.b` | celeste | 23 | 88 | 1 | 23/23 | 23/23 | 是 |
| `celeste.core.c` | celeste | 4 | 12 | 1 | 4/4 | 4/4 | 是 |
| `celeste.farewell.a` | celeste | 109 | 436 | 1 | 109/109 | 109/109 | 是 |
| `ori.swallows-nest` | ori-blind-forest-definitive-edition | 3 | 4 | 1 | 3/3 | 3/3 | 是 |
| `ori.sunken-glades` | ori-blind-forest-definitive-edition | 7 | 12 | 1 | 7/7 | 7/7 | 是 |
| `ori.spirit-caverns` | ori-blind-forest-definitive-edition | 5 | 8 | 1 | 5/5 | 5/5 | 是 |
| `ori.hollow-grove` | ori-blind-forest-definitive-edition | 7 | 12 | 1 | 7/7 | 7/7 | 是 |
| `ori.moon-grotto` | ori-blind-forest-definitive-edition | 7 | 12 | 1 | 7/7 | 7/7 | 是 |
| `ori.gumos-hideout` | ori-blind-forest-definitive-edition | 4 | 6 | 1 | 4/4 | 4/4 | 是 |
| `ori.thornfelt-swamp` | ori-blind-forest-definitive-edition | 5 | 8 | 1 | 5/5 | 5/5 | 是 |
| `ori.ginso-tree` | ori-blind-forest-definitive-edition | 8 | 14 | 1 | 8/8 | 8/8 | 是 |
| `ori.black-root-burrows` | ori-blind-forest-definitive-edition | 6 | 10 | 1 | 6/6 | 6/6 | 是 |
| `ori.lost-grove` | ori-blind-forest-definitive-edition | 6 | 10 | 1 | 6/6 | 6/6 | 是 |
| `ori.valley-of-the-wind` | ori-blind-forest-definitive-edition | 6 | 10 | 1 | 6/6 | 6/6 | 是 |
| `ori.misty-woods` | ori-blind-forest-definitive-edition | 7 | 12 | 1 | 7/7 | 7/7 | 是 |
| `ori.forlorn-ruins` | ori-blind-forest-definitive-edition | 8 | 14 | 1 | 8/8 | 8/8 | 是 |
| `ori.kuros-nest` | ori-blind-forest-definitive-edition | 3 | 4 | 1 | 3/3 | 3/3 | 是 |
| `ori.sorrow-pass` | ori-blind-forest-definitive-edition | 7 | 12 | 1 | 7/7 | 7/7 | 是 |
| `ori.mount-horu` | ori-blind-forest-definitive-edition | 12 | 22 | 1 | 12/12 | 12/12 | 是 |
| `ori.spider-coves` | ori-blind-forest-definitive-edition | 3 | 4 | 1 | 3/3 | 3/3 | 是 |

## 未实现候选连接（0）

无

## 额外 JSON 出口（2）

- `ori.sunken-glades.first-gate-hub` → `ori.sunken-glades.western-return`（`exit-upper`）
- `ori.sunken-glades.western-return` → `ori.sunken-glades.first-gate-hub`（`exit-lower`）
