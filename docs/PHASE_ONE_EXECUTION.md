# 第一阶段并行执行与验收所有权

## 文件所有权

| 线 | 主要职责 | 主要所有权 |
| --- | --- | --- |
| A | canonical schema、迁移、hash、registry、roundtrip | `src/world-*` 核心、`scripts/world-*`、`worlds/registries`、对应测试 |
| B | Web 世界编辑、四级预览、流式模拟、Worker validation | 世界工作室 UI、`src/world-editor*`、`src/world-preview*`、对应测试 |
| C | Godot importer/runtime、snapshot、manifest、telemetry | `project.godot`、`godot/**`、`artifacts/godot/**` |
| D | 3C 对等、森林内容、资产与体验 | `worlds/labs`、`worlds/formal`、森林资产与回放 |
| 主线 | 接口评审、冲突解决、本地构建/导出与验收、14 项停止条件 | 集成文件、文档与最终报告 |

共享文件（`index.html`、`styles.css`、`src/game.js`、`src/levels.js`、`scripts/build.mjs`、`package.json`）由主线最终整合；子线需要改动时先保持补丁局部、避免无关格式化。

## 每轮合入门

1. Web unit/integration tests。
2. 10 个正式实验关 + 908 个参考白盒结构检查。
3. v1/v2/v3 migration、roundtrip、golden fixture。
4. Godot headless importer/runtime tests。
5. canonical `contentHash` = Godot `sourceContentHash`。
6. normalized manifest semantic diff = 0。
7. `npm run build` 与生成 worker 语法检查。

## 完成定义

只有目标正文的 14 项停止条件全部绑定当前 checkout/工作树指纹、本地 Chrome World Studio、Godot 4.7.1 clean rebuild 与本地导出包时，第一阶段本地自动化基础才可标记完成。灰盒、截图、单区块或单端通过都只是中间里程碑；真人主观手感必须单独标注，不能由脚本替代。

当前范围允许通过 Git commit/push 同步本地开发源码和可移植证据，但不要求 Sites 部署或公开 URL 复验。若未来恢复网页发布，必须另开一轮脱敏、安全审计、精确 commit/构建绑定、部署和公开 URL 验收；历史线上收据不得补位。
