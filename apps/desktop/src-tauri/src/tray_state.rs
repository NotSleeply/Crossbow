//! 托盘节点子菜单的统一状态存储。
//!
//! 此前这里是 9 个独立的 Mutex/Atomic 字段（group/delays/failed/now/title/
//! nodes/testing/testing_since/generation），每个功能各自持锁、各自派发，
//! 导致过：回调断联、ABBA 死锁、速率冻结、徽标丢失、标题重复——全部是
//! 「分散可变状态 + 各处命令式补丁」的症状。
//!
//! 收拢后的规则：
//! - 所有托盘状态变更走 `TrayState` 的方法（单一写入口，整把锁）
//! - 菜单渲染 = `snapshot()` 纯函数：状态 → 菜单数据，无副作用
//! - 测速生命周期：`begin_test`（单飞）→ 后台测速 → `apply_test_result`
//!   或看门狗 `expire_testing`；generation 让迟到的旧结果失效

use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;

/// 测速显示看门狗：超过该时长强制恢复「延迟测速」可点态。
pub const TESTING_VISIBLE_SECS: u64 = 20;

/// 下钻解析最大深度（主组 → 子组 → 节点）。
const DRILL_DEPTH: usize = 3;

/// 托盘节点子菜单全部可变状态（单一锁）。
#[derive(Default)]
pub struct TrayState {
    /// 主选择组（配置声明顺序里第一个有成员的组，通常名为 节点选择）
    group: String,
    /// 主组当前选中（可能是子组，也可能是节点）
    now: String,
    /// 子菜单标题：`主组：当前选中`
    title: String,
    /// 展示的节点有序列表（下钻后的真实节点）
    nodes: Vec<String>,
    /// 延迟缓存（测速成功节点，毫秒）
    delays: BTreeMap<String, u64>,
    /// 最近一次测速失败节点（红色「失败」徽标）
    failed: BTreeSet<String>,
    testing: bool,
    testing_since: Option<Instant>,
    /// 测速代次：看门狗与完成回调竞争结束权时，迟到的旧结果以此失效
    generation: u64,
}

/// 托盘节点子菜单的节点行数据。
#[derive(Clone)]
pub struct TrayNodeRow {
    /// 节点名
    pub name: String,
    /// 延迟徽标文本：`448 ms` / `失败` / `—`
    pub badge: String,
    /// 延迟毫秒数（失败或未测为 None）
    pub ms: Option<u64>,
    /// 是否当前选中（菜单勾选态）
    pub selected: bool,
}

/// 渲染托盘节点子菜单所需的纯数据快照。
pub struct TrayMenuData {
    pub title: String,
    pub rows: Vec<TrayNodeRow>,
    pub testing: bool,
}

impl TrayState {
    /// 主组已确定。
    pub fn has_group(&self) -> bool {
        !self.group.is_empty()
    }

    /// 主组名（探测写入后）。
    pub fn group(&self) -> &str {
        &self.group
    }

    /// 展示节点名的有序克隆（测速结果落库时圈定成员）。
    pub fn node_names(&self) -> Vec<String> {
        self.nodes.clone()
    }

    /// 清空失败标记（测速出错时调用，下次重测）。
    pub fn clear_failed(&mut self) {
        self.failed.clear();
    }

    /// 探测并写入主组：由 lib.rs 注入探测闭包（按配置顺序找第一个有成员的组）。
    /// 返回 true 表示新探测到了主组。
    pub fn init_group(&mut self, probe: &dyn Fn() -> Option<String>) -> bool {
        if !self.group.is_empty() {
            return false;
        }
        let Some(g) = probe() else { return false };
        self.group = g;
        true
    }

    /// 写入主组数据并下钻解析（主组当前选中可能本身是子组）。
    /// `lookup`：按名字查子组（返回 None = 是节点不是组）。
    /// 同时清理延迟/失败缓存中已不在列表里的节点。
    pub fn apply_group_data<F>(&mut self, now: Option<String>, members: Vec<(String, Option<u64>)>, lookup: &F)
    where
        F: Fn(&str) -> Option<(Option<String>, Vec<(String, Option<u64>)>)>,
    {
        let known: BTreeSet<&String> = members.iter().map(|(n, _)| n).collect();
        self.delays.retain(|n, _| known.contains(n));
        self.failed.retain(|n| known.contains(n));
        for (n, d) in &members {
            if let Some(ms) = d {
                self.delays.entry(n.clone()).or_insert(*ms);
            }
        }
        self.failed.retain(|n| !self.delays.contains_key(n));

        // 下钻：主组当前选中若是子组则深入其成员列表（最多 DRILL_DEPTH 层）
        let mut effective = self.group.clone();
        let mut sel = now.clone().unwrap_or_default();
        self.nodes = members.iter().map(|(n, _)| n.clone()).collect();
        for _ in 0..DRILL_DEPTH {
            if sel.is_empty() {
                break;
            }
            let Some((sub_now, sub_members)) = lookup(&sel) else {
                break;
            };
            if sub_members.is_empty() {
                break;
            }
            effective = sel;
            sel = sub_now.unwrap_or_default();
            self.nodes = sub_members.iter().map(|(n, _)| n.clone()).collect();
        }
        self.title = format!("{}：{}", effective, sel);
    }

    /// 单飞进入测速态。返回 false = 已有测速在跑。
    pub fn begin_test(&mut self) -> bool {
        if self.testing {
            return false;
        }
        self.testing = true;
        self.testing_since = Some(Instant::now());
        self.generation += 1;
        true
    }

    /// 结束测速态（看门狗或正常完成都调用）。
    pub fn end_test(&mut self) {
        self.testing = false;
        self.testing_since = None;
    }

    /// 当前代次（迟到的旧结果以此判断是否仍然有效）。
    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// 测速结果落库：成功者写延迟；未返回者标记失败；同步当前选中。
    pub fn apply_test_result(
        &mut self,
        delays: BTreeMap<String, u64>,
        members: &[String],
        now: Option<String>,
    ) {
        self.delays = delays;
        self.failed.clear();
        for m in members {
            if !self.delays.contains_key(m) {
                self.failed.insert(m.clone());
            }
        }
        if let Some(n) = now {
            self.now = n;
        }
    }

    /// 测速是否仍应对外显示为「进行中」（看门狗：超时自动恢复）。
    pub fn testing_visible(&self) -> bool {
        self.testing
            && self
                .testing_since
                .map(|t| t.elapsed().as_secs() < TESTING_VISIBLE_SECS)
                .unwrap_or(false)
    }

    /// 渲染快照：状态 → 菜单数据（纯函数，无副作用）。
    /// `node_label`：子菜单默认前缀（i18n 的「节点选择」）。
    pub fn snapshot(&self, node_label: &str) -> TrayMenuData {
        let title = if self.title.is_empty() {
            format!("{}：{}", node_label, self.now)
        } else {
            self.title.clone()
        };
        let rows = self
            .nodes
            .iter()
            .map(|n| {
                let failed = self.failed.contains(n);
                let (badge, ms) = if failed {
                    ("失败".to_string(), None)
                } else {
                    match self.delays.get(n) {
                        Some(ms) => (format!("{ms}ms"), Some(*ms)),
                        None => ("—".to_string(), None),
                    }
                };
                TrayNodeRow {
                    name: n.clone(),
                    badge,
                    ms,
                    selected: *n == self.now,
                }
            })
            .collect();
        TrayMenuData {
            title,
            rows,
            testing: self.testing_visible(),
        }
    }
}
