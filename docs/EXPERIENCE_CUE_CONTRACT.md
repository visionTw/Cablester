# Cablester Godot-first 体验提示契约

状态：`cablester-experience-cues-v1`  
批准端：`cablester_godot`  
公开结构端：`cablester_web`  
人工验收：`awaiting-user`

## 1. 职责边界

- Godot 是正式 3C、正式玩家反馈、动画状态机、镜头、音画反馈、正式内容和最终人工体验验收的权威平台。
- Web 是公开 3C 试玩端、公开测试素材和 canonical JSON 关卡编辑器。Web 权威维护公开安全的 world schema、type/asset/prefab registries、labs、校验、预览与导出能力。
- Godot 批准的 3C 参数和反馈语义通过版本化 `experience-cue-registry.json` 发布。Web 可以按 Canvas 技术适配其造型，但不能静默改变触发、玩家含义、方向/强弱或生命周期。
- 正式关卡、叙事、存档、Godot 源码、私有证据和发布配置不得进入 Web。

这不是把所有数据流反转为 Godot → Web。公开 world 格式与 registry 仍由 Web 定义；正式 3C 结果与体验语义由 Godot 批准，再以公开安全 snapshot 被 Web 消费。

## 2. 硬性一致性

双端一致性要求：相同真实运行状态触发、相同玩家含义、相同方向与强弱语义、相同出现/激活/完成/退出生命周期，并且第一次体验的玩家都能理解。像素、粒子数量、着色器和绘制技术可以按引擎适配。

不得以 telemetry、hash、静态画面存在或单张截图替代动态反馈与玩家理解。每条结论分别记录：

1. 逻辑/轨迹一致；
2. 静态画面存在；
3. 动态反馈完整；
4. 玩家能够理解。

## 3. 三个证明切片

### 3.1 滑翔翅膀 `ability.glide`

真实触发来自运行时 `gliding`，不是按键。状态固定为 `locked`、`ready`、`opening`、`gliding`、`closing`；落地后归 `ready`，未解锁归 `locked`。视觉必须跟随 facing 和重力方向，展开/收拢只改变表现，不改变 canonical 玩家碰撞、位置或速度。

### 3.2 风场 `windZone`

方向和强弱只读取 canonical `forceX`/`forceY`。零向量不得伪造方向；非零向量按归一化方向绘制，强度取向量长度并进行表现尺度夹取。运行时覆盖 `idle`、`inside`、`exiting`，编辑器无需启动玩法也必须显示方向与范围。不得以颜色推断或单独区分方向。

### 3.3 动态提示点 `sign`

“提示点”复用现有 canonical `sign`，不新建平行类型。公开属性为 `text`、`nearbyRadius`、`activationRadius`、`completionFlag`、`oneShot`、`disabled`。生命周期固定为 `idle`、`nearby`、`activated`、`completed`、`disabled`；状态由玩家距离、交互和真实进度驱动，不能是永久循环装饰。

`sign` 始终保持 `collisionSemantics: none`。编辑器范围环只是预览，不写回碰撞。reduced-motion 关闭位移/缩放循环，保留轮廓、文字、亮度和状态徽标，使含义仍可辨认。

## 4. 版本与批准规则

公开 snapshot 的 canonical 文件是 `worlds/registries/experience-cue-registry.json`。`experienceCueVersion` 变化必须经过 Godot 实现、隔离运行、双端测试、动态证据和 review；批准记录绑定版本与源文件 SHA-256。Web 发现未知版本、缺失状态或不支持的 cue 时必须显式失败或降级并报告，不能自行重定义。

本轮批准状态在自动验证前保持 `candidate`，完成后可变成 `automated-pass`。即使自动门全部通过，人工状态仍为 `awaiting-user`；只有用户亲自体验两端并明确确认后才能成为 `accepted`。

## 5. 动态证据门

三个切片分别在相同公开 lab、相同 canonical 状态检查点生成 Web/Godot 并排时间序列。每个切片至少包含：开始前、激活初始帧、动画中间帧、稳定状态、退出或完成状态，并附真实状态数据、版本、world hash、运行时、时间点和证据 hash。

自动门至少覆盖状态转换、四方向映射、锁定/激活/退出/完成负向案例、碰撞与轨迹不变、Web schema 与编辑器 roundtrip、Godot semantic diff、Godot 隔离证明、Web test/check/build、公开边界与私有泄漏检查。

