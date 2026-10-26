//! 内核 WS 数据桥：traffic / connections / logs 三路订阅。
//!
//! 设计要点（DESIGN §5.2）：连接与日志由前端按页面挂载/卸载触发订阅/退订，
//! Rust 侧持有唯一 WS 读线程并做节流聚合后 emit 事件——避免大快照刷爆
//! webview。读线程阻塞式 read（内核每秒必推数据），退订后最迟约 1 秒退出；
//! 连接断开（内核重启中）自动重连。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tungstenite::Message;

pub const EV_TRAFFIC: &str = "traffic://data";
pub const EV_CONNECTIONS: &str = "connections://data";
pub const EV_LOGS: &str = "logs://data";
pub const EV_LOG_STATUS: &str = "logs://status";

/// connections 快照推送间隔下限（mihomo 原生 1Hz）。
const CONN_MIN_INTERVAL: Duration = Duration::from_millis(1000);
/// 单次快照推送的最大行数：系统代理全开时连接可达数千上万，
/// 超限部分截断（前端按 totals 展示全量），避免巨型 IPC 载荷。
const CONN_MAX_ROWS: usize = 1000;
/// 日志批量 flush：间隔或条数任一达到即发。
const LOG_FLUSH_INTERVAL: Duration = Duration::from_millis(300);
const LOG_FLUSH_COUNT: usize = 20;

#[derive(Default)]
pub struct WsHub {
    /// channel 名 → (活跃标志, 最近一条消息时刻)。false = 已请求退订，读线程自行退出。
    /// 重订同Channel时旧标志被置 false（读线程最迟约 2 秒退出），新读线程顶替——
    /// 「订阅还在但已死/连着旧端口」的冻结形态由此自愈。
    active: Mutex<HashMap<&'static str, (Arc<AtomicBool>, Arc<Mutex<Instant>>)>>,
    /// 页面订阅意图集：挂载即登记、卸载即移除，与订阅是否成功无关。
    /// 内核重启后据此重订——覆盖「页面在内核 Starting 期间挂载、订阅
    /// 命令失败」的窗口，保证 Running 后自动补上。
    wanted: Mutex<std::collections::HashSet<&'static str>>,
}

impl WsHub {
    fn subscribe<F>(&self, name: &'static str, spawn_reader: F) -> Result<(), String>
    where
        F: FnOnce(Arc<AtomicBool>, Arc<Mutex<Instant>>) + Send + 'static,
    {
        let mut map = self.active.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((flag, _)) = map.get(name) {
            if flag.load(Ordering::SeqCst) {
                // 旧读线程仍在：请它退场（重订永远以最新 URL/回调为准）
                flag.store(false, Ordering::SeqCst);
            }
        }
        let flag = Arc::new(AtomicBool::new(true));
        let last_seen = Arc::new(Mutex::new(Instant::now()));
        map.insert(name, (flag.clone(), last_seen.clone()));
        drop(map);
        spawn_reader(flag, last_seen);
        Ok(())
    }

    /// 页面订阅意图登记：必须在订阅命令的最入口调用（require_controller
    /// 之前）——内核 Starting 期间挂载的页面订阅命令会失败，意图集是
    /// Running 后补订的唯一依据。
    pub fn want_channel(&self, name: &'static str) {
        self.wanted
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(name);
    }

    /// 是否还有页面通道需要数据（有则内核 Running 后应重订）。
    pub fn any_page_channel_wanted(&self) -> bool {
        !self
            .wanted
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_empty()
    }

    /// 页面 1Hz 通道（traffic/connections）是否有「订阅在但消息停更」的
    /// 冻结——内核重启换 port/secret 后，旧读线程会在死端口上无限重连，
    /// 心跳停更即暴露。以 wanted 意图集为准（退订后 active 表项仍在，
    /// 不看意图会给没人要的通道反复重订）；logs 事件驱动、静默属正常，
    /// 不参与判定；心跳缺位（None）不判冻结：兼容 Starting 窗口的未订上状态。
    pub fn any_page_channel_stale(&self, threshold: Duration) -> bool {
        let wanted = self.wanted.lock().unwrap_or_else(|e| e.into_inner());
        ["traffic", "connections"].into_iter().any(|name| {
            wanted.contains(name)
                && self
                    .last_message_ago(name)
                    .is_some_and(|ago| ago >= threshold)
        })
    }

    /// 指定 channel 距最近一条消息的时长；从未订阅返回 None。
    pub fn last_message_ago(&self, name: &str) -> Option<Duration> {
        self.active
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(name)
            .map(|(_, t)| {
                t.lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .elapsed()
            })
    }

    pub fn unsubscribe(&self, name: &str) {
        self.wanted
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(name);
        if let Some((flag, _)) = self
            .active
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(name)
        {
            flag.store(false, Ordering::SeqCst);
        }
    }

    pub fn unsubscribe_all(&self) {
        for (flag, _) in self.active.lock().unwrap_or_else(|e| e.into_inner()).values() {
            flag.store(false, Ordering::SeqCst);
        }
    }

    /// 托盘实时速率专用订阅：独立 channel（与前端 traffic 互不干扰），
    /// 每次 tick 回调 (up, down) 字节/秒。菜单栏常驻，不受页面挂载影响。
    /// 带心跳追踪，供看门狗发现「订阅在但不再更新」的冻结并强制重订。
    pub fn subscribe_traffic_tray(
        &self,
        port: u16,
        secret: &str,
        on_tick: impl Fn(u64, u64) + Send + 'static,
    ) -> Result<(), String> {
        let url = ws_url(port, secret, "/traffic");
        self.subscribe("traffic-tray", move |flag, last_seen| {
            std::thread::spawn(move || {
                read_loop(
                    &url,
                    flag,
                    Some(Duration::from_secs(5)),
                    Some(last_seen),
                    None,
                    |msg| {
                        if let Some(Message::Text(txt)) = msg {
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
                                let up = v.get("up").and_then(|x| x.as_u64()).unwrap_or(0);
                                let down = v.get("down").and_then(|x| x.as_u64()).unwrap_or(0);
                                on_tick(up, down);
                            }
                        }
                    },
                );
            });
        })
    }

    pub fn unsubscribe_tray_traffic(&self) {
        self.unsubscribe("traffic-tray");
    }

    pub fn subscribe_traffic(
        &self,
        port: u16,
        secret: &str,
        emit: impl Fn(&'static str, serde_json::Value) + Send + 'static,
    ) -> Result<(), String> {
        let url = ws_url(port, secret, "/traffic");
        self.subscribe("traffic", move |flag, last_seen| {
            std::thread::spawn(move || {
                read_loop(
                    &url,
                    flag,
                    Some(Duration::from_secs(5)),
                    Some(last_seen),
                    None,
                    |msg| {
                        if let Some(Message::Text(txt)) = msg {
                            // mihomo 原始 {"up":..,"down":..} → 结构化转发
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
                                emit(EV_TRAFFIC, v);
                            }
                        }
                    }
                });
            });
        })
    }

    pub fn subscribe_connections(
        &self,
        port: u16,
        secret: &str,
        emit: impl Fn(&'static str, serde_json::Value) + Send + 'static,
    ) -> Result<(), String> {
        let url = ws_url(port, secret, "/connections");
        self.subscribe("connections", move |flag, last_seen| {
            std::thread::spawn(move || {
                let mut last_emit = Instant::now() - CONN_MIN_INTERVAL;
                read_loop(
                    &url,
                    flag,
                    Some(Duration::from_secs(5)),
                    Some(last_seen),
                    None,
                    |msg| {
                        if let Some(Message::Text(txt)) = msg {
                            if last_emit.elapsed() < CONN_MIN_INTERVAL {
                                return; // 节流
                            }
                            if let Some(payload) = compact_connections(&txt) {
                                last_emit = Instant::now();
                                emit(EV_CONNECTIONS, payload);
                            }
                        }
                        if let Some(payload) = compact_connections(&txt) {
                            last_emit = Instant::now();
                            emit(EV_CONNECTIONS, payload);
                        }
                    }
                });
            });
        })
    }

    pub fn subscribe_logs(
        &self,
        port: u16,
        secret: &str,
        emit: impl Fn(&'static str, serde_json::Value) + Send + 'static,
    ) -> Result<(), String> {
        let url = ws_url(port, secret, "/logs?level=info");
        self.subscribe("logs", move |flag, _last_seen| {
            std::thread::spawn(move || {
                let mut batch: Vec<serde_json::Value> = Vec::new();
                let mut last_flush = Instant::now();
                let mut on_status = |connected| {
                    emit(EV_LOG_STATUS, serde_json::json!({ "connected": connected }));
                };
                read_loop(&url, flag, None, None, Some(&mut on_status), |msg| {
                    if let Some(Message::Text(txt)) = msg {
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
                            batch.push(v);
                        }
                    }
                    // Flush even when the core sends just one line, then goes
                    // quiet. Previously the next message was required to flush.
                    if !batch.is_empty()
                        && (last_flush.elapsed() >= LOG_FLUSH_INTERVAL
                            || batch.len() >= LOG_FLUSH_COUNT)
                    {
                        emit(
                            EV_LOGS,
                            serde_json::Value::Array(std::mem::take(&mut batch)),
                        );
                        last_flush = Instant::now();
                    }
                });
                if !batch.is_empty() {
                    emit(EV_LOGS, serde_json::Value::Array(batch));
                }
            });
        })
    }

    /// 日志落盘专用订阅（#29）：独立常驻通道，不随日志页挂载/卸载——
    /// 只要内核在跑就持续把 info 级日志交给落盘端（level/type/payload）。
    /// sink 持有 DailyWriter，内部自缓冲。
    pub fn subscribe_logs_file(
        &self,
        port: u16,
        secret: &str,
        mut sink: impl FnMut(&str, &str) + Send + 'static,
    ) -> Result<(), String> {
        let url = ws_url(port, secret, "/logs?level=info");
        self.subscribe("logs-file", move |flag, _last_seen| {
            std::thread::spawn(move || {
                read_loop(&url, flag, None, None, None, |msg| {
                    if let Some(Message::Text(txt)) = msg {
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
                            let level = v.get("type").and_then(|x| x.as_str()).unwrap_or("info");
                            let payload =
                                v.get("payload").and_then(|x| x.as_str()).unwrap_or("");
                            if !payload.is_empty() {
                                sink(level, payload);
                            }
                        }
                    }
                });
            });
        })
    }
}

fn ws_url(port: u16, secret: &str, path: &str) -> String {
    // path 可能自带查询串（如 /logs?level=info）——token 必须用 & 续接，
    // 否则 token 被吞进上一个参数值，内核 401，日志通道无限重连。
    let sep = if path.contains('?') { "&" } else { "?" };
    format!("ws://127.0.0.1:{port}{path}{sep}token={secret}")
}

/// 阻塞式 WS 读循环：断线自动重连，退订后于下一条消息前退出。
/// WS 读循环（自动重连）。
///
/// `stale`：静默判定窗口。给到值时给底层 TCP 设读超时，超过 `stale`
/// 未收到任何帧即断开重连——修复 TCP 半开（睡眠唤醒/网络切换/内核假死）
/// 导致 read 永久阻塞、托盘速率冻结在旧值的问题。None = 保持旧行为
/// （适合长期无推送也属正常的通道，如日志）。
///
/// `last_seen`：每收到一条文本帧即刷新，供上层看门狗判断通道活性
/// （读线程意外死亡时心跳停走，看门狗据此强制重订）。
fn read_loop(
    url: &str,
    flag: Arc<AtomicBool>,
    stale: Option<Duration>,
    last_seen: Option<Arc<Mutex<Instant>>>,
    mut on_status: Option<&mut dyn FnMut(bool)>,
    mut on_text: impl FnMut(Option<Message>),
) {
    const READ_TIMEOUT: Duration = Duration::from_secs(2);
    'outer: while flag.load(Ordering::SeqCst) {
        let mut ws = match tungstenite::connect(url) {
            Ok((ws, _)) => ws,
            Err(_) => {
                if flag.load(Ordering::SeqCst) {
                    if let Some(status) = on_status.as_mut() {
                        status(false);
                    }
                }
                std::thread::sleep(Duration::from_secs(1));
                continue;
            }
        };
        if !flag.load(Ordering::SeqCst) {
            break;
        }
        if let Some(status) = on_status.as_mut() {
            status(true);
        }
        if let tungstenite::stream::MaybeTlsStream::Plain(tcp) = ws.get_ref() {
            let timeout = if stale.is_some() {
                READ_TIMEOUT
            } else {
                LOG_FLUSH_INTERVAL
            };
            let _ = tcp.set_read_timeout(Some(timeout));
        }
        let mut last_msg = Instant::now();
        loop {
            if !flag.load(Ordering::SeqCst) {
                break 'outer;
            }
            match ws.read() {
                Ok(Message::Ping(_) | Message::Pong(_)) => {}
                Ok(msg @ Message::Text(_)) => {
                    last_msg = Instant::now();
                    if let Some(t) = &last_seen {
                        *t.lock().unwrap_or_else(|e| e.into_inner()) = Instant::now();
                    }
                    on_text(Some(msg));
                }
                Ok(Message::Close(_)) => break, // 内核重启中，走重连
                Ok(_) => {}
                Err(tungstenite::Error::Io(e))
                    if matches!(
                            e.kind(),
                            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                        ) =>
                {
                    // 读超时≠断线：仅在静默超过 stale 窗口时才判定半开重连
                    on_text(None);
                    if stale.is_some_and(|limit| last_msg.elapsed() > limit) {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        if flag.load(Ordering::SeqCst) {
            if let Some(status) = on_status.as_mut() {
                status(false);
            }
        }
        drop(ws);
        std::thread::sleep(Duration::from_millis(500));
    }
}

#[derive(Serialize)]
struct ConnRow {
    id: String,
    host: String,
    rule: String,
    chains: String,
    up: u64,
    down: u64,
    network: String,
    kind: String,
    process: String,
    elapsed_ms: u64,
}

#[derive(Serialize)]
struct ConnPayload {
    rows: Vec<ConnRow>,
    upload_total: u64,
    download_total: u64,
    memory: u64,
    /// 超过 CONN_MAX_ROWS 被截断时的原始总行数。
    #[serde(skip_serializing_if = "Option::is_none")]
    truncated: Option<usize>,
}

/// mihomo connections 快照 → 紧凑结构（字段裁剪让大快照的 IPC 载荷可控）。
fn compact_connections(raw: &str) -> Option<serde_json::Value> {
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    let now_ms = now_unix_ms();
    let mut rows = Vec::new();
    if let Some(conns) = v.get("connections").and_then(|c| c.as_array()) {
        for c in conns {
            let md = c.get("metadata").cloned().unwrap_or_default();
            let str_at = |k: &str| md.get(k).and_then(|x| x.as_str()).unwrap_or("");
            let host = {
                let h = str_at("host");
                let port = str_at("destinationPort");
                if h.is_empty() {
                    format!("{}:{port}", str_at("destinationIP"))
                } else {
                    format!("{h}:{port}")
                }
            };
            rows.push(ConnRow {
                id: c
                    .get("id")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string(),
                host,
                rule: format!(
                    "{}{}",
                    c.get("rule").and_then(|x| x.as_str()).unwrap_or(""),
                    c.get("rulePayload")
                        .and_then(|x| x.as_str())
                        .map(|p| format!(" {p}"))
                        .unwrap_or_default()
                ),
                chains: c
                    .get("chains")
                    .and_then(|x| x.as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|s| s.as_str())
                            .collect::<Vec<_>>()
                            .join(" → ")
                    })
                    .unwrap_or_default(),
                up: c.get("upload").and_then(|x| x.as_u64()).unwrap_or(0),
                down: c.get("download").and_then(|x| x.as_u64()).unwrap_or(0),
                network: str_at("network").to_string(),
                kind: str_at("type").to_string(),
                process: str_at("processPath")
                    .rsplit('/')
                    .next()
                    .unwrap_or("")
                    .to_string(),
                elapsed_ms: now_ms.saturating_sub(
                    c.get("start")
                        .and_then(|x| x.as_str())
                        .and_then(parse_rfc3339_ms)
                        .unwrap_or(0),
                ),
            });
        }
    }
    let total_rows = rows.len();
    rows.truncate(CONN_MAX_ROWS);
    let payload = ConnPayload {
        upload_total: v.get("uploadTotal").and_then(|x| x.as_u64()).unwrap_or(0),
        download_total: v.get("downloadTotal").and_then(|x| x.as_u64()).unwrap_or(0),
        memory: v.get("memory").and_then(|x| x.as_u64()).unwrap_or(0),
        truncated: if total_rows > CONN_MAX_ROWS {
            Some(total_rows)
        } else {
            None
        },
        rows,
    };
    serde_json::to_value(&payload).ok()
}

fn now_unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 解析 mihomo 的 RFC3339 时间戳为 Unix 毫秒（忽略小数秒与时区偏移外的精度）。
fn parse_rfc3339_ms(s: &str) -> Option<u64> {
    // 2026-10-04T12:00:00.123456+08:00 / …Z
    let (sec_part, _frac) = s.split_once('.').unwrap_or((s, ""));
    let sec_part = sec_part.trim_end_matches('Z');
    let (dt, offset_min) = match sec_part.rsplit_once(['+', '-']) {
        Some((dt, off)) if off.len() == 5 => {
            let sign = if sec_part.contains('+') { 1 } else { -1 };
            let h: i64 = off[..2].parse().ok()?;
            let m: i64 = off[3..].parse().ok()?;
            (dt.to_string(), sign * (h * 60 + m))
        }
        _ => (sec_part.to_string(), 0),
    };
    let mut it = dt.split(&['T', ' '][..]);
    let date = it.next()?.split('-').collect::<Vec<_>>();
    let time = it.next()?.split(':').collect::<Vec<_>>();
    if date.len() != 3 || time.len() != 3 {
        return None;
    }
    let y: i64 = date[0].parse().ok()?;
    let mo: i64 = date[1].parse().ok()?;
    let d: i64 = date[2].parse().ok()?;
    let h: i64 = time[0].parse().ok()?;
    let mi: i64 = time[1].parse().ok()?;
    let sec: i64 = time[2].parse().ok()?;
    // days from civil（Howard Hinnant 算法）
    let y = if mo <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (mo + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    let secs = days * 86400 + h * 3600 + mi * 60 + sec - offset_min * 60;
    Some((secs.max(0)) as u64 * 1000)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[test]
    fn single_log_is_flushed_while_stream_is_quiet_and_unsubscribes() {
        use std::net::TcpListener;
        use std::sync::mpsc;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(4)))
                .unwrap();
            let mut socket = tungstenite::accept(stream).unwrap();
            socket
                .send(Message::Text(
                    r#"{"type":"info","payload":"single log"}"#.into(),
                ))
                .unwrap();
            // No second frame: delivery must be driven by the idle timeout.
            let _ = socket.read();
        });
        let hub = WsHub::default();
        let (send, receive) = mpsc::channel();
        hub.subscribe_logs(port, "test-secret", move |event, payload| {
            let _ = send.send((event, payload));
        })
        .unwrap();
        let connected = receive.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(connected.0, EV_LOG_STATUS);
        assert_eq!(connected.1["connected"], true);
        let log = receive.recv_timeout(Duration::from_secs(2));
        hub.unsubscribe("logs");
        server.join().unwrap();
        let (event, payload) = log.expect("a single log must not wait for the next message");
        assert_eq!(event, EV_LOGS);
        assert_eq!(payload[0]["payload"], "single log");
    }

    #[test]
    fn ws_url_includes_token() {
        assert_eq!(
            ws_url(19090, "abc", "/traffic"),
            "ws://127.0.0.1:19090/traffic?token=abc"
        );
        // 自带查询串的 path 用 & 续接 token（日志通道 401 死循环回归测试）
        assert_eq!(
            ws_url(19090, "abc", "/logs?level=info"),
            "ws://127.0.0.1:19090/logs?level=info&token=abc"
        );
    }

    #[test]
    fn compact_connections_trims_and_maps() {
        let raw = r#"{
          "downloadTotal": 100, "uploadTotal": 7, "memory": 2048,
          "connections": [{
            "id": "c1", "upload": 1, "download": 2,
            "start": "2026-10-04T12:00:00.123456+08:00",
            "chains": ["香港自动", "HK-01"], "rule": "DomainSuffix", "rulePayload": "example.com",
            "metadata": { "network": "tcp", "type": "HTTPS", "host": "example.com",
                          "destinationPort": "443", "processPath": "/Applications/Curl.app/x/curl" }
          }]
        }"#;
        let v: serde_json::Value = compact_connections(raw).unwrap();
        let row = &v["rows"][0];
        assert_eq!(row["host"], "example.com:443");
        assert_eq!(row["rule"], "DomainSuffix example.com");
        assert_eq!(row["chains"], "香港自动 → HK-01");
        assert_eq!(row["process"], "curl");
        assert_eq!(row["up"], 1);
        assert_eq!(v["upload_total"], 7);
        assert_eq!(v["memory"], 2048);
    }

    #[test]
    fn compact_connections_handles_empty() {
        let v: serde_json::Value =
            compact_connections(r#"{"downloadTotal":0,"uploadTotal":0,"connections":null}"#)
                .unwrap();
        assert_eq!(v["rows"].as_array().unwrap().len(), 0);
    }

    /// 页面通道心跳与冻结判定：订阅即有心跳；阈值内不算冻结、归零即冻结；
    /// logs 不参与判定（事件驱动，静默属正常）；退订（wanted 移除）后
    /// 不再参与判定。#111
    #[test]
    fn page_channel_heartbeat_and_staleness() {
        let hub = WsHub::default();
        // 心跳缺位（未订阅）不判冻结
        assert!(!hub.any_page_channel_stale(Duration::from_secs(15)));
        // 生产入口（lib.rs 订阅命令）先登记意图，再走桥订阅；连不上的
        // 死端口也要注册心跳（active 表项同步插入）
        hub.want_channel("traffic");
        hub.subscribe_traffic(1, "s", |_, _| {}).unwrap();
        assert!(hub.last_message_ago("traffic").is_some());
        assert!(!hub.any_page_channel_stale(Duration::from_secs(15)));
        assert!(hub.any_page_channel_stale(Duration::from_secs(0)));
        // logs 不参与 1Hz 冻结判定：仅 traffic 冻结仍判冻结
        hub.subscribe_logs(1, "s", |_, _| {}).unwrap();
        assert!(hub.any_page_channel_stale(Duration::from_secs(0)));
        // traffic 退订（wanted 移除）后只剩不参与判定的 logs：不判冻结
        hub.unsubscribe("traffic");
        assert!(!hub.any_page_channel_stale(Duration::from_secs(0)));
    }

    /// 已知锚点：2024-01-01T00:00:00Z = 1704067200。
    #[test]
    fn rfc3339_known_epoch() {
        assert_eq!(
            parse_rfc3339_ms("2024-01-01T00:00:00.000000+00:00"),
            Some(1_704_067_200_000)
        );
        assert_eq!(
            parse_rfc3339_ms("2024-01-01T08:00:00+08:00"),
            Some(1_704_067_200_000)
        );
    }

    #[test]
    fn rfc3339_one_second_apart_differs_by_1000ms() {
        let a = parse_rfc3339_ms("2026-10-04T04:00:00.000000+00:00").unwrap();
        let b = parse_rfc3339_ms("2026-10-04T04:00:01.000000+00:00").unwrap();
        assert_eq!(b - a, 1000);
    }

    /// 真实内核 WS 冒烟：traffic 桥 5 秒内应收到数据。
    #[test]
    fn real_core_traffic_ws_roundtrip() {
        let _serial = crate::core_manager::tests::REAL_CORE_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let Ok(bin) = std::env::var("CROSSBOW_CORE_BIN") else {
            eprintln!("skip: CROSSBOW_CORE_BIN not set");
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let mgr = crate::core_manager::CoreManager::new(
            std::path::PathBuf::from(bin),
            dir.path().to_path_buf(),
        );
        // 关掉 geo 下载：全新临时目录会先拉 8MB geoip.metadb，慢网下拖垮就绪窗口
        mgr.set_options(crate::core_manager::CoreOptions {
            ensure_geo_files: false,
            ..crate::core_manager::CoreOptions::default()
        });
        mgr.start(
            "proxies: []\nrules:\n  - MATCH,DIRECT\n",
            &crossbow_core::RuntimeConfig {
                mixed_port: crate::core_manager::tests::tests_free_port(),
                ..crossbow_core::RuntimeConfig::default()
            },
        )
        .unwrap();
        let mut running = false;
        for _ in 0..100 {
            if mgr.status() == crate::core_manager::CoreStatus::Running {
                running = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        assert!(running);

        let (port, secret) = mgr.controller().unwrap();
        let (tx, rx) = std::sync::mpsc::channel::<serde_json::Value>();
        let hub = WsHub::default();
        hub.subscribe_traffic(port, &secret, move |_, payload| {
            let _ = tx.send(payload);
        })
        .unwrap();

        let got = rx.recv_timeout(Duration::from_secs(8));
        assert!(got.is_ok(), "no traffic event within 8s");
        let v = got.unwrap();
        assert!(v.get("up").is_some() && v.get("down").is_some());

        hub.unsubscribe_all();
        mgr.stop();
    }
}
