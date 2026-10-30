//! Linux TUN transitions share CoreManager; the service owns network resources.
use crate::{AppState, CoreStatus};

pub fn toggle_tun(state: &AppState, enable: bool) -> Result<(), String> {
    let _operation = state.core_op.lock().unwrap_or_else(|e| e.into_inner());
    let _recovery = crate::config_transition::RecoveryOwner::enter(&state.config_transition);
    let was_running = matches!(
        state.core().status(),
        CoreStatus::Running | CoreStatus::Starting
    );
    let actual = match crate::linux_service::status() {
        Ok(session) => Some(session.is_some_and(|s| s.active)),
        Err(error) if enable => return Err(error),
        Err(_) => None, // Closing must still retry a disconnected service's cleanup.
    };
    if actual == Some(enable) && enable == state.store.lock().unwrap().data().engine.tun_enable {
        return Ok(());
    }
    if enable {
        if state.store.lock().unwrap().data().engine.engine != crossbow_core::Engine::Mihomo {
            return Err("Linux TUN 当前仅支持 mihomo，请先切换内核".into());
        }
        crate::render_current(state, true)?;
        let own = state.core().pid().into_iter().collect::<Vec<_>>();
        crossbow_service::linux_network::ensure_available(None, &own)?;
        // Authorization and conflict checks precede stopping the user's proxy.
        crate::linux_service::authorize()?;
    }
    if !state.core().stop() {
        return Err("内核或网络资源未完全释放，TUN 状态未改变；请重试停止".into());
    }
    state.store.lock().unwrap().data_mut().engine.tun_enable = enable;
    if enable || was_running {
        let started =
            crate::start_core_locked(state).and_then(|()| crate::wait_core_running(state));
        if let Err(error) = started {
            if !state.core().stop() {
                return Err(format!(
                    "TUN 切换失败：{error}；资源清理未确认，请重试关闭 TUN"
                ));
            }
            state.store.lock().unwrap().data_mut().engine.tun_enable = false;
            let recovery = if enable && was_running {
                crate::start_core_locked(state).and_then(|()| crate::wait_core_running(state))
            } else {
                Ok(())
            };
            let saved = state
                .store
                .lock()
                .unwrap()
                .save()
                .map_err(|e| e.to_string());
            return Err(format!(
                "TUN 切换失败：{error}{}{}",
                recovery
                    .err()
                    .map(|e| format!("；显式代理恢复失败：{e}"))
                    .unwrap_or_default(),
                saved
                    .err()
                    .map(|e| format!("；状态保存失败：{e}"))
                    .unwrap_or_default()
            ));
        }
    }
    if enable && !crate::linux_service::status()?.is_some_and(|s| s.active) {
        return Err("内核已启动，但服务未确认网络接管；请检查诊断并重试关闭 TUN".into());
    }
    // Persist only after the service confirmed the requested network state.
    state
        .store
        .lock()
        .unwrap()
        .save()
        .map_err(|e| e.to_string())
}
