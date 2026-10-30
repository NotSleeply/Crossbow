//! Read-only conflict checks shared by the desktop and Linux service.
use serde_json::Value;
use std::path::Path;
use std::process::Command;

pub const DEVICE: &str = "Crossbow";
pub const TABLE: u32 = 20220;
pub const PRIORITY: u32 = 12020;
pub const MARK: u32 = 49451;
pub const PROTOCOL: u32 = 242;

pub fn ip(args: &[&str]) -> Result<String, String> {
    let program = ["/usr/sbin/ip", "/usr/bin/ip", "/sbin/ip"]
        .into_iter()
        .find(|path| Path::new(path).is_file())
        .ok_or("需要安装 iproute2 才能检查 Linux 网络状态")?;
    let output = Command::new(program)
        .args(args)
        .env("LC_ALL", "C")
        .output()
        .map_err(|e| format!("读取网络状态失败：{e}"))?;
    if !output.status.success() {
        return Err(format!(
            "ip {}: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    String::from_utf8(output.stdout).map_err(|e| e.to_string())
}

fn rows(args: &[&str]) -> Result<Vec<Value>, String> {
    serde_json::from_str(&ip(args)?).map_err(|e| format!("无法解析网络状态：{e}"))
}

pub fn device_index() -> Result<Option<u32>, String> {
    Ok(rows(&["-j", "link", "show"])?
        .iter()
        .find(|link| link["ifname"] == DEVICE)
        .and_then(|link| link["ifindex"].as_u64())
        .map(|i| i as u32))
}

fn number(value: &Value, expected: u32) -> bool {
    value.as_u64() == Some(expected as u64)
        || value.as_str().is_some_and(|s| s == expected.to_string())
}

fn own_rule(rule: &Value) -> bool {
    number(&rule["priority"], PRIORITY)
        && number(&rule["table"], TABLE)
        && number(&rule["protocol"], PROTOCOL)
        && rule.get("not").is_some()
        && rule["fwmark"] == format!("0x{MARK:x}")
        && rule.get("fwmask").is_none_or(|mask| mask == "0xffffffff")
        && rule["src"] == "all"
        && rule.as_object().is_some_and(|m| {
            m.keys().all(|key| {
                matches!(
                    key.as_str(),
                    "priority" | "table" | "protocol" | "not" | "fwmark" | "fwmask" | "src"
                )
            })
        })
}

fn builtin_rule(rule: &Value) -> bool {
    let expected = match rule["priority"].as_u64() {
        Some(0) => "local",
        Some(32766) => "main",
        Some(32767) => "default",
        _ => return false,
    };
    rule["table"] == expected
        && rule["src"] == "all"
        && rule.as_object().is_some_and(|m| {
            m.keys()
                .all(|key| matches!(key.as_str(), "priority" | "table" | "src" | "protocol"))
        })
}

fn inspect(links: &[Value], rules: &[Value], routes: &[Value], own: Option<u32>) -> Vec<String> {
    let mut conflicts = Vec::new();
    for link in links {
        let name = link["ifname"].as_str().unwrap_or("unknown");
        let index = link["ifindex"].as_u64().map(|n| n as u32);
        if name == DEVICE && own.is_some() && index == own {
            continue;
        }
        let kind = link["linkinfo"]["info_kind"].as_str().unwrap_or("");
        let point_to_point = link["flags"]
            .as_array()
            .is_some_and(|flags| flags.iter().any(|flag| flag == "POINTOPOINT"));
        if name == DEVICE
            || point_to_point
            || matches!(
                kind,
                "tun" | "wireguard" | "gre" | "gretap" | "ipip" | "sit" | "ip6tnl" | "xfrm"
            )
        {
            conflicts.push(format!("已有隧道接口 {name}"));
        }
    }
    for rule in rules {
        if !builtin_rule(rule) && !(own.is_some() && own_rule(rule)) {
            conflicts.push(format!("已有策略路由（优先级 {}）", rule["priority"]));
        }
    }
    for route in routes {
        if number(&route["table"], TABLE) {
            let ours = own.is_some()
                && number(&route["protocol"], PROTOCOL)
                && (route["dev"] == DEVICE || route["type"] == "throw");
            if !ours {
                conflicts.push(format!("路由表 {TABLE} 已被占用"));
            }
        }
        if matches!(
            route["dst"].as_str(),
            Some("0.0.0.0/1" | "128.0.0.0/1" | "::/1" | "8000::/1")
        ) && route["dev"] != DEVICE
        {
            conflicts.push("已有分段默认路由".into());
        }
    }
    conflicts.sort();
    conflicts.dedup();
    conflicts
}

fn proxy_processes(own_pids: &[u32]) -> Vec<String> {
    let mut found = Vec::new();
    let our_net = std::fs::read_link("/proc/self/ns/net").ok();
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return found;
    };
    for entry in entries.flatten() {
        let Ok(pid) = entry.file_name().to_string_lossy().parse::<u32>() else {
            continue;
        };
        if own_pids.contains(&pid) {
            continue;
        }
        let Ok(name) = std::fs::read_to_string(entry.path().join("comm")) else {
            continue;
        };
        let lower = name.trim().to_ascii_lowercase();
        if !(lower.contains("clash") || lower.contains("mihomo") || lower.contains("sing-box")) {
            continue;
        }
        // Ignore processes proven to belong to another network namespace.
        let other_net = std::fs::read_link(entry.path().join("ns/net")).ok();
        if our_net.is_some() && other_net.is_some() && our_net != other_net {
            continue;
        }
        found.push(format!("已有代理进程 {}（pid {pid}）", name.trim()));
    }
    found
}

pub fn conflicts(own_ifindex: Option<u32>, own_pids: &[u32]) -> Result<Vec<String>, String> {
    let links = rows(&["-j", "-d", "link", "show"])?;
    let mut rules = rows(&["-j", "-4", "rule", "show"])?;
    rules.extend(rows(&["-j", "-6", "rule", "show"])?);
    let mut routes = rows(&["-j", "-4", "route", "show", "table", "all"])?;
    routes.extend(rows(&["-j", "-6", "route", "show", "table", "all"])?);
    let mut result = inspect(&links, &rules, &routes, own_ifindex);
    result.extend(proxy_processes(own_pids));
    Ok(result)
}

pub fn ensure_available(own_ifindex: Option<u32>, own_pids: &[u32]) -> Result<(), String> {
    let found = conflicts(own_ifindex, own_pids)?;
    if found.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "未接管网络：{}。请自行关闭冲突项后重试；Crossbow 不会停止其他代理或 VPN",
            found.join("；")
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn detects_vpn_policy_routes_and_occupied_resources() {
        let links =
            vec![json!({"ifname":"wg-work","ifindex":4,"linkinfo":{"info_kind":"wireguard"}})];
        let rules = vec![json!({"priority":5270,"src":"all","table":"52"})];
        assert_eq!(inspect(&links, &rules, &[], None).len(), 2);
        let own = json!({"ifname":DEVICE,"ifindex":9,"flags":["POINTOPOINT"]});
        assert!(!inspect(std::slice::from_ref(&own), &[], &[], None).is_empty());
        assert!(inspect(&[own], &[], &[], Some(9)).is_empty());
        assert!(!inspect(&[], &[], &[json!({"table":TABLE,"dst":"default"})], None).is_empty());
    }
    #[test]
    fn only_exact_own_and_standard_rules_are_ignored() {
        let mut own = json!({"priority":PRIORITY,"src":"all","table":TABLE.to_string(),
            "not":null,"fwmark":format!("0x{MARK:x}"),"protocol":PROTOCOL.to_string()});
        assert!(own_rule(&own));
        assert!(!inspect(&[], std::slice::from_ref(&own), &[], None).is_empty());
        assert!(inspect(&[], std::slice::from_ref(&own), &[], Some(9)).is_empty());
        own["table"] = json!(52);
        assert!(!own_rule(&own));
        assert!(builtin_rule(
            &json!({"priority":32766,"src":"all","table":"main"})
        ));
        assert!(!builtin_rule(
            &json!({"priority":32766,"src":"all","table":"main","fwmark":"0x1"})
        ));
    }
}
