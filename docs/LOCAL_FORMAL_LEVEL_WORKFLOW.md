# 私有正式关卡本地工作流

## 目标与边界

`Game_Cablester_Web` 提供编辑器与数据契约，`Game_Cablester` 保存正式关卡真源。正式 `*.world.json` 不复制进公开仓库；本地开发服务只在显式启动时把私有目录映射成虚拟的 `worlds/formal/`。

默认同级目录布局：

```text
Project/
├── Game_Cablester_Web/
└── Game_Cablester/
    └── worlds/formal/*.world.json
```

## 日常编辑

在 Web 仓库执行：

```bash
npm run dev:formal
```

打开终端打印的完整 capability URL，然后进入 World Studio：

1. 在“仓库世界”选择 `worlds/formal/<id>.world.json` 并打开；
2. 修改 World、Region、Chunk、Object、连接、素材和能力配置；
3. 执行全图验证和 Web 试玩；
4. “保存到仓库”直接原子写回私有 Godot 目录；
5. “导出 JSON”生成已校验、重新封存 `contentHash` 的独立文件，用于审阅或手工交接。

也可使用自定义目录：

```bash
node scripts/serve.mjs --formal-world-root /absolute/path/to/private/worlds/formal
```

## 写回安全

- 服务只监听 `127.0.0.1`，拒绝非 loopback Host/Origin；
- 仓库 API 需要启动时生成的一次性 capability；
- 只接受 `worlds/formal/*.world.json` 与 `worlds/labs/*.world.json`；
- 外部 formal 根目录必须是显式存在的真实目录，不能是符号链接；
- 既有文件必须带匹配 ETag，磁盘被其他进程修改时返回冲突，不覆盖新版本；
- 保存前必须通过 canonical schema、registry、namespace、确定性序列化和 `contentHash` 校验；
- 写入先落临时文件，再在同一目录原子替换。

## 每次交付门

在 Web 仓库：

```bash
npm test
npm run check
npm run build
```

在 Godot 仓库：

```bash
npm run levels:roundtrip
npm run contract:gate
npm run godot:verify
```

`levels:roundtrip` 检查私有 formal JSON 可被 Web schema 读取、重新序列化后字节不变，并执行 Godot 导入。`contract:gate` 检查公开 labs/registries/assets/replays 的单向镜像与 3C 轨迹对等；正式关卡永远不进入 Web → Godot 同步树。

## 持续改进循环

1. 每个新物件先更新 Web type/asset/prefab registry，并同时实现 Godot handler；
2. 在复合物件验证场增加最小可观察样例和切图路径；
3. 用固定输入补充 Web/Godot 对比证据，再把 draft tuning 提升为 approved；
4. 对关卡编辑器的真实事故补充回归测试，优先覆盖冲突写回、路径边界、schema 迁移和大关卡性能；
5. 每轮只记录实际执行的测试、内容哈希和人工验收结论，历史通过不冒充当前状态；
6. 任何新增同步方向、目录或自动删除行为都必须单独评审，不能临时扩大脚本权限。
