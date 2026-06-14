use tauri::{LogicalSize, WebviewWindow};

/// 矩形 (x, y, w, h)，物理像素坐标（坐标可负：多显示器副屏在主屏左/上方）。
pub type Rect = (i32, i32, u32, u32);

/// 异常小尺寸阈值（物理像素）：低于此判定为塌缩，强制复位。
const COLLAPSE_THRESHOLD: u32 = 200;

/// Fixed-Version WebView2 运行时下，窗口可能塌缩成极小尺寸（如 6x6）——控制器初始化时序所致，
/// Evergreen 模式无此问题。检测到异常小则强制可用尺寸 + 居中；总是 show + 聚焦。
/// 根治"窗口不可见 / 6x6 空窗、minWidth 未生效"。任何窗口 API 错误静默放行。
pub fn ensure_sized(window: &WebviewWindow) {
    if let Ok(size) = window.outer_size() {
        if size.width < COLLAPSE_THRESHOLD || size.height < COLLAPSE_THRESHOLD {
            let _ = window.unmaximize();
            let _ = window.set_size(LogicalSize::new(1200.0, 800.0));
            let _ = window.center();
        }
    }
    let _ = window.show();
    let _ = window.set_focus();
}

/// 窗口矩形与任一显示器矩形相交即 true（D-04 离屏判定，纯函数）。
/// 空显示器列表视为不相交（调用方据此 center()）。
pub fn rects_intersect(win: Rect, monitors: &[Rect]) -> bool {
    monitors.iter().any(|&m| overlaps(win, m))
}

/// 严格相交（仅边缘相邻不算）：i64 运算规避 i32 + u32 溢出。
fn overlaps(a: Rect, b: Rect) -> bool {
    let (ax, ay, aw, ah) = (a.0 as i64, a.1 as i64, a.2 as i64, a.3 as i64);
    let (bx, by, bw, bh) = (b.0 as i64, b.1 as i64, b.2 as i64, b.3 as i64);
    ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah
}

/// 离屏兜底（Pitfall 2：负坐标偏移/显示器拔除后恢复到可见区外）：
/// 窗口与所有显示器均不相交则 center()。任何窗口 API 错误静默放行——
/// 启动不因几何检查失败而崩溃。
pub fn ensure_visible(window: &WebviewWindow) {
    let (Ok(pos), Ok(size), Ok(monitors)) = (
        window.outer_position(),
        window.outer_size(),
        window.available_monitors(),
    ) else {
        return;
    };
    let win = (pos.x, pos.y, size.width, size.height);
    let rects: Vec<Rect> = monitors
        .iter()
        .map(|m| {
            let p = m.position();
            let s = m.size();
            (p.x, p.y, s.width, s.height)
        })
        .collect();
    if !rects_intersect(win, &rects) {
        let _ = window.center();
    }
}

#[cfg(test)]
mod tests {
    use super::rects_intersect;

    const PRIMARY: (i32, i32, u32, u32) = (0, 0, 1920, 1080);

    #[test]
    fn offscreen_window_does_not_intersect() {
        assert!(!rects_intersect((3000, 3000, 800, 600), &[PRIMARY]));
    }

    #[test]
    fn partial_overlap_intersects() {
        assert!(rects_intersect((1800, 1000, 800, 600), &[PRIMARY]));
    }

    #[test]
    fn negative_shadow_offset_still_intersects() {
        // Windows 阴影边框偏移案例：(-9,-9) 起点的窗口仍覆盖主屏
        assert!(rects_intersect((-9, -9, 800, 600), &[PRIMARY]));
    }

    #[test]
    fn empty_monitor_list_does_not_intersect() {
        assert!(!rects_intersect((0, 0, 800, 600), &[]));
    }

    #[test]
    fn second_monitor_left_of_primary_intersects() {
        // 副屏位于主屏左侧（负坐标原点），窗口落在副屏内
        let left = (-1920, 0, 1920, 1080);
        assert!(rects_intersect((-1000, 100, 800, 600), &[PRIMARY, left]));
    }

    #[test]
    fn edge_touching_does_not_intersect() {
        // 恰好贴在主屏右边缘之外：零重叠面积视为离屏
        assert!(!rects_intersect((1920, 0, 800, 600), &[PRIMARY]));
    }
}
