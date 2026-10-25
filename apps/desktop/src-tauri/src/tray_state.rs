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
pub const TESTING_VISIBLE_SECS: u64 = 120;

/// 托盘节点子菜单全部可变状态（单一锁）。
#[derive(Default)]
pub struct TrayState {
    /// 主选择组（配置声明顺序里第一个有成员的组，通常名为 节点选择）
    group: String,
    /// 主组当前选中（URLTest 自动组或手动节点）
    now: String,
    /// 主选择组中负责自动测速切换的 URLTest 子组。
    automatic_group: Option<String>,
    /// 自动组当前实际使用的节点。
    automatic_now: Option<String>,
    /// 主选择组中的可选项（自动组和手动节点）。
    nodes: Vec<String>,
    /// 延迟缓存（测速成功节点，毫秒）
    delays: BTreeMap<String, u64>,
    /// 最近一次测速失败节点（红色「失败」徽标）
    /// 测速失败原因（"timeout" | "failed"）；成功节点从 map 移除。
    failed: BTreeMap<String, String>,
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
    /// 菜单中显示的主标签。
    pub label: String,
    /// 自动选择当前实际使用的节点（仅自动组行）。
    pub current_node: Option<String>,
    /// 当前节点说明的本地化前缀。
    pub current_label: String,
    /// 延迟徽标文本：`448 ms` / `失败` / `—`
    pub badge: String,
    /// 延迟毫秒数（失败或未测为 None）
    pub ms: Option<u64>,
    /// 是否当前选中（菜单勾选态）
    pub selected: bool,
}

/// 渲染托盘节点子菜单所需的纯数据快照。
pub struct TrayMenuData {
    /// 一级菜单标题，显示选择模式/当前手动节点。
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

    /// 更新主选择组、自动测速组和展示节点。
    pub fn apply_group_data(
        &mut self,
        now: Option<String>,
        members: Vec<(String, Option<u64>)>,
        automatic: Option<(String, Option<String>, Vec<(String, Option<u64>)>)>,
    ) {
        let known: BTreeSet<&String> = members.iter().map(|(n, _)| n).collect();
        self.delays.retain(|n, _| known.contains(n));
        self.failed.retain(|n, _| known.contains(n));
        for (n, d) in &members {
            // A failed explicit test takes precedence over older controller
            // history until the next successful test updates this node.
            if self.failed.contains_key(n) {
                continue;
            }
            if let Some(ms) = d.filter(|ms| *ms > 0) {
                self.delays.entry(n.clone()).or_insert(ms);
            }
        }
        self.failed.retain(|n, _| !self.delays.contains_key(n));

        self.nodes = members.iter().map(|(n, _)| n.clone()).collect();
        self.now = now.unwrap_or_default();
        self.automatic_group = automatic.as_ref().map(|(name, _, _)| name.clone());
        self.automatic_now = automatic.as_ref().and_then(|(_, now, _)| now.clone());
        if let Some((_, _, automatic_members)) = automatic {
            for (name, delay) in automatic_members {
                if self.failed.contains_key(&name) {
                    continue;
                }
                if let Some(delay) = delay.filter(|ms| *ms > 0) {
                    self.delays.entry(name).or_insert(delay);
                }
            }
        }
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

    /// 单节点测速结果落库（增量）：成功写延迟并清失败标记；
    /// 失败记原因（"timeout" | "failed"），徽标直接展示该原因。
    pub fn apply_single_result(&mut self, node: &str, result: Result<u64, String>) {
        match result {
            Ok(ms) if ms > 0 => {
                self.delays.insert(node.to_string(), ms);
                self.failed.remove(node);
            }
            Ok(_) => {
                self.failed.insert(node.to_string(), "failed".into());
            }
            Err(reason) => {
                self.delays.remove(node);
                self.failed.insert(node.to_string(), reason);
            }
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
    pub fn snapshot(&self, node_label: &str, current_label: &str) -> TrayMenuData {
        let selected_label = if self.automatic_group.as_deref() == Some(self.now.as_str()) {
            strip_recycle_icon(&self.now)
        } else {
            self.now.clone()
        };
        let title = if selected_label.is_empty() {
            node_label.to_string()
        } else {
            format!("{}：{}", node_label, selected_label)
        };
        let mut names = Vec::with_capacity(self.nodes.len());
        if let Some(automatic_group) = &self.automatic_group {
            names.push(automatic_group.clone());
        }
        names.extend(
            self.nodes
                .iter()
                .filter(|name| self.automatic_group.as_deref() != Some(name.as_str()))
                .cloned(),
        );
        let rows = names
            .iter()
            .map(|n| {
                let automatic = self.automatic_group.as_deref() == Some(n.as_str());
                let current_node = if automatic {
                    self.automatic_now.clone()
                } else {
                    None
                };
                let fail_reason = self
                    .failed
                    .get(n)
                    .cloned()
                    .or_else(|| {
                        current_node
                            .as_ref()
                            .and_then(|current| self.failed.get(current))
                            .cloned()
                    });
                let display_delay = if fail_reason.is_some() {
                    None
                } else {
                    current_node
                        .as_ref()
                        .and_then(|current| self.delays.get(current))
                        .or_else(|| self.delays.get(n))
                };
                let (badge, ms) = if display_delay.is_none() {
                    // 失败徽标直接展示原因（timeout / failed），无记录视为未测
                    (
                        fail_reason.unwrap_or_else(|| "—".into()),
                        None,
                    )
                } else {
                    match display_delay {
                        Some(ms) => (format!("{ms}ms"), Some(*ms)),
                        None => ("—".to_string(), None),
                    }
                };
                TrayNodeRow {
                    name: n.clone(),
                    label: if automatic {
                        strip_recycle_icon(n)
                    } else {
                        n.clone()
                    },
                    current_node,
                    current_label: current_label.to_string(),
                    badge,
                    ms,
                    selected: *n == self.now,
                }
            })
            .collect::<Vec<_>>();
        let mut automatic_rows = Vec::new();
        let mut location_groups: Vec<(String, Vec<TrayNodeRow>)> = Vec::new();
        for (index, row) in rows.into_iter().enumerate() {
            if row.current_node.is_some() {
                automatic_rows.push(row);
                continue;
            }
            let key =
                location_group_key(&row.name).unwrap_or_else(|| format!("unclassified:{index}"));
            if let Some((_, group)) = location_groups
                .iter_mut()
                .find(|(group_key, _)| *group_key == key)
            {
                group.push(row);
            } else {
                location_groups.push((key, vec![row]));
            }
        }
        let mut ordered_rows = automatic_rows;
        ordered_rows.extend(location_groups.into_iter().flat_map(|(_, group)| group));
        TrayMenuData {
            title,
            rows: ordered_rows,
            testing: self.testing_visible(),
        }
    }
}

/// Group nodes in first-seen location order. Prefer the explicit flag prefix;
/// fall back to common country/region codes for profiles without flags.
fn location_group_key(name: &str) -> Option<String> {
    let prefix = name.split('|').next().unwrap_or(name).trim();
    let flag: String = prefix
        .chars()
        .filter(|ch| (0x1F1E6..=0x1F1FF).contains(&(*ch as u32)))
        .collect();
    if !flag.is_empty() {
        return Some(format!("flag:{flag}"));
    }

    let lower = name.to_lowercase();
    let regions: &[(&str, &[&str])] = &[
        ("jp", &["-jp", "japan", "日本", "东京", "大阪"]),
        ("hk", &["-hk", "hkt", "hong kong", "香港"]),
        ("sg", &["-sg", "singapore", "新加坡"]),
        ("tw", &["-tw", "taiwan", "台湾"]),
        ("kr", &["-kr", "korea", "韩国", "首尔"]),
        (
            "us",
            &["-us", "usa", "united states", "美国", "洛杉矶", "纽约"],
        ),
        ("uk", &["-uk", "united kingdom", "英国", "伦敦"]),
        ("de", &["-de", "germany", "德国", "法兰克福"]),
        ("fr", &["-fr", "france", "法国", "巴黎"]),
        ("ca", &["-ca", "canada", "加拿大"]),
        ("au", &["-au", "australia", "澳大利亚"]),
        ("nl", &["-nl", "netherlands", "荷兰"]),
        ("my", &["-my", "malaysia", "马来西亚"]),
        ("th", &["-th", "thailand", "泰国"]),
        ("in", &["-in", "india", "印度"]),
        ("tr", &["-tr", "turkey", "土耳其"]),
        ("ru", &["-ru", "russia", "俄罗斯"]),
    ];
    regions.iter().find_map(|(key, aliases)| {
        aliases
            .iter()
            .any(|alias| lower.contains(alias))
            .then(|| format!("region:{key}"))
    })
}

fn strip_recycle_icon(name: &str) -> String {
    name.trim_start_matches(|character| matches!(character, '♻' | '\u{FE0F}' | ' '))
        .to_string()
}
