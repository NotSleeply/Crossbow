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
            let value: serde_yaml::Value = serde_yaml::from_str(config).map_err(|e| e.to_string())?;
            value["tun"]["enable"].as_bool() == Some(true)
                || value["listeners"].as_sequence().is_some_and(|listeners| {
                    listeners.iter().any(|listener| listener["type"].as_str() == Some("tun"))
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
}

