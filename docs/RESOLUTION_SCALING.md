# Web 与 Godot 分辨率缩放规范

## 共同基准

- 玩法、相机、关卡数据和输入命中统一使用 `1280×720` 逻辑坐标。
- 显示分辨率只影响绘制精度，不应修改速度、跳跃高度、绳长、硬杆长度、碰撞体或相机可视范围。
- Web 与 Godot 双边对比阶段固定为 `16:9` 安全画面；其他宽高比使用留边，不拉伸画面。
- HUD 必须相对安全画面四角布局，不能依赖设备的物理像素位置。

## Web

Canvas 的 CSS 尺寸负责页面布局，内部缓冲尺寸按以下关系计算：

`内部缓冲 = CSS 显示尺寸 × devicePixelRatio`

绘制前再把 Context 缩放回 `1280×720` 逻辑坐标。当前实现最高使用 `3×` 绘制比例，即最大 `3840×2160`，避免超高 DPI 设备产生过大的 GPU 与内存开销。

鼠标坐标始终通过 Canvas 的 CSS 边界换算到逻辑坐标，因此提高内部缓冲分辨率不会改变绳索、硬杆或猛击瞄准。

## Godot 4.x

原型同步实现采用非像素画风的 2D 配置：

```ini
[display]

window/size/viewport_width=1280
window/size/viewport_height=720
window/stretch/mode="canvas_items"
window/stretch/aspect="keep"
window/stretch/scale_mode="fractional"
window/dpi/allow_hidpi=true
```

实施要求：

- 使用 `canvas_items`，让 2D 内容直接按目标窗口分辨率渲染；不要使用先渲染到固定低分辨率再放大的 `viewport` 模式。
- 双边验收阶段使用 `keep` 保持严格 `16:9`，超宽屏和竖屏通过 letterbox/pillarbox 留边。
- `allow_hidpi` 保持开启，不能用系统的低 DPI 回退掩盖布局问题。
- UI 放在独立 `CanvasLayer`，使用 Control 锚点和安全区容器；游戏世界仍使用 1280×720 的设计基准。
- 贴图至少提供目标显示尺寸的 2 倍源文件；会被缩小显示的贴图启用 mipmap，避免高分辨率素材在小屏幕产生闪烁。
- 每次同步验收至少覆盖 `1280×720`、`1920×1080`、`2560×1440`、超宽屏和一个高 DPI 窗口。

如果以后决定让超宽屏显示更多左右关卡内容，可以把 Godot 的 Stretch Aspect 改成 `keep_height`，同时在 Web 端引入同等的动态逻辑宽度；这必须作为一次双边变更，不能只改其中一端。
