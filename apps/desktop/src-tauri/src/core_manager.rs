//! 内核 sidecar 生命周期管理：启动、就绪探测、停止、崩溃自动重启。
//!
//! 刻意不依赖 Tauri，便于直接单元测试与集成测试（真实内核冒烟）。
//! 平台注意：Windows 下 spawn 需带 CREATE_NO_WINDOW，避免 GUI 进程闪控制台。

use std::collections::VecDeque;
use std::io::Write;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crossbow_core::{apply_runtime, RuntimeConfig};
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "state", content = "message")]
pub enum CoreStatus {
    Stopped,
    Starting,
    Running,
    Crashed(String),
}

/// 可调参数；测试用短超时。
#[derive(Debug, Clone)]
pub struct CoreOptions {
    /// 就绪探测超时（秒）；超时视为启动失败（不自动重启，直接上报）。
    /// 120s：首次启动 mihomo 要自行下载 GeoIP 数据库（数 MB），
    /// 我们的应用侧镜像下载失败时它是最慢的兜底路径。
    pub readiness_timeout_secs: u64,
    /// 崩溃重启的统计窗口（秒）。
    pub restart_window_secs: u64,
    /// 窗口内最大重启次数，超过后放弃并保持 Crashed。
    pub max_restarts: u32,
    /// 启动前确保 GeoIP/GeoSite 数据文件（真实环境 true；测试 false）。
    pub ensure_geo_files: bool,
}

impl Default for CoreOptions {
    fn default() -> Self {
        Self {
            readiness_timeout_secs: 120,
            restart_window_secs: 60,
            max_restarts: 3,
            ensure_geo_files: true,
        }
    }
}

pub type Callback = Arc<dyn Fn(&CoreStatus) + Send + Sync>;

struct Inner {
    child: Option<Child>,
    status: CoreStatus,
    /// 手动停止标记：watch 线程看到退出时不重启。
    stopping: bool,
    restarts: VecDeque<Instant>,
    /// (port, secret)
    controller: Option<(u16, String)>,
    /// 轻量交接中：内核不再归本进程所有（退出时不杀）。
    detached: bool,
    /// 收养的外部内核 pid（上一个 GUI 实例留下的）。
    external_pid: Option<u32>,
    /// 收养进程的可执行文件身份；对外部 PID 发信号/提权前必须校验。
    external_binary: Option<PathBuf>,
}

/// 线程间共享状态；CoreManager 可 Clone。
struct Shared {
    binary_path: PathBuf,
    /// 内核工作目录（mihomo `-d`），config.yaml 写在这里。
    work_dir: PathBuf,
    opts: Mutex<CoreOptions>,
    callback: Mutex<Option<Callback>>,
    inner: Mutex<Inner>,
    /// 本次启动链的最终配置内容；spawn（含崩溃重启）每次都据此重写
    /// config.yaml，避免换引擎后旧管理器复用新引擎的配置文件。
    config_cache: Mutex<Option<String>>,
}

impl Drop for Shared {
    fn drop(&mut self) {
        // 兜底防孤儿：最后一个管理器句柄丢弃（含 panic 路径）时收走内核进程。
        // 轻量交接中例外：内核已有意留给系统收养。
        {
            let mut inner = self.inner.lock().unwrap();
            inner.stopping = true;
            if inner.detached {
                return;
            }
        }
        self.kill_child();
    }
}

impl Shared {
    fn descriptor_path(work_dir: &Path) -> PathBuf {
        work_dir.join("core-descriptor.json")
    }

    /// 写轻量交接描述符（port/secret/pid），下次 GUI 启动据此收养。
    /// 调用方必须已释放 inner 锁（本函数不再加锁）。
    fn write_descriptor(&self, pid: u32, port: u16, secret: &str) {
        let j = serde_json::json!({
            "port": port,
            "secret": secret,
            "pid": pid,
            "binary_path": self.binary_path.display().to_string(),
        });
        let _ = std::fs::write(
            Self::descriptor_path(&self.work_dir),
            serde_json::to_vec(&j).unwrap_or_default(),
        );
    }

    fn notify(&self, status: CoreStatus) {
        self.inner.lock().unwrap().status = status.clone();
        if let Some(cb) = self.callback.lock().unwrap().clone() {
            cb(&status);
        }
    }

    fn spawn_child(&self) -> Result<(), String> {
        let config_path = self.work_dir.join("config.yaml");
        // 每次拉起（含崩溃自动重启）都重写配置：内容来自本次启动链的缓存，
        // 保证磁盘文件与当前管理的内核/引擎严格一致。
        {
            let cached = self.config_cache.lock().unwrap();
            let Some(content) = cached.as_ref() else {
                return Err("no config cached for this start chain".into());
            };
            std::fs::File::create(&config_path)
                .and_then(|mut f| f.write_all(content.as_bytes()))
                .map_err(|e| format!("write config: {e}"))?;
        }
        let mut cmd = Command::new(&self.binary_path);
        // 两内核 CLI 不同：mihomo `-d workdir -f config`；sing-box `run -D workdir -c config`
        if crate::core_download::is_core_bin(&self.binary_path, "sing-box") {
            cmd.arg("run")
                .arg("-D")
                .arg(&self.work_dir)
                .arg("-c")
                .arg(&config_path);
        } else {
            cmd.arg("-d")
                .arg(&self.work_dir)
                .arg("-f")
                .arg(&config_path);
        }
        // 内核输出落到文件：崩溃诊断（yaml 错误等）靠它，不再丢弃。
        let log_file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(self.work_dir.join("core-stdio.log"))
            .map_err(|e| format!("open core log: {e}"))?;
        let log_err = log_file
            .try_clone()
            .map_err(|e| format!("clone core log: {e}"))?;
        cmd.stdout(log_file).stderr(log_err);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let child = cmd.spawn().map_err(|e| format!("spawn core: {e}"))?;
        let pid = child.id();
        {
            let mut inner = self.inner.lock().unwrap();
            // 自有子进程接管：收养角色终结，外部 pid 监视线程据此静默退场
            inner.external_pid = None;
            inner.detached = false;
            inner.child = Some(child);
        }
        if let Some((port, secret)) = self.inner.lock().unwrap().controller.clone() {
            self.write_descriptor(pid, port, &secret);
        }
        append_decision(
            &self.work_dir,
            &format!(
                "spawned: pid={pid} bin={} cfg_head={:?}",
                self.binary_path.display(),
                std::fs::read_to_string(&config_path)
                    .map(|c| c.chars().take(40).collect::<String>())
                    .unwrap_or_default(),
            ),
        );
        Ok(())
    }

    fn kill_child(&self) -> bool {
        let (child, external) = {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            let child = inner.child.take();
            let external = inner
                .external_pid
                .take()
                .map(|pid| (pid, inner.external_binary.take()));
            (child, external)
        };

        let stopped = if let Some(mut child) = child {
            let _ = child.kill();
            // setuid 内核以 root 运行：普通用户 SIGKILL 报 EPERM，child.wait() 会
            // 永久阻塞。轮询确认退出；超时仍存活则管理员授权补杀（macOS），
            // 用户拒绝授权时放弃句柄（进程交给 launchd，绝不阻塞停止流程）。
            let pid = child.id();
            let mut gone = false;
            for _ in 0..40 {
                match child.try_wait() {
                    Ok(Some(_)) => {
                        gone = true;
                        break;
                    }
                    Ok(None) => std::thread::sleep(Duration::from_millis(50)),
                    Err(_) => break,
                }
            }
            if !gone {
                #[cfg(target_os = "macos")]
                if !ROOT_KILL_PROMPT_DISABLED.load(std::sync::atomic::Ordering::SeqCst) {
                    escalate_admin_kill(pid);
                }
                for _ in 0..40 {
                    match child.try_wait() {
                        Ok(Some(_)) => {
                            gone = true;
                            break;
                        }
                        Ok(None) => std::thread::sleep(Duration::from_millis(50)),
                        Err(_) => break,
                    }
                }
                if !gone {
                    eprintln!("core kill: pid {pid} survived SIGKILL (root?); giving up handle");
                }
            }
            if gone {
                let _ = child.wait();
                true
            } else {
                // Preserve enough identity to retry safely; the child handle itself
                // cannot be retained after this bounded stop attempt.
                let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                inner.external_pid = Some(pid);
                inner.external_binary = Some(self.binary_path.clone());
                inner.detached = false;
                false
            }
            // gone=false 时故意丢弃 Child：进程仍存活，句柄无再收价值
        } else if let Some((pid, binary)) = external {
            let stopped = kill_external(pid, binary.as_deref());
            if !stopped {
                let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                inner.external_pid = Some(pid);
                inner.external_binary = binary;
                inner.detached = false;
            }
            stopped
        } else {
            true
        };

        if stopped {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.detached = false;
            let _ = std::fs::remove_file(Self::descriptor_path(&self.work_dir));
        }
        stopped
    }
}

#[derive(Clone)]
pub struct CoreManager {
    shared: Arc<Shared>,
}
impl CoreManager {
    pub fn new(binary_path: PathBuf, work_dir: PathBuf) -> Self {
        Self {
            shared: Arc::new(Shared {
                binary_path,
                work_dir,
                opts: Mutex::new(CoreOptions::default()),
                callback: Mutex::new(None),
                config_cache: Mutex::new(None),
                inner: Mutex::new(Inner {
                    child: None,
                    status: CoreStatus::Stopped,
                    stopping: false,
                    restarts: VecDeque::new(),
                    controller: None,
                    detached: false,
                    external_pid: None,
                    external_binary: None,
                }),
            }),
        }
    }

    /// 测试与设置页注入参数；当前生产路径用默认值。
    #[allow(dead_code)]
    pub fn set_options(&self, opts: CoreOptions) {
        *self.shared.opts.lock().unwrap() = opts;
    }

    pub fn set_callback(&self, cb: Callback) {
        *self.shared.callback.lock().unwrap() = Some(cb);
    }

    pub fn status(&self) -> CoreStatus {
        self.shared.inner.lock().unwrap().status.clone()
    }

    /// 当前控制器 (port, secret)；S3 的 traffic/logs WS 订阅会用到。
    #[allow(dead_code)]
    pub fn controller(&self) -> Option<(u16, String)> {
        self.shared.inner.lock().unwrap().controller.clone()
    }

    /// 内核二进制路径（诊断与版本查询用）。
    pub fn binary_path(&self) -> PathBuf {
        self.shared.binary_path.clone()
    }

    /// 本次启动链的最终配置内容（当前出口解析等用途）；未启动过返回 None。
    pub fn current_config(&self) -> Option<String> {
        self.shared.config_cache.lock().unwrap().clone()
    }

    /// 启动链决策日志（独立文件 core-decision.log），排查引擎切换竞态。
    pub fn log_decision(&self, line: &str) {
        append_decision(&self.shared.work_dir, line);
    }

    /// 内核子进程 PID；诊断信息展示与测试用。
    #[allow(dead_code)]
    pub fn pid(&self) -> Option<u32> {
        self.shared
            .inner
            .lock()
            .unwrap()
            .child
            .as_ref()
            .map(|c| c.id())
    }

    /// 启动内核。`base_config` 是渲染后的订阅配置（未经运行时注入）。
    pub fn start(&self, base_config: &str, engine_rt: &RuntimeConfig) -> Result<(), String> {
        // 上一次尝试还在探测中（Starting）：先收掉再启动，避免新配置写入后
        // 被旧探测超时路径误杀/误报。
        if self.status() == CoreStatus::Starting {
            if !self.stop() {
                return Err("无法确认上一次启动的内核已退出，已中止新启动".into());
            }
        }
        if !matches!(self.status(), CoreStatus::Stopped | CoreStatus::Crashed(_)) {
            return Err(format!("core is {:?}, stop it first", self.status()));
        }
        if !self.shared.binary_path.exists() {
            let msg = format!(
                "core binary not found: {}",
                self.shared.binary_path.display()
            );
            self.shared.notify(CoreStatus::Crashed(msg.clone()));
            return Err(msg);
        }
        let has_tracked_process = {
            let inner = self.shared.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.child.is_some() || inner.external_pid.is_some()
        };
        if has_tracked_process && !self.shared.kill_child() {
            let msg = "无法确认上一次内核已退出，已中止新启动".to_string();
            self.shared.notify(CoreStatus::Crashed(msg.clone()));
            return Err(msg);
        }
        // 外部（上一实例轻量交接的）内核还活着：先收掉，避免端口冲突。
        // 先解除收养角色再杀，收养监视线程看到角色已换就静默退场，不会误报；
        // 杀失败保留描述文件并中止启动，避免无登记孤儿内核抢端口。
        if let Some(descriptor) = Shared::read_descriptor(&self.shared.work_dir) {
            {
                let mut inner = self.shared.inner.lock().unwrap_or_else(|e| e.into_inner());
                if inner.external_pid == Some(descriptor.pid) {
                    inner.external_pid = None;
                    inner.external_binary = None;
                    inner.detached = false;
                }
            }
            if !kill_external(descriptor.pid, descriptor.binary_path.as_deref()) {
                let msg = format!(
                    "无法确认旧内核进程 {} 已退出；描述文件已保留，请关闭旧内核后重试",
                    descriptor.pid
                );
                self.shared.notify(CoreStatus::Crashed(msg.clone()));
                return Err(msg);
            }
            let _ = std::fs::remove_file(Shared::descriptor_path(&self.shared.work_dir));
        }
        std::fs::create_dir_all(&self.shared.work_dir).map_err(|e| e.to_string())?;

        // 混合端口预检：被其他程序占用（常见：Clash Verge 等代理同端口）时，
        // sing-box 会 FATAL 退出、mihomo 静默失去代理能力——直接给出可操作的错误。
        // 常见占用者其实是本应用自己的残留内核（TUN root 内核 EPERM 杀不掉）：
        // 先按可执行路径识别并清理（root 走管理员补杀），重试一次，仍失败才报错。
        let address = if engine_rt.allow_lan {
            SocketAddr::from(([0, 0, 0, 0], engine_rt.mixed_port))
        } else {
            SocketAddr::from(([127, 0, 0, 1], engine_rt.mixed_port))
        };
        let try_bind = || check_mixed_port_available(address);
        if wait_for_mixed_port(&try_bind, Duration::from_secs(5)).is_err() {
            // 候选：当前内核 + 应用包内内核 + 数据目录内核 + tun-binaries 各版本副本
            // （实测踩坑：测试用 bundle 内核占端口时，仅 tun-binaries 候选会漏匹配）
            let mut candidates: Vec<PathBuf> = vec![self.shared.binary_path.clone()];
            if let Ok(exe) = std::env::current_exe() {
                if let Some(dir) = exe.parent() {
                    for name in ["mihomo", "sing-box"] {
                        candidates.push(dir.join(crate::core_download::core_bin_file(name)));
                    }
                }
            }
            if let Some(data_dir) = self.shared.work_dir.parent() {
                let tb = data_dir.join("tun-binaries");
                if let Ok(versions) = std::fs::read_dir(&tb) {
                    for v in versions.flatten() {
                        for name in ["mihomo", "sing-box"] {
                            candidates.push(v.path().join(crate::core_download::core_bin_file(name)));
                        }
                    }
                }
                for name in ["mihomo", "sing-box"] {
                    candidates.push(data_dir.join(crate::core_download::core_bin_file(name)));
                }
            }
            candidates.sort();
            candidates.dedup();
            let mut note = String::new();
            for (pid, path) in find_leftover_core_pids(&candidates) {
                if kill_external(pid, Some(&path)) {
                    note.push_str(&format!("已清理本应用残留内核 pid={pid}（{}）；", path.display()));
                } else {
                    note.push_str(&format!(
                        "残留内核 pid={pid}（{}）清理失败（可能取消了管理员授权）；",
                        path.display()
                    ));
                }
            }
            // Root-owned Crossbow kernels may be invisible to process enumeration.
            // The privileged fallback only targets this app's own binary paths.
            if wait_for_mixed_port(&try_bind, Duration::from_secs(5)).is_err()
                && port_has_listener(address)
                && escalate_clear_port(engine_rt.mixed_port)
            {
                note.push_str("已通过管理员权限清理端口上的残留内核；");
            }
            // After a TUN core exits, accepted macOS sockets can keep this
            // address unavailable briefly even though no process is listening.
            // Wait for that handover instead of reporting a false conflict.
            let handover_wait = if port_has_listener(address) {
                Duration::from_secs(5)
            } else {
                Duration::from_secs(30)
            };
            if let Err(e) = wait_for_mixed_port(&try_bind, handover_wait) {
                let listeners = port_listeners_via_lsof(engine_rt.mixed_port);
                for (pid, cmd) in &listeners {
                    note.push_str(&format!("占用者 pid={pid}（{cmd}）；"));
                }
                return Err(format!(
                    "混合端口 {} 无法绑定（{e}）。{note}若仍失败：请更换本应用的混合端口，或退出占用该端口的程序",
                    engine_rt.mixed_port
                ));
            }
        }
        // controller 端口避开 mixed，避免自相争抢
        let mut port = free_port().ok_or("no free port for controller")?;
        while port == engine_rt.mixed_port {
            port = free_port().ok_or("no free port for controller")?;
        }
        let secret = Uuid::new_v4().simple().to_string();
        let rt = RuntimeConfig {
            controller_port: port,
            controller_secret: secret.clone(),
            ..engine_rt.clone()
        };
        let final_config = apply_runtime(base_config, &rt)?;
        // 配置随启动链缓存：崩溃自动重启也重写文件，杜绝旧内核配新配置
        *self.shared.config_cache.lock().unwrap() = Some(final_config.clone());
        append_decision(
            &self.shared.work_dir,
            &format!(
                "start: bin={} engine={:?} mixed={} ctrl={} cfg_head={:?}",
                self.shared.binary_path.display(),
                rt.engine,
                rt.mixed_port,
                port,
                final_config.chars().take(48).collect::<String>(),
            ),
        );

        {
            let mut inner = self.shared.inner.lock().unwrap();
            inner.stopping = false;
            inner.controller = Some((port, secret));
            inner.restarts.clear();
        }
        spawn_and_watch(self.shared.clone());
        Ok(())
    }

    /// 启动时收养上一实例轻量交接的内核：探测通过则标记为运行中的外部实例。
    pub fn adopt_external(&self) -> bool {
        let Some(d) = Shared::read_descriptor(&self.shared.work_dir) else {
            return false;
        };
        let probe = ControllerProbe {
            port: d.port,
            secret: d.secret.clone(),
        };
        if !probe.wait_ready(Duration::from_secs(15), || false, || false) {
            if kill_external(d.pid, d.binary_path.as_deref()) {
                let _ = std::fs::remove_file(Shared::descriptor_path(&self.shared.work_dir));
            }
            return false;
        }
        let mut inner = self.shared.inner.lock().unwrap();
        inner.stopping = false;
        inner.detached = true;
        inner.external_pid = Some(d.pid);
        inner.external_binary = d.binary_path.clone();
        inner.controller = Some((d.port, d.secret));
        inner.status = CoreStatus::Running;
        drop(inner);
        // 收养内核没有子进程句柄：死亡无人知晓，状态会永远停在「运行中」，
        // 系统代理守护也不会触发。起 pid 监视线程补上（身份比对防 pid 复用）。
        #[cfg(unix)]
        if let Some(path) = d.binary_path.clone() {
            watch_external(self.shared.clone(), d.pid, path);
        }
        true
    }

    /// 轻量交接：标记 detached 并写描述符（内核继续由系统收养）。
    pub fn detach(&self) -> Option<u32> {
        let (pid, port, secret) = {
            let mut inner = self.shared.inner.lock().unwrap();
            if inner.status != CoreStatus::Running {
                return None;
            }
            inner.detached = true;
            let pid = inner
                .child
                .as_ref()
                .map(|c| c.id())
                .or(inner.external_pid)?;
            let (port, secret) = inner.controller.clone()?;
            (pid, port, secret)
        }; // 锁在此释放
        self.shared.write_descriptor(pid, port, &secret);
        Some(pid)
    }

    /// 优雅停止：标记后杀进程，watch 线程随之退出。
    pub fn stop(&self) -> bool {
        {
            let mut inner = self.shared.inner.lock().unwrap();
            inner.stopping = true;
            inner.controller = None;
            inner.detached = false;
        }
        let stopped = self.shared.kill_child();
        if stopped {
            self.shared.notify(CoreStatus::Stopped);
        } else {
            self.shared.notify(CoreStatus::Crashed(
                "无法确认内核进程已退出；已保留进程描述以便重试停止".into(),
            ));
        }
        stopped
    }
}

/// Probe the same address the core will use. macOS needs SO_REUSEADDR when a
/// previous listener has just exited but its accepted connections linger.
fn check_mixed_port_available(address: SocketAddr) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        use socket2::{Domain, Protocol, Socket, Type};
        let socket = Socket::new(Domain::IPV4, Type::STREAM, Some(Protocol::TCP))?;
        socket.set_reuse_address(true)?;
        socket.bind(&address.into())?;
        socket.listen(1)?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        TcpListener::bind(address).map(|_| ())
    }
}

fn wait_for_mixed_port(
    probe: &impl Fn() -> std::io::Result<()>,
    timeout: Duration,
) -> std::io::Result<()> {
    let deadline = Instant::now() + timeout;
    let mut result = probe();
    while result.is_err() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(100));
        result = probe();
    }
    result
}

fn port_has_listener(address: SocketAddr) -> bool {
    let address = if address.ip().is_unspecified() {
        SocketAddr::from(([127, 0, 0, 1], address.port()))
    } else {
        address
    };
    TcpStream::connect_timeout(&address, Duration::from_millis(200)).is_ok()
}

/// 拉起子进程 + 就绪探测 + 监视线程（重启时复用，不重写配置文件）。
fn spawn_and_watch(shared: Arc<Shared>) {
    shared.notify(CoreStatus::Starting);
    if let Err(e) = shared.spawn_child() {
        shared.notify(CoreStatus::Crashed(e));
        return;
    }
    let Some((port, secret)) = shared.inner.lock().unwrap().controller.clone() else {
        shared.notify(CoreStatus::Crashed("controller state missing".into()));
        return;
    };
    std::thread::spawn(move || watch(shared, port, secret));
}

/// 活性探测：进程是否存在（kill 0）。
#[cfg(all(unix, test))]
fn kill_pid_probe(pid: u32) -> bool {
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

#[cfg(all(not(unix), test))]
fn kill_pid_probe(_pid: u32) -> bool {
    false
}

/// root 内核补杀的授权弹窗门控：应用退出路径置 true（退出时不该突然弹
/// 管理员框），用户主动的 TUN/引擎/配置切换保持允许——这些本就是会弹
/// 授权框的语义场景。拒绝授权时停止流程照常继续（预绑定检查兜底报错）。
pub static ROOT_KILL_PROMPT_DISABLED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// 杀掉不属于本进程的内核 pid（收养场景）。unix 用 SIGKILL，其余平台降级。
fn kill_pid(pid: u32) {
    #[cfg(unix)]
    unsafe {
        let _ = libc::kill(pid as i32, libc::SIGKILL);
    }
    #[cfg(not(unix))]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/PID", &pid.to_string()])
            .output();
    }
}

#[cfg(unix)]
fn pid_is_alive(pid: u32) -> bool {
    unsafe {
        let rc = libc::kill(pid as i32, 0);
        rc == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }
}

#[cfg(not(unix))]
fn pid_is_alive(_pid: u32) -> bool {
    true // 无身份信息时宁可保留描述，也不把 PID 当作安全目标
}

/// root 内核对普通用户 SIGKILL 免疫（EPERM）：SIGKILL 后仍存活时，
/// 请管理员授权补杀。仅在确有 root 内核残留时才会弹授权框。
#[cfg(target_os = "macos")]
fn escalate_admin_kill(pid: u32) {
    let script = format!("kill -9 {pid}");
    let out = std::process::Command::new("osascript")
        .args([
            "-e",
            &format!("do shell script '{script}' with administrator privileges"),
        ])
        .output();
    if let Err(e) = out {
        eprintln!("admin kill {pid}: osascript failed: {e}");
    } else if !out.unwrap().status.success() {
        eprintln!("admin kill {pid}: user denied or failed");
    }
}

#[cfg(not(target_os = "macos"))]
fn escalate_admin_kill(_pid: u32) {}

/// 杀外部内核并确认真正退出；SIGKILL 无效（root 内核）时管理员补杀。
/// `expected`：进程身份校验路径（proc_pidpath / /proc/exe 比对）。
/// 缺少身份信息时只在 PID 已不存在的情况下报告完成，不发送信号或提权。
/// 返回是否确认已退出。
fn kill_external(pid: u32, expected: Option<&std::path::Path>) -> bool {
    let Some(expected) = expected else {
        if !pid_is_alive(pid) {
            return true;
        }
        eprintln!("core kill: refusing to signal unverified external pid {pid}");
        return false;
    };
    let matches = || process_matches_binary(pid, expected);
    if !matches() {
        return true; // 已不在
    }
    kill_pid(pid);
    for _ in 0..40 {
        if !matches() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    // 2 秒仍存活：root 内核，SIGKILL 对普通用户 EPERM——授权补杀
    if !ROOT_KILL_PROMPT_DISABLED.load(std::sync::atomic::Ordering::SeqCst) {
        escalate_admin_kill(pid);
    }
    for _ in 0..40 {
        if !matches() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    eprintln!("core kill: external pid {pid} still alive after admin kill");
    false
}

#[derive(serde::Deserialize)]
struct CoreDescriptor {
    port: u16,
    secret: String,
    pid: u32,
    #[serde(default)]
    binary_path: Option<PathBuf>,
}

/// 枚举可执行路径与任一候选完全一致的进程（识别本应用残留内核，
/// 避免误伤系统里无关的 mihomo/sing-box）。非 macOS 平台返回空——
/// Windows/Linux 的进程路径枚举在各自移植时补齐。
#[cfg(target_os = "macos")]
fn find_leftover_core_pids(candidates: &[PathBuf]) -> Vec<(u32, PathBuf)> {
    use std::ffi::CStr;
    use std::os::raw::{c_int, c_void};

    #[link(name = "proc")]
    unsafe extern "C" {
        fn proc_listallpids(pids: *mut c_void, size: c_int) -> c_int;
        fn proc_pidpath(pid: c_int, buffer: *mut c_void, buffersize: u32) -> c_int;
    }

    let mut out = Vec::new();
    unsafe {
        let n = proc_listallpids(std::ptr::null_mut(), 0);
        if n < 1 {
            return out;
        }
        let mut pids = vec![0_i32; n as usize + 16];
        let n = proc_listallpids(
            pids.as_mut_ptr().cast(),
            (pids.len() * std::mem::size_of::<i32>()) as c_int,
        );
        if n < 1 {
            return out;
        }
        for pid in &pids[..n as usize] {
            let mut buf = [0_i8; 4096];
            let len = proc_pidpath(*pid, buf.as_mut_ptr().cast(), buf.len() as u32);
            if len <= 0 {
                continue;
            }
            let Ok(path) = CStr::from_ptr(buf.as_ptr()).to_str() else {
                continue;
            };
            let path = PathBuf::from(path);
            if candidates.iter().any(|c| *c == path) {
                out.push((*pid as u32, path));
            }
        }
    }
    out
}

#[cfg(not(target_os = "macos"))]
fn find_leftover_core_pids(_candidates: &[PathBuf]) -> Vec<(u32, PathBuf)> {
    Vec::new()
}

/// 端口被占且普通权限查不到占用者（root 内核对非 root 完全不可见：
/// lsof/proc_pidpath 全瞎）时，用管理员权限在 root 上下文里定位端口
/// 监听者，且仅当其命令行含内核特征时才杀。返回是否清理成功。
#[cfg(target_os = "macos")]
fn escalate_clear_port(port: u16) -> bool {
    // 脚本刻意不含双引号与反斜杠，免去 AppleScript 字符串转义；
    // 仅当监听者命令行含内核特征时才杀，避免误伤其他程序。
    let shell = format!(
        "pids=$(lsof -t -n -i TCP:{port} -sTCP:LISTEN 2>/dev/null); killed=0; for p in $pids; do c=$(ps -p $p -o command=); case $c in *com.crossbow.app/tun-binaries/*|*com.richard.crossbow/tun-binaries/*|*/Crossbow.app/Contents/MacOS/mihomo*|*/Crossbow.app/Contents/MacOS/sing-box*) kill -9 $p && killed=1;; esac; done; test $killed -eq 1"
    );
    let apple = format!("do shell script '{shell}' with administrator privileges");
    let out = std::process::Command::new("osascript").arg("-e").arg(apple).output();
    match out {
        Ok(o) if o.status.success() => true,
        Ok(o) => {
            eprintln!(
                "admin clear port {port}: denied or failed: {}",
                String::from_utf8_lossy(&o.stderr).trim()
            );
            false
        }
        Err(e) => {
            eprintln!("admin clear port {port}: {e}");
            false
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn escalate_clear_port(_port: u16) -> bool {
    false
}

/// lsof 列出端口监听者的 (pid, 命令行)——仅当前用户可见的范围；
/// root 进程对普通权限不可见（由 escalate_clear_port 兜底）。
#[cfg(unix)]
fn port_listeners_via_lsof(port: u16) -> Vec<(u32, String)> {
    let Ok(out) = std::process::Command::new("lsof")
        .args(["-n", "-P", "-i", &format!("TCP:{port}"), "-sTCP:LISTEN"])
        .output()
    else {
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let mut out = Vec::new();
    for line in text.lines().skip(1) {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() > 1 {
            if let Ok(pid) = cols[1].parse::<u32>() {
                let cmd = std::process::Command::new("ps")
                    .args(["-p", &pid.to_string(), "-o", "command="])
                    .output()
                    .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                    .unwrap_or_default();
                out.push((pid, cmd));
            }
        }
    }
    out
}

#[cfg(not(unix))]
fn port_listeners_via_lsof(_port: u16) -> Vec<(u32, String)> {
    Vec::new()
}

#[cfg(target_os = "macos")]
fn process_matches_binary(pid: u32, expected: &Path) -> bool {
    use std::ffi::CStr;
    use std::os::raw::{c_int, c_void};

    #[link(name = "proc")]
    unsafe extern "C" {
        fn proc_pidpath(pid: c_int, buffer: *mut c_void, buffersize: u32) -> c_int;
    }

    let mut buffer = [0_i8; 4096];
    let len = unsafe {
        proc_pidpath(
            pid as c_int,
            buffer.as_mut_ptr().cast(),
            buffer.len() as u32,
        )
    };
    if len <= 0 {
        return false;
    }
    let Ok(actual) = unsafe { CStr::from_ptr(buffer.as_ptr()) }.to_str() else {
        return false;
    };
    match (
        std::fs::canonicalize(actual),
        std::fs::canonicalize(expected),
    ) {
        (Ok(actual), Ok(expected)) => actual == expected,
        _ => false,
    }
}

#[cfg(target_os = "linux")]
fn process_matches_binary(pid: u32, expected: &Path) -> bool {
    match (
        std::fs::canonicalize(format!("/proc/{pid}/exe")),
        std::fs::canonicalize(expected),
    ) {
        (Ok(actual), Ok(expected)) => actual == expected,
        _ => false,
    }
}

#[cfg(any(
    target_os = "windows",
    not(any(target_os = "macos", target_os = "linux"))
))]
fn process_matches_binary(_pid: u32, _expected: &Path) -> bool {
    false
}

impl Shared {
    fn read_descriptor(work_dir: &Path) -> Option<CoreDescriptor> {
        let raw = std::fs::read_to_string(Self::descriptor_path(work_dir)).ok()?;
        serde_json::from_str(&raw).ok()
    }
}

/// 收养内核的 pid 监视：每 3 秒做一次二进制路径身份比对，进程消失且
/// 收养角色未变时上报 Crashed（联动系统代理还原、托盘退订等守护）。
/// stop()/重新 start() 会先解除收养角色（external_pid 置空/换新），
/// 监视线程据此静默退场，不会误报。仅 unix——Windows 的身份比对是恒
/// false 占位，启用会立即误判。
#[cfg(unix)]
fn watch_external(shared: Arc<Shared>, pid: u32, binary: PathBuf) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(3));
        if process_matches_binary(pid, &binary) {
            continue;
        }
        let mut inner = shared.inner.lock().unwrap();
        if inner.stopping || inner.external_pid != Some(pid) {
            return; // 已被 stop/接管/换核：收尾由对方负责
        }
        inner.external_pid = None;
        inner.detached = false;
        inner.controller = None;
        drop(inner);
        append_decision(
            &shared.work_dir,
            &format!("adopted-watch: external pid {pid} gone → Crashed"),
        );
        shared.notify(CoreStatus::Crashed(
            "收养的内核进程已退出（可能是被外部终止或异常崩溃）".into(),
        ));
        return;
    });
}

fn watch(shared: Arc<Shared>, port: u16, secret: String) {
    let opts = shared.opts.lock().unwrap().clone();

    // 首次启动：GeoIP 数据库缺失/过小时先从镜像下载（mihomo 自带的
    // 直连 GitHub 下载在国内网络极易超时，且被旧版就绪窗口误杀形成
    // 「半截文件」死循环）。
    if opts.ensure_geo_files {
        if let Err(e) = ensure_geo_files(&shared.work_dir) {
            shared.kill_child();
            shared.notify(CoreStatus::Crashed(format!("GeoIP 数据库准备失败：{e}")));
            return;
        }
    }

    let probe = ControllerProbe { port, secret };
    // 子进程在探测窗口内退出（如端口被占 FATAL）→ 立刻失败，不傻等满超时
    let child_gone = || {
        let mut inner = shared.inner.lock().unwrap();
        match inner.child.as_mut() {
            Some(c) => c.try_wait().ok().flatten().is_some(),
            None => true,
        }
    };
    if !probe.wait_ready(
        Duration::from_secs(opts.readiness_timeout_secs),
        || shared.inner.lock().unwrap().stopping,
        child_gone,
    ) {
        let stopping = shared.inner.lock().unwrap().stopping;
        // 无论打断原因，先收走子进程（stop 打断路径若不杀，刚拉起的内核会变孤儿）
        shared.kill_child();
        if stopping {
            // 收尾已由 stop() 上报 Stopped，这里静默退出
            return;
        }
        shared.notify(CoreStatus::Crashed(format!(
            "内核启动失败/超时：{}",
            core_log_tail(&shared.work_dir, 400)
        )));
        return;
    }
    shared.notify(CoreStatus::Running);

    // 子进程始终留在共享状态（stop/pid 都依赖它）；这里只轮询退出状态。
    loop {
        let exit = {
            let mut inner = shared.inner.lock().unwrap();
            match inner.child.as_mut() {
                Some(c) => c.try_wait().ok().flatten(),
                None => return, // stop() 已收走并上报
            }
        };
        let Some(exit) = exit else {
            std::thread::sleep(Duration::from_millis(200));
            continue;
        };
        if shared.inner.lock().unwrap().stopping {
            return; // stop() 负责上报 Stopped
        }
        let reason = match exit.code() {
            Some(code) => format!(
                "内核异常退出（code {code}）：{}",
                core_log_tail(&shared.work_dir, 400)
            ),
            None => format!("内核被信号终止：{}", core_log_tail(&shared.work_dir, 400)),
        };
        shared.notify(CoreStatus::Crashed(reason));

        // 崩溃自动重启：窗口限次，退避 800ms。
        if allow_restart(&shared) {
            std::thread::sleep(Duration::from_millis(800));
            if !shared.inner.lock().unwrap().stopping {
                {
                    let mut inner = shared.inner.lock().unwrap();
                    inner.detached = false;
                    inner.external_pid = None;
                    inner.external_binary = None;
                }
                spawn_and_watch(shared);
            }
        }
        return;
    }
}

/// 崩溃重启簿记：窗口内超次返回 false（保持 Crashed）。
fn allow_restart(shared: &Shared) -> bool {
    let opts = shared.opts.lock().unwrap().clone();
    let mut inner = shared.inner.lock().unwrap();
    let now = Instant::now();
    while inner
        .restarts
        .front()
        .is_some_and(|t| now.duration_since(*t).as_secs() > opts.restart_window_secs)
    {
        inner.restarts.pop_front();
    }
    if inner.restarts.len() as u32 >= opts.max_restarts {
        return false;
    }
    inner.restarts.push_back(now);
    true
}

struct ControllerProbe {
    port: u16,
    secret: String,
}

impl ControllerProbe {
    /// 轮询 `/version` 直到就绪或超时；`cancelled` 返回 true 时立即放弃
    /// （stop() 已接管收尾，本探测不再上报）。
    fn wait_ready(
        &self,
        timeout: Duration,
        cancelled: impl Fn() -> bool,
        child_gone: impl Fn() -> bool,
    ) -> bool {
        let agent = ureq::AgentBuilder::new()
            .timeout(Duration::from_millis(800))
            .build();
        let url = format!("http://127.0.0.1:{}/version", self.port);
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if cancelled() || child_gone() {
                return false;
            }
            if let Ok(resp) = agent
                .get(&url)
                .set("Authorization", &format!("Bearer {}", self.secret))
                .call()
            {
                if resp.status() == 200 {
                    return true;
                }
            }
            // 短睡眠分片，保证 stop() 能及时打断长探测
            for _ in 0..6 {
                if cancelled() || child_gone() {
                    return false;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
        false
    }
}

/// GeoIP/GeoSite 数据源：镜像优先，直连 GitHub 兜底。
/// 镜像失效时调整此列表即可（均为数据文件，不参与代码构建）。
pub const GEO_FILES: &[(&str, bool, &[&str])] = &[
    (
        "geoip.metadb",
        true,
        &[
            // 2026-10 在 CN 网络实测可用
            "https://gh-proxy.com/https://github.com/MetaCubeX/meta-rules-dat/releases/latest/download/geoip.metadb",
            "https://github.com/MetaCubeX/meta-rules-dat/releases/latest/download/geoip.metadb",
        ],
    ),
    (
        "geosite.dat",
        false, // 尽力而为：仅当规则用到 GEOSITE 时内核才需要
        &[
            "https://gh-proxy.com/https://github.com/MetaCubeX/meta-rules-dat/releases/latest/download/geosite.dat",
            "https://github.com/MetaCubeX/meta-rules-dat/releases/latest/download/geosite.dat",
        ],
    ),
];

const GEO_MIN_BYTES: u64 = 1_000_000;

/// 确保内核工作目录里有可用的 geo 数据文件；缺失/过小时逐镜像下载。
fn ensure_geo_files(work_dir: &std::path::Path) -> Result<(), String> {
    ensure_geo_files_with(work_dir, GEO_FILES, download_to)
}

fn ensure_geo_files_with(
    work_dir: &std::path::Path,
    files: &[(&str, bool, &[&str])],
    download: impl Fn(&str, &std::path::Path) -> Result<(), String>,
) -> Result<(), String> {
    for (name, required, _) in files {
        let dest = work_dir.join(name);
        if dest.exists() && dest.metadata().map(|m| m.len()).unwrap_or(0) >= GEO_MIN_BYTES {
            continue;
        }
        match download(name, &dest) {
            Ok(()) => {}
            Err(e) if !required => {
                // 尽力而为的文件（geosite）：失败时清掉残留的坏文件——
                // 留着会让内核解析规则时直接失败；缺失时内核会自行下载。
                let _ = std::fs::remove_file(&dest);
                append_core_log(
                    work_dir,
                    &format!("{name} download failed (non-fatal): {e}"),
                );
            }
            Err(e) => return Err(format!("{name}: {e}")),
        }
    }
    Ok(())
}

/// 依次尝试 GeoFiles 里该文件的镜像源；下载后做最小健全性检查（大小 + metadb 头）。
fn download_to(name: &str, dest: &std::path::Path) -> Result<(), String> {
    let urls = GEO_FILES
        .iter()
        .find(|(n, _, _)| *n == name)
        .map(|(_, _, urls)| *urls)
        .ok_or_else(|| format!("unknown geo file {name}"))?;
    fetch_first_ok(name, urls, dest, GEO_MIN_BYTES)
}

/// 依次尝试镜像源下载；下载后做最小健全性检查（大小下限；metadb 另查文件头）。
fn fetch_first_ok(
    name: &str,
    urls: &[&str],
    dest: &std::path::Path,
    min_bytes: u64,
) -> Result<(), String> {
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(90))
        .build();
    let mut last_err = String::from("no source attempted");
    for url in urls {
        append_core_log(
            dest.parent().unwrap_or(std::path::Path::new(".")),
            &format!("Downloading {name} from {url}"),
        );
        match agent.get(url).call() {
            Ok(resp) => {
                if resp.status() >= 400 {
                    last_err = format!("{url}: HTTP {}", resp.status());
                    continue;
                }
                let mut reader = resp.into_reader();
                let tmp = dest.with_extension("part");
                let mut w = std::io::BufWriter::new(
                    std::fs::File::create(&tmp).map_err(|e| e.to_string())?,
                );
                if let Err(e) = std::io::copy(&mut reader, &mut w) {
                    last_err = format!("{url}: {e}");
                    let _ = std::fs::remove_file(&tmp);
                    continue;
                }
                // 健全性检查：足够大，且 metadb 头为 00 00 01 xx
                let ok_size = std::fs::metadata(&tmp).map(|m| m.len()).unwrap_or(0) >= min_bytes;
                let head_ok = name.ends_with("metadb") && {
                    let mut head = [0u8; 2];
                    std::fs::File::open(&tmp)
                        .and_then(|mut f| std::io::Read::read_exact(&mut f, &mut head))
                        .is_ok_and(|_| head[0] == 0 && head[1] == 0)
                } || !name.ends_with("metadb");
                if !ok_size || !head_ok {
                    last_err = format!("{url}: downloaded file failed sanity check");
                    let _ = std::fs::remove_file(&tmp);
                    continue;
                }
                std::fs::rename(&tmp, dest).map_err(|e| e.to_string())?;
                append_core_log(
                    dest.parent().unwrap_or(std::path::Path::new(".")),
                    &format!(
                        "Downloaded {name} ({} bytes)",
                        dest.metadata().map(|m| m.len()).unwrap_or(0)
                    ),
                );
                return Ok(());
            }
            Err(e) => {
                last_err = format!("{url}: {e}");
            }
        }
    }
    Err(format!("所有源均失败：{last_err}"))
}

/// 启动链决策日志：独立追加文件，spawn 的日志截断碰不到它。
/// 每行带 epoch 毫秒，用于离线还原「谁在什么时候用哪个二进制/配置启动」。
pub fn append_decision(work_dir: &std::path::Path, line: &str) {
    use std::io::Write;
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(work_dir.join("core-decision.log"))
    {
        let _ = writeln!(f, "{ms} {line}");
    }
}

fn append_core_log(work_dir: &std::path::Path, line: &str) {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(work_dir.join("core-stdio.log"))
    {
        let _ = writeln!(f, "[crossbow] {line}");
    }
}

/// 读取内核输出日志的尾部（崩溃原因展示用）。
fn core_log_tail(work_dir: &std::path::Path, max_chars: usize) -> String {
    let path = work_dir.join("core-stdio.log");
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return "（无内核输出）".into();
    };
    let trimmed: String = raw.trim().to_string();
    if trimmed.is_empty() {
        return "（内核无输出）".into();
    }
    let char_count = trimmed.chars().count();
    if char_count <= max_chars {
        return trimmed;
    }
    let skip = char_count - max_chars;
    format!("…{}", trimmed.chars().skip(skip).collect::<String>())
}

/// 分配一个空闲 TCP 端口（先绑定 0 拿端口再释放，存在极小竞态，S2 可接受）。
pub fn free_port() -> Option<u16> {
    let l = TcpListener::bind(("127.0.0.1", 0)).ok()?;
    l.local_addr().ok().map(|a| a.port())
}

#[cfg(test)]
pub(crate) mod tests {
    /// 供其他模块的真内核测试取空闲混合端口（默认 7897 真机上常被占）。
    pub(crate) fn tests_free_port() -> u16 {
        free_port().unwrap()
    }

    use super::*;

    /// 真内核测试共享网络与端口，必须串行执行（跨模块共享同一把锁）。
    pub(crate) static REAL_CORE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn free_port_returns_usable_port() {
        let p = free_port().unwrap();
        assert!(p > 0);
    }

    #[test]
    fn start_rejects_missing_binary() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = CoreManager::new(dir.path().join("no-such-bin"), dir.path().to_path_buf());
        let err = mgr
            .start("proxies: []", &RuntimeConfig::default())
            .unwrap_err();
        assert!(err.contains("not found"));
        assert!(matches!(mgr.status(), CoreStatus::Crashed(_)));
    }

    /// 假内核：进程不提供控制器 → Starting 超时 → Crashed。
    /// 二进制不存在时 spawn 失败，同样收敛到 Crashed（覆盖 Windows CI）。
    #[test]
    fn readiness_timeout_marks_crashed() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = CoreManager::new(PathBuf::from("/bin/sleep"), dir.path().to_path_buf());
        mgr.set_options(CoreOptions {
            readiness_timeout_secs: 1,
            ensure_geo_files: false,
            ..CoreOptions::default()
        });
        // 默认 7897 在真机上常被其他代理占用（预检会直接拒绝），测试用空闲端口
        let _ = mgr.start(
            "",
            &RuntimeConfig {
                mixed_port: free_port().unwrap(),
                ..RuntimeConfig::default()
            },
        );
        for _ in 0..80 {
            if matches!(mgr.status(), CoreStatus::Crashed(_)) {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        panic!("expected Crashed, got {:?}", mgr.status());
    }

    /// 真实内核冒烟：CROSSBOW_CORE_BIN 指向 mihomo 时才运行。
    /// 验证 启动 → Running → 混合端口可代理 → 停止 → Stopped。
    #[test]
    fn real_core_lifecycle_and_proxy_roundtrip() {
        let _serial = REAL_CORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let Ok(bin) = std::env::var("CROSSBOW_CORE_BIN") else {
            eprintln!("skip: CROSSBOW_CORE_BIN not set");
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let mgr = CoreManager::new(PathBuf::from(bin), dir.path().to_path_buf());
        mgr.set_options(CoreOptions {
            ensure_geo_files: false,
            ..CoreOptions::default()
        });
        let port = free_port().unwrap();
        let base = "proxies: []\nrules:\n  - MATCH,DIRECT\n".to_string();
        mgr.start(
            &base,
            &RuntimeConfig {
                mixed_port: port,
                ..RuntimeConfig::default()
            },
        )
        .unwrap();
        let mut running = false;
        for _ in 0..100 {
            if mgr.status() == CoreStatus::Running {
                running = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        assert!(running, "core never reached Running: {:?}", mgr.status());

        // 通过混合端口代理访问 generate_204，期望 204
        let out = Command::new("curl")
            .args([
                "-s",
                "-o",
                "/dev/null",
                "-w",
                "%{http_code}",
                "--max-time",
                "15",
                "-x",
                &format!("http://127.0.0.1:{port}"),
                "http://www.gstatic.com/generate_204",
            ])
            .output()
            .expect("curl");
        let code = String::from_utf8_lossy(&out.stdout).to_string();
        assert_eq!(code, "204", "proxy roundtrip failed: {code}");

        mgr.stop();
        assert_eq!(mgr.status(), CoreStatus::Stopped);
    }

    /// 回归：崩溃自动重启必须用本启动链缓存的内容重写 config.yaml。
    /// 旧实现重启时原样复用磁盘文件——换引擎交错时会把新引擎的配置
    /// 喂给旧内核（mihomo 拿到 sing-box JSON，控制器永不就绪）。
    #[test]
    fn real_core_crash_restart_rewrites_config() {
        let _serial = REAL_CORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let Ok(bin) = std::env::var("CROSSBOW_CORE_BIN") else {
            eprintln!("skip: CROSSBOW_CORE_BIN not set");
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let mgr = CoreManager::new(PathBuf::from(bin), dir.path().to_path_buf());
        mgr.set_options(CoreOptions {
            ensure_geo_files: false,
            ..CoreOptions::default()
        });
        let port = free_port().unwrap();
        let base = "proxies: []\nrules:\n  - MATCH,DIRECT\n".to_string();
        mgr.start(
            &base,
            &RuntimeConfig {
                mixed_port: port,
                ..RuntimeConfig::default()
            },
        )
        .unwrap();
        let mut running = false;
        for _ in 0..100 {
            if mgr.status() == CoreStatus::Running {
                running = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        assert!(running, "core never reached Running: {:?}", mgr.status());

        // 杀内核触发崩溃重启，再把磁盘配置篡改成垃圾——重启必须重写
        {
            let mut inner = mgr.shared.inner.lock().unwrap();
            if let Some(c) = inner.child.as_mut() {
                let _ = c.kill();
            }
        }
        let cfg_path = dir.path().join("config.yaml");
        std::fs::write(&cfg_path, "# TAMPERED\n").unwrap();

        let mut ok = false;
        for _ in 0..200 {
            let rewritten = std::fs::read_to_string(&cfg_path)
                .map(|c| c.contains("mixed-port") && !c.contains("TAMPERED"))
                .unwrap_or(false);
            if mgr.status() == CoreStatus::Running && rewritten {
                ok = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        assert!(
            ok,
            "restart should rewrite config and reach Running: {:?}",
            mgr.status()
        );
        mgr.stop();
        assert_eq!(mgr.status(), CoreStatus::Stopped);
    }

    /// 收养场景：无 Child 只有 external_pid，stop() 应能收走外部内核。
    #[test]
    fn stop_kills_adopted_external_core() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = CoreManager::new(PathBuf::from("/bin/sleep"), dir.path().to_path_buf());
        let mut sleeper = Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .expect("spawn sleeper");
        {
            let mut inner = mgr.shared.inner.lock().unwrap();
            inner.detached = true;
            inner.status = CoreStatus::Running;
            inner.controller = Some((1, "x".into()));
            inner.external_pid = Some(sleeper.id());
            inner.external_binary = Some(PathBuf::from("/bin/sleep"));
        }
        let pid = sleeper.id();
        mgr.stop();
        std::thread::sleep(Duration::from_millis(400));
        // SIGKILL 已发出；僵尸态由 Child::wait 回收，回收后 kill -0 必失败
        let _ = sleeper.wait();
        assert!(!kill_pid_probe(pid), "external core should be dead");
        assert!(!Shared::descriptor_path(dir.path()).exists());
    }

    /// 交接语义：detached 后管理器 Drop 不得杀内核，且描述符已写。
    #[test]
    fn detach_survives_manager_drop() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = CoreManager::new(PathBuf::from("/bin/sleep"), dir.path().to_path_buf());
        let sleeper = Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .expect("spawn sleeper");
        let child_pid = sleeper.id();
        {
            let mut inner = mgr.shared.inner.lock().unwrap();
            inner.detached = true;
            inner.status = CoreStatus::Running;
            inner.controller = Some((19099, "sec".into()));
            inner.child = Some(sleeper); // 所有权交给管理器
        }
        mgr.detach();
        drop(mgr); // 触发 Shared::Drop
        std::thread::sleep(Duration::from_millis(300));
        let alive = Command::new("kill")
            .arg("-0")
            .arg(child_pid.to_string())
            .output();
        assert!(
            alive.unwrap().status.success(),
            "detached core must survive drop"
        );
        assert!(
            Shared::descriptor_path(dir.path()).exists(),
            "descriptor written"
        );
        let _ = Command::new("kill")
            .arg("-9")
            .arg(child_pid.to_string())
            .output();
    }

    /// 真实内核崩溃自动恢复：Running 中强杀子进程 → 应自动回到 Running。
    #[test]
    fn real_core_crash_auto_recovers() {
        let Ok(bin) = std::env::var("CROSSBOW_CORE_BIN") else {
            eprintln!("skip: CROSSBOW_CORE_BIN not set");
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let mgr = CoreManager::new(PathBuf::from(bin), dir.path().to_path_buf());
        mgr.set_options(CoreOptions {
            readiness_timeout_secs: 10,
            ensure_geo_files: false,
            ..CoreOptions::default()
        });
        mgr.start(
            "proxies: []\nrules:\n  - MATCH,DIRECT\n",
            &RuntimeConfig {
                mixed_port: free_port().unwrap(),
                ..RuntimeConfig::default()
            },
        )
        .unwrap();
        let wait_status = |mgr: &CoreManager, want: &dyn Fn(&CoreStatus) -> bool| {
            for _ in 0..150 {
                if want(&mgr.status()) {
                    return true;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            false
        };
        assert!(wait_status(&mgr, &|s| *s == CoreStatus::Running));

        // 模拟崩溃：SIGKILL 管理器自己的子进程（不能按名字找，会误伤其他实例）
        let pid = mgr.pid().expect("core child pid");
        Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output()
            .unwrap();

        // 应先观察到 Crashed，随后自动重启回到 Running
        assert!(
            wait_status(&mgr, &|s| matches!(s, CoreStatus::Crashed(_))),
            "no Crashed observed"
        );
        assert!(
            wait_status(&mgr, &|s| *s == CoreStatus::Running),
            "did not recover to Running: {:?}",
            mgr.status()
        );
        mgr.stop();
        assert_eq!(mgr.status(), CoreStatus::Stopped);
    }
}
