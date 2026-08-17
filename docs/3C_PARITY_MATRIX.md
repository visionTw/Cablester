# Web / Godot 3C 对等矩阵

状态含义：`draft` 仅 Web 实验；`implemented` 已有双端实现但尚未完成共享固定输入轨迹容差；`automated-pass` 要求当前 checkout 的 Web/Godot 同输入轨迹、目标、资源与死亡断言全部通过；`approved` 还要求真人主观手感签字。当前 10 个案例已由真实 Web `Game.update()` 与 Godot `4.7.1.stable.official.a13da4feb` 在同一份 120 Hz 固定输入上完成自动对等，[`artifacts/godot/3c-parity-report.json`](../artifacts/godot/3c-parity-report.json) 为 **10/10 cases、318/318 assertions**。机器结果不冒充真人主观批准，因此 `humanConfirmation` 仍为 `needed`；第一阶段总体状态见 [`PHASE_ONE_REPORT.md`](PHASE_ONE_REPORT.md)。

## Approved tuning v1

固定步长 `1/120s`。位置单位与 canonical unit 一致。固定输入回放按 tick 记录，不按浏览器帧记录。

| 能力/语义 | Web 权威值 | Godot 容差 | 当前阶段 |
| --- | ---: | ---: | --- |
| 玩家半径 | 18 | 碰撞 bounds 完全一致 | automated-pass |
| 跑速 | 350 u/s | 路段末位置 ±18 u | automated-pass |
| 地面加速度 | 2500 u/s² | 达速时间 ±2 ticks | automated-pass |
| 空中加速度 | 1100 u/s² | 1s 横移 ±24 u | automated-pass |
| 跳速 | 590 u/s | 顶点时间 ±2 ticks；高度 ±18 u | automated-pass |
| coyote / buffer | 0.12s / 0.12s | ±1 tick | automated-pass |
| 软绳范围 | 470 | 目标选择 ID 必须一致 | automated-pass |
| 软绳长度 | 82–470 | 摆荡锚点不变；轨迹 RMS ≤24 u | automated-pass |
| 硬杆长度 | 120–330 | 长度误差 ≤1 u | automated-pass |
| 冲刺 | 850 u/s × 0.16s | 方向一致；末位置 ±18 u | automated-pass |
| 猛击 | 范围185；速度960 | 目标/方向一致；末位置 ±22 u | automated-pass |
| 滑翔 | 重力0.2；最大下落190 | 2s 高度差 ≤24 u | automated-pass |
| 二段跳 | 同 jumpSpeed | 触发 tick ±1；顶点 ±18 u | automated-pass |
| 墙抓/墙跳 | 85 / 545×380 | 接触状态一致；末位置 ±22 u | automated-pass |
| 资源 | energy 6；health 5 | 每 tick 值完全一致 | automated-pass |

## 永久保留案例

| Canonical case ID | Web | Godot | 固定输入断言 | 真人双端 | 状态 |
| --- | --- | --- | ---: | --- | --- |
| `movement-lab-01` | pass | pass | 35/35 | needed | automated-pass |
| `hard-bar-lab` | pass | pass | 34/34 | needed | automated-pass |
| `bash-lab` | pass | pass | 30/30 | needed | automated-pass |
| `double-jump-lab` | pass | pass | 26/26 | needed | automated-pass |
| `glide-lab` | pass | pass | 28/28 | needed | automated-pass |
| `dash-lab` | pass | pass | 26/26 | needed | automated-pass |
| `combined-speed` | pass | pass | 37/37 | needed | automated-pass |
| `combined-horizontal` | pass | pass | 38/38 | needed | automated-pass |
| `combined-vertical` | pass | pass | 36/36 | needed | automated-pass |
| `combined-hazards` | pass | pass | 28/28 | needed | automated-pass |

## 输入语义

- `move_left`/`move_right`：A/D、手柄左摇杆。
- `jump_glide`：Space；按下触发跳，空中第二次按下触发二段跳，下降保持触发滑翔。
- `dash`：Ctrl；与方向输入组合成八方向，否则使用 facing。
- `rope`：鼠标左键/手柄肩键；按下发射、松开回收。
- `rope_winch`：W/↑；仅连接软绳时生效。
- `hard_bar`：F；连接或释放。
- `bash`：Q；按住时停选向，松开或超时释放。
- `wall_grab`：Shift。
- `reset_checkpoint`：Backspace；测试输入，不进入正式平台默认映射。

任何 Web `draft` 调参不得更改 formal world 中的 `approved` block。批准新 tuning 时必须提升 `gameplayTuningVersion`，重录全部受影响回放并重新生成双端证据。
