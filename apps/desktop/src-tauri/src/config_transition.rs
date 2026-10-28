//! 配置变更走哪条路。
//!
//! 纯决策，不碰进程。调用方据此选择：只落盘、mihomo `PUT /configs?force=true`、
//! 或停掉再拉起。TUN 开关不走这里，它要换特权进程，仍由各平台 `toggle_tun` 处理。

use crossbow_core::Engine;

/// 一次变更对正在运行的内核该怎么生效。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Plan {
    /// 内核没在跑。新状态写入存储即可，不要去停一个不存在的进程。
    PersistOnly,
    /// 同一 mihomo 进程重载配置。系统代理和监听端口保持不动。
    HotReload,
    /// 进程身份或监听变了，必须停再启。
    Restart,
}

/// 决定热重载是否安全的现场条件。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LiveCore {
    pub running: bool,
    pub mihomo: bool,
    pub controller: bool,
    /// 已有一份可回滚的运行配置。没有它，热重载失败后无法把旧文件写回去。
    pub cached_config: bool,
}

/// 订阅、覆写、切换当前档案：内容变了，进程身份没变。
///
/// 热重载要求三件事同时成立：mihomo、控制器还在、手里有旧配置可回滚。
/// sing-box 的 clash_api 不能可靠重载，缺控制器或旧配置时只能停再启。
pub fn plan_content(live: LiveCore) -> Plan {
    if !live.running {
        return Plan::PersistOnly;
    }
    if live.mihomo && live.controller && live.cached_config {
        Plan::HotReload
    } else {
        Plan::Restart
    }
}

/// 换引擎、改混合端口、改局域网绑定。监听或二进制变了，热重载盖不住。
pub fn plan_identity(live: LiveCore) -> Plan {
    if live.running {
        Plan::Restart
    } else {
        Plan::PersistOnly
    }
}

/// 引擎、端口、局域网、TUN 任一变化都不是「只改订阅内容」。
pub fn needs_new_process(
    before_engine: Engine,
    after_engine: Engine,
    before_port: u16,
    after_port: u16,
    before_lan: bool,
    after_lan: bool,
    before_tun: bool,
    after_tun: bool,
) -> bool {
    before_engine != after_engine
        || before_port != after_port
        || before_lan != after_lan
        || before_tun != after_tun
}

#[cfg(test)]
mod tests {
    use super::*;

    fn live(running: bool, mihomo: bool, controller: bool, cached_config: bool) -> LiveCore {
        LiveCore {
            running,
            mihomo,
            controller,
            cached_config,
        }
    }

    #[test]
    fn content_change_reloads_a_running_mihomo_with_a_cached_config() {
        assert_eq!(
            plan_content(live(true, true, true, true)),
            Plan::HotReload
        );
    }

    #[test]
    fn content_change_does_not_touch_a_stopped_core() {
        assert_eq!(
            plan_content(live(false, true, false, false)),
            Plan::PersistOnly
        );
    }

    #[test]
    fn content_change_restarts_when_hot_reload_cannot_roll_back() {
        assert_eq!(
            plan_content(live(true, true, true, false)),
            Plan::Restart
        );
        assert_eq!(
            plan_content(live(true, true, false, true)),
            Plan::Restart
        );
        assert_eq!(
            plan_content(live(true, false, true, true)),
            Plan::Restart
        );
    }

    #[test]
    fn identity_change_restarts_only_when_the_core_is_running() {
        assert_eq!(plan_identity(live(true, true, true, true)), Plan::Restart);
        assert_eq!(
            plan_identity(live(false, false, false, false)),
            Plan::PersistOnly
        );
    }

    #[test]
    fn engine_port_lan_or_tun_change_needs_a_new_process() {
        assert!(needs_new_process(
            Engine::Mihomo,
            Engine::SingBox,
            7897,
            7897,
            false,
            false,
            false,
            false
        ));
        assert!(needs_new_process(
            Engine::Mihomo,
            Engine::Mihomo,
            7897,
            7898,
            false,
            false,
            false,
            false
        ));
        assert!(needs_new_process(
            Engine::Mihomo,
            Engine::Mihomo,
            7897,
            7897,
            false,
            true,
            false,
            false
        ));
        assert!(needs_new_process(
            Engine::Mihomo,
            Engine::Mihomo,
            7897,
            7897,
            false,
            false,
            false,
            true
        ));
        assert!(!needs_new_process(
            Engine::Mihomo,
            Engine::Mihomo,
            7897,
            7897,
            false,
            false,
            true,
            true
        ));
    }
}
