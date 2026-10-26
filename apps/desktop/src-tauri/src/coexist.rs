//! 与其他代理/VPN 的共存检测（#23）。
//!
//! 启动/首页轮询时扫描两类冲突源，发现即由首页横幅提示（不静默）：
//! 1. 其他隧道：utun 接口持有默认路由（其他代理/VPN 的 TUN 正在接管）
//! 2. 常驻代理软件：已知特权服务（clash-verge-service 等）与本应用无关的
//!    内核进程（mihomo/sing-box，路径不属于本应用）
//!
//! 检测是信息性的——真正的硬冲突由开 TUN 时的 `ensure_route_available`
//! 与端口预检的自愈/报错兜底。

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct CoexistFinding {
    /// tunnel = 其他 TUN 接管默认路由；service = 已知常驻服务；core = 其他内核进程
    pub kind: String,
    pub detail: String,
}

/// 判定 netstat 目的地列是否为全量默认路由。
/// macOS 把 0.0.0.0/0 渲染为 default，mihomo/sing-box 的 auto-route
/// 渲染为 1、2/7、4/6 … 128.0/1 的分流系列。
fn is_default_destination(destination: &str) -> bool {
    matches!(destination, "default" | "0" | "0/0" | "0.0.0.0/0")
        || matches!(
            destination,
            "1" | "1/8" | "1.0.0.0/8"
                | "2/7"
                | "4/6"
                | "8/5"
                | "16/4"
                | "32/3"
                | "64/2"
                | "128.0/1"
        )
}

/// 本应用内核的路径特征（不视为“其他代理”）。
fn is_own_core_path(line: &str) -> bool {
    line.contains("/Crossbow.app/")
        || line.contains("com.richard.crossbow")
        || line.contains("com.crossbow.app")
}

/// 从 `ps -axo command=` 的行里识别其他代理软件。
/// 返回 (是否发现已知常驻服务, 其他内核进程命令行列表)。
fn scan_process_lines(lines: &[&str]) -> (bool, Vec<String>) {
    let mut service = false;
    let mut cores: Vec<String> = Vec::new();
    for raw in lines {
        let line = raw.trim();
        if line.is_empty() || line.contains("grep ") {
            continue;
        }
        if line.contains("clash-verge-service") {
            service = true;
            continue;
        }
        let is_core = (line.contains("mihomo") || line.contains("sing-box"))
            && !is_own_core_path(line);
        if is_core && !cores.iter().any(|seen| seen == line) {
            cores.push(line.to_string());
        }
    }
    (service, cores)
}

/// 由三类原始信号组装提示：**只提示真实冲突源**——闲置的常驻服务
/// （未拉起内核）不占端口不接管流量，单独提示只会狼来了；其内核
/// （verge-mihomo）跑起来时自然会以 core 条目出现。
fn build_findings(
    tunnel: Option<String>,
    service: bool,
    cores: Vec<String>,
) -> Vec<CoexistFinding> {
    let mut out = Vec::new();
    if let Some(iface) = tunnel {
        out.push(CoexistFinding {
            kind: "tunnel".into(),
            detail: format!(
                "接口 {iface} 正在接管默认路由（其他代理/VPN 的 TUN 已开启）"
            ),
        });
    }
    if !cores.is_empty() {
        out.push(CoexistFinding {
            kind: "core".into(),
            detail: format!("检测到其他代理的内核进程：{}", cores.join(" ｜ ")),
        });
    }
    let _ = service;
    out
}

/// Only exclude the exact interface confirmed by Crossbow's live controller.
/// Continue scanning after an own route so a second VPN is still reported.
#[cfg(any(target_os = "macos", test))]
fn foreign_tunnel(table: &str, own_device: Option<&str>) -> Option<String> {
    table.lines().find_map(|line| {
        let cols: Vec<&str> = line.split_whitespace().collect();
        let destination = *cols.first()?;
        // Netif is column 4; the optional Expire column may follow it.
        let interface = *cols.get(3)?;
        (is_default_destination(destination)
            && interface.starts_with("utun")
            && Some(interface) != own_device)
            .then(|| interface.to_string())
    })
}

/// macOS：检测外部隧道与内核，排除本应用控制器确认的 TUN 接口。
#[cfg(target_os = "macos")]
pub fn detect(state: &crate::AppState) -> Vec<CoexistFinding> {
    let core = state.core();
    let own_device = if core.status() == crate::CoreStatus::Running {
        core.controller().and_then(|(port, secret)| {
            crate::mihomo_api::Controller { port, secret }
                .active_tun_device()
                .ok()
                .flatten()
        })
    } else {
        None
    };

    // Read ownership before the route table, without holding an AppState lock
    // across controller I/O. A failed query never exempts all utun interfaces.
    let tunnel = crate::process::command("netstat")
        .args(["-rn", "-f", "inet"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| {
            foreign_tunnel(
                &String::from_utf8_lossy(&output.stdout),
                own_device.as_deref(),
            )
        });

    // 2) 常驻服务与其他内核进程
    let (service, cores) = crate::process::command("ps")
        .args(["-axo", "command="])
        .output()
        .map(|output| {
            let text = String::from_utf8_lossy(&output.stdout);
            scan_process_lines(&text.lines().collect::<Vec<_>>())
        })
        .unwrap_or((false, Vec::new()));

    build_findings(tunnel, service, cores)
}

/// Windows：tasklist 按图像文件名识别其他代理。本应用侧车为
/// mihomo-x86_64-pc-windows-msvc.exe 全名，与第三方 mihomo.exe/
/// verge-mihomo.exe 不冲突，可按名直分。
#[cfg(target_os = "windows")]
pub fn detect(_state: &crate::AppState) -> Vec<CoexistFinding> {
    let Ok(output) = crate::process::command("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .output()
    else {
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let mut cores: Vec<String> = Vec::new();
    for line in text.lines() {
        let Some(image) = line.split('"').nth(1) else { continue };
        let lower = image.to_lowercase();
        let is_other_proxy = (lower.contains("verge") || lower == "mihomo.exe" || lower == "sing-box.exe")
            && !lower.contains("crossbow");
        if is_other_proxy && !cores.iter().any(|c| c.contains(&lower)) {
            cores.push(image.to_string());
        }
    }
    if cores.is_empty() {
        return Vec::new();
    }
    vec![CoexistFinding {
        kind: "core".into(),
        detail: format!("检测到其他代理的内核进程：{}", cores.join(" ｜ ")),
    }]
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn detect(_state: &crate::AppState) -> Vec<CoexistFinding> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    const OWN_ROUTES: &str = "Destination Gateway Flags Netif Expire\ndefault 192.168.1.1 UGScg en0\n1 198.18.0.1 UGSc utun4\n2/7 198.18.0.1 UGSc utun4\n128.0/1 198.18.0.1 UGSc utun4\n";

    #[test]
    fn own_tun_and_idle_service_do_not_warn() {
        let (service, cores) = scan_process_lines(&[
            "/Applications/Crossbow.app/Contents/MacOS/mihomo",
            "/Library/PrivilegedHelperTools/clash-verge-service",
        ]);
        assert!(
            build_findings(foreign_tunnel(OWN_ROUTES, Some("utun4")), service, cores).is_empty()
        );
    }

    #[test]
    fn external_tun_is_found_after_own_routes() {
        let table = format!("{OWN_ROUTES}default 10.0.0.1 UGSc utun7\n");
        assert_eq!(
            foreign_tunnel(&table, Some("utun4")).as_deref(),
            Some("utun7")
        );
    }

    #[test]
    fn unconfirmed_ownership_does_not_hide_tunnels() {
        assert_eq!(foreign_tunnel(OWN_ROUTES, None).as_deref(), Some("utun4"));
        assert_eq!(
            foreign_tunnel(OWN_ROUTES, Some("utun40")).as_deref(),
            Some("utun4")
        );
    }

    #[test]
    fn netif_precedes_optional_expire_column() {
        let table = "default 10.0.0.1 UGSc utun7 123\n";
        assert_eq!(foreign_tunnel(table, None).as_deref(), Some("utun7"));
        assert!(foreign_tunnel(table, Some("utun7")).is_none());
    }

    #[test]
    fn default_destinations_recognized() {
        for d in ["default", "1", "2/7", "128.0/1", "64/2"] {
            assert!(is_default_destination(d), "missing {d}");
        }
        assert!(!is_default_destination("192.168.31"));
        assert!(!is_default_destination("224.0.0/4"));
    }

    #[test]
    fn own_kernels_not_flagged() {
        let lines = [
            "/Applications/Crossbow.app/Contents/MacOS/mihomo -d runtime",
            "/Users/x/com.richard.crossbow/tun-binaries/v1/mihomo -d runtime",
        ];
        let (service, cores) = scan_process_lines(&lines);
        assert!(!service);
        assert!(cores.is_empty());
    }

    #[test]
    fn verge_service_and_cores_detected() {
        let lines = [
            "/Library/PrivilegedHelperTools/io.github.clash-verge-rev.clash-verge-rev.service.bundle/Contents/MacOS/clash-verge-service",
            "/usr/local/bin/sing-box run -c x.json",
        ];
        let (service, cores) = scan_process_lines(&lines);
        assert!(service);
        assert_eq!(cores.len(), 1);
        assert!(cores[0].contains("sing-box"));
    }

    #[test]
    fn grep_noise_ignored() {
        let lines = ["grep --color=auto mihomo"];
        let (service, cores) = scan_process_lines(&lines);
        assert!(!service);
        assert!(cores.is_empty());
    }

    /// 策略回归（用户反馈）：闲置常驻服务不提示——退出 Verge 应用后
    /// 其特权服务仍常驻属正常状态，单独横幅是狼来了。
    #[test]
    fn idle_service_alone_not_reported() {
        let findings = build_findings(None, true, Vec::new());
        assert!(findings.is_empty());
    }

    #[test]
    fn tunnel_and_core_reported() {
        let findings = build_findings(
            Some("utun7".into()),
            true,
            vec!["/Library/.../verge-mihomo -d x".into()],
        );
        assert_eq!(findings.len(), 2);
        assert_eq!(findings[0].kind, "tunnel");
        assert_eq!(findings[1].kind, "core");
    }

    #[test]
    fn tunnel_alone_reported() {
        let findings = build_findings(Some("utun9".into()), false, Vec::new());
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].kind, "tunnel");
    }
}
