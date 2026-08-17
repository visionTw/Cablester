# Cablester 第一阶段基线（2026-08-12）

本文件记录第一阶段架构开始前、来自当前 checkout 的可复验基线。历史发布记录不替代这里的结果。

## 当前 checkout

- 分支：`codex/reference-level-library`
- 基线提交：`5014083`（`Document v18 online acceptance`）
- 工作树：基线检查时干净
- Web：原生 ES modules + Canvas；Sites 项目已绑定
- Godot：仓库内尚无项目；系统旧版本为 `4.6.2.stable`，第一阶段已另行锁定并验证项目工具链 `4.7.1.stable.official.a13da4feb`

## 已有能力

- 6 个单项 3C 关与 4 个综合案例。
- 25 类统一玩法物件，v2 结构为 `{ id, type, position, properties }`。
- 物件素材、九宫格/平铺、12 层场景、程序化缺图回退、能力覆盖提示。
- 22 个已登记的小型原创 WebP 素材；908 个参考白盒房间使用独立参考目录。
- 关卡工坊支持撤销/重做、JSON 导入导出、浏览器本地保存与一键试玩。

## 当前复验结果

- `npm test`：152/152 通过。
- `npm run check`：10 个内置关卡与 908 个参考房间通过结构检查。
- `npm run assets:audit`：22 个素材、44/44 文件、0 错误。
- `npm run build`、生成 worker 语法检查和 `git diff --check`：通过。
- 当前 Sites URL 返回 HTTP 200：`https://cablester-game.visiontw.chatgpt.site`。
- Godot 官方档案在基线日标记 4.7.1 为 4.7 系列最新稳定版；4.7.2 当时仍为 RC，不进入正式验收工具链。

## 与第一阶段目标的差距

1. 没有唯一的 World/Region/Chunk canonical World Package；内置正式内容仍由 JavaScript 构造。
2. 正式编辑结果不能在本地开发环境中确定性、原子地直接写回仓库数据文件。
3. 没有世界图、区域图、区块图、空间索引、LOD 或流式加载模拟。
4. 没有 `contentHash`、跨端版本握手、Godot normalized manifest、resolved snapshot、telemetry 或 semantic diff。
5. 没有 Godot importer/runtime、Godot 版 3C/综合案例、存档、固定输入回放或导出包。
6. 没有完全由 canonical 数据生产的首个原创森林大区域。
7. 现有浏览器性能记录只覆盖单关运行时，不构成十倍世界规模的编辑/预览性能证据。

## 基线保护规则

- v1/v2 文档继续可导入并确定性迁移；现有字段不得丢失。
- 908 个参考房间保持 `reference` namespace/build profile，不进入正式发行包。
- `localStorage` 只保留草稿、自动恢复与缓存用途。
- 每轮集成至少复跑 Web 单元测试、内容检查、Godot headless 测试、roundtrip、哈希与 semantic diff。
