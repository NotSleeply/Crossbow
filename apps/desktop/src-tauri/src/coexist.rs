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

/// 执行检测。非 unix 平台返回空（Windows 于 M1.5 补齐）。
#[cfg(target_os = "macos")]
pub fn detect() -> Vec<CoexistFinding> {
    let mut out: Vec<CoexistFinding> = Vec::new();

    // 1) 其他隧道持有默认路由
    if let Ok(output) = std::process::Command::new("netstat").args(["-rn", "-f", "inet"]).output() {
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines() {
            let cols: Vec<&str> = line.split_whitespace().collect();
            if cols.len() < 4 {
                continue;
            }
            let destination = cols[0];
            let interface = cols[cols.len() - 1];
            if is_default_destination(destination) && interface.starts_with("utun") {
                out.push(CoexistFinding {
                    kind: "tunnel".into(),
                    detail: format!(
                        "接口 {interface} 正在接管默认路由（其他代理/VPN 的 TUN 已开启）"
                    ),
                });
                break;
            }
        }
    }

    // 2) 常驻服务与其他内核进程
    if let Ok(output) = std::process::Command::new("ps").args(["-axo", "command="]).output() {
        let text = String::from_utf8_lossy(&output.stdout);
        let lines: Vec<&str> = text.lines().collect();
        let (service, cores) = scan_process_lines(&lines);
        if service {
            out.push(CoexistFinding {
                kind: "service".into(),
                detail: "Clash Verge 的特权服务正在常驻（clash-verge-service）".into(),
            });
        }
        if !cores.is_empty() {
            out.push(CoexistFinding {
                kind: "core".into(),
                detail: format!("检测到其他代理的内核进程：{}", cores.join(" ｜ ")),
            });
        }
    }

    out
}

#[cfg(not(target_os = "macos"))]
pub fn detect() -> Vec<CoexistFinding> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
