//! Capabilities of this build, shared by commands, diagnostics and the UI.
//! Linux phase one offers an explicit proxy only; it never takes over networking.

#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct Capabilities {
    pub system_proxy: bool,
    pub tun: bool,
    pub app_update: bool,
}

pub const fn capabilities() -> Capabilities {
    let supported = cfg!(any(target_os = "macos", windows));
    Capabilities {
        system_proxy: supported,
        tun: supported,
        app_update: supported,
    }
}

/// A subscription/override must not bypass the unavailable TUN switch.
pub fn validate_config(engine: crossbow_core::Engine, config: &str) -> Result<(), String> {
    if capabilities().tun {
        return Ok(());
    }
    let has_tun = match engine {
        crossbow_core::Engine::Mihomo => {
            let mut value: serde_yaml::Value =
                serde_yaml::from_str(config).map_err(|e| e.to_string())?;
            value.apply_merge().map_err(|e| e.to_string())?;
            // Go YAML also accepts yes/on as true. Allow only absent/null or
            // explicit false, and reject any merge left unresolved here.
            value.get("<<").is_some()
                || value["tun"].get("<<").is_some()
                || !matches!(
                    value["tun"]["enable"],
                    serde_yaml::Value::Null | serde_yaml::Value::Bool(false)
                )
                || value["listeners"].as_sequence().is_some_and(|listeners| {
                    listeners.iter().any(|listener| {
                        listener.get("<<").is_some() || listener["type"].as_str() == Some("tun")
                    })
                })
        }
        crossbow_core::Engine::SingBox => {
            let value: serde_json::Value = serde_json::from_str(config).map_err(|e| e.to_string())?;
            value["inbounds"].as_array().is_some_and(|inbounds| {
                inbounds.iter().any(|inbound| inbound["type"].as_str() == Some("tun"))
            })
        }
    };
    if has_tun {
        Err("当前平台仅支持显式代理，请先移除配置或覆写中的 TUN 入站".into())
    } else {
        Ok(())
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use crossbow_core::Engine;

    #[test]
    fn imported_config_cannot_bypass_unavailable_tun() {
        assert!(validate_config(Engine::Mihomo, "tun: {enable: true}").is_err());
        assert!(validate_config(Engine::Mihomo, "listeners: [{type: tun, name: extra}]").is_err());
        assert!(validate_config(Engine::SingBox, r#"{"inbounds":[{"type":"tun"}]}"#).is_err());
        assert!(validate_config(Engine::Mihomo, "tun: {enable: false}\nproxies: []").is_ok());
        assert!(validate_config(Engine::SingBox, r#"{"inbounds":[{"type":"mixed"}]}"#).is_ok());
    }

    #[test]
    fn mihomo_tun_enable_must_be_absent_or_explicitly_false() {
        for enable in ["true", "yes", "Y", "ON", "'yes'", "'true'", "1", "[]", "{}"] {
            let config = format!("tun: {{enable: {enable}, auto-route: true}}");
            assert!(
                validate_config(Engine::Mihomo, &config).is_err(),
                "{enable}"
            );
        }
        for config in [
            "proxies: []",
            "tun: {}",
            "tun: {enable: null}",
            "tun: {enable: false}",
        ] {
            assert!(validate_config(Engine::Mihomo, config).is_ok(), "{config}");
        }
    }

    #[test]
    fn mihomo_yaml_merges_cannot_hide_tun() {
        for config in [
            "base: &base {tun: {enable: true}}\n<<: *base",
            "base: &base {enable: yes}\ntun: {<<: *base}",
            "base: &base {type: tun}\nlisteners: [{<<: *base}]",
            "base: &base {enable: true}\nnext: &next {<<: *base}\ntun: {<<: *next}",
        ] {
            assert!(validate_config(Engine::Mihomo, config).is_err(), "{config}");
        }
        assert!(validate_config(
            Engine::Mihomo,
            "base: &base {enable: true}\ntun: {<<: *base, enable: false}"
        )
        .is_ok());
    }
}
