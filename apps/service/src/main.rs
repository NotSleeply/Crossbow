//! Crossbow 特权内核服务（Windows）。
//!
//! 以 LocalSystem 运行的最小服务：在命名管道 `\\.\pipe\crossbow-service`
//! 上接受单行 JSON 请求，代 GUI 拉起/停止需要管理员权限的 TUN 内核。
//! NSIS 安装器注册服务（开机自启），安装一次 = 授权一次。
//!
//! 协议（每连接一问一答，UTF-8 JSON + '\n'）：
//! - `{"cmd":"start","binary":..,"config":..,"log":..}` → `{"ok":true,"pid":N}`
//! - `{"cmd":"stop"}` → `{"ok":true}`（无内核在跑时 `{"ok":false,"error":"no core"}`）
//! - `{"cmd":"status"}` → `{"ok":true,"running":bool,"pid":N|null}`
//!
//! 安全约束：`start` 只接受与本服务同目录且文件名以 mihomo 开头的内核，
//! 防止本地任意进程借服务提权执行任意二进制。

#[cfg(windows)]
mod imp {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt as _;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;

    use windows_sys::Win32::Foundation::{
        CloseHandle, GetLastError, ERROR_PIPE_CONNECTED, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        FlushFileBuffers, ReadFile, WriteFile, PIPE_ACCESS_DUPLEX,
    };
    use windows_sys::Win32::System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, PIPE_READMODE_BYTE,
        PIPE_TYPE_BYTE,
    };
    use windows_sys::Win32::System::Services::{
        RegisterServiceCtrlHandlerW, SetServiceStatus, StartServiceCtrlDispatcherW,
        SERVICE_ACCEPT_SHUTDOWN, SERVICE_ACCEPT_STOP, SERVICE_CONTROL_SHUTDOWN,
        SERVICE_CONTROL_STOP, SERVICE_RUNNING, SERVICE_START_PENDING, SERVICE_STATUS,
        SERVICE_STATUS_HANDLE, SERVICE_STOPPED, SERVICE_STOP_PENDING, SERVICE_TABLE_ENTRYW,
        SERVICE_WIN32_OWN_PROCESS,
    };

    const PIPE_PATH: &str = "\\\\.\\pipe\\crossbow-service";
    static STOP: AtomicBool = AtomicBool::new(false);
    static CHILD: Mutex<Option<std::process::Child>> = Mutex::new(None);
    static STATUS_HANDLE: Mutex<Option<SERVICE_STATUS_HANDLE>> = Mutex::new(None);

    fn wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    }

    fn report_status(state: u32, wait_hint: u32) {
        let Some(handle) = *STATUS_HANDLE.lock().unwrap() else { return };
        let status = SERVICE_STATUS {
            dwServiceType: SERVICE_WIN32_OWN_PROCESS,
            dwCurrentState: state,
            dwControlsAccepted: if state == SERVICE_RUNNING {
                SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN
            } else {
                0
            },
            dwWin32ExitCode: 0,
            dwServiceSpecificExitCode: 0,
            dwCheckPoint: 0,
            dwWaitHint: wait_hint,
        };
        unsafe {
            SetServiceStatus(handle, &status);
        }
    }

    unsafe extern "system" fn service_main(_argc: u32, _argv: *mut *mut u16) {
        let name = wide("CrossbowService");
        let handle = RegisterServiceCtrlHandlerW(name.as_ptr(), Some(service_handler));
        *STATUS_HANDLE.lock().unwrap() = if handle.is_null() { None } else { Some(handle) };
        report_status(SERVICE_START_PENDING, 1000);
        STOP.store(false, Ordering::SeqCst);
        std::thread::spawn(pipe_server_loop);
        report_status(SERVICE_RUNNING, 0);
    }

    unsafe extern "system" fn service_handler(control: u32) {
        if control == SERVICE_CONTROL_STOP || control == SERVICE_CONTROL_SHUTDOWN {
            report_status(SERVICE_STOP_PENDING, 2000);
            STOP.store(true, Ordering::SeqCst);
            kill_child();
            report_status(SERVICE_STOPPED, 0);
        }
    }

    /// 停掉服务托管的核心（无核心在跑时不动，语义由调用方给）
    fn kill_child() {
        if let Some(mut child) = CHILD.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    fn pipe_server_loop() {
        loop {
            if STOP.load(Ordering::SeqCst) {
                return;
            }
            unsafe {
                let wide_path = wide(PIPE_PATH);
                let pipe = CreateNamedPipeW(
                    wide_path.as_ptr(),
                    PIPE_ACCESS_DUPLEX,
                    PIPE_TYPE_BYTE | PIPE_READMODE_BYTE,
                    1,
                    4096,
                    4096,
                    0,
                    std::ptr::null(),
                );
                if pipe == INVALID_HANDLE_VALUE || pipe.is_null() {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                    continue;
                }
                // 客户端可能抢在 ConnectNamedPipe 之前连上
                let connected = ConnectNamedPipe(pipe, std::ptr::null_mut()) != 0
                    || GetLastError() == ERROR_PIPE_CONNECTED;
                if connected {
                    serve_one(pipe);
                }
                let _ = FlushFileBuffers(pipe);
                DisconnectNamedPipe(pipe);
                CloseHandle(pipe);
            }
        }
    }

    /// 读一行（UTF-8 JSON），处理并回写一行应答
    fn serve_one(pipe: *mut core::ffi::c_void) {
        let mut line = Vec::with_capacity(256);
        unsafe {
            let mut byte = [0u8; 1];
            while line.len() < 4096 {
                let mut read = 0u32;
                if ReadFile(pipe, byte.as_mut_ptr(), 1, &mut read, std::ptr::null_mut()) == 0
                    || read == 0
                {
                    break;
                }
                if byte[0] == b'\n' {
                    break;
                }
                line.push(byte[0]);
            }
        }
        let request: serde_json::Value =
            serde_json::from_slice(&line).unwrap_or(serde_json::Value::Null);
        let mut out = handle_request(&request).into_bytes();
        out.push(b'\n');
        unsafe {
            let mut written = 0u32;
            WriteFile(pipe, out.as_ptr(), out.len() as u32, &mut written, std::ptr::null_mut());
        }
    }

    fn handle_request(request: &serde_json::Value) -> String {
        let reply = match request.get("cmd").and_then(|c| c.as_str()) {
            Some("start") => start_core(request),
            Some("stop") => {
                let had = CHILD.lock().unwrap().is_some();
                kill_child();
                if had {
                    serde_json::json!({"ok": true})
                } else {
                    serde_json::json!({"ok": false, "error": "no core"})
                }
            }
            Some("status") => {
                let guard = CHILD.lock().unwrap();
                let pid = guard.as_ref().map(|c| c.id());
                serde_json::json!({"ok": true, "running": guard.is_some(), "pid": pid})
            }
            _ => serde_json::json!({"ok": false, "error": "unknown command"}),
        };
        reply.to_string()
    }

    /// 只接受与本服务同目录、文件名以 mihomo 开头的内核（防提权跳板）
    fn start_core(request: &serde_json::Value) -> serde_json::Value {
        let reply = (|| -> Result<serde_json::Value, String> {
            let field = |name: &str| -> Result<PathBuf, String> {
                request
                    .get(name)
                    .and_then(|v| v.as_str())
                    .map(PathBuf::from)
                    .ok_or_else(|| format!("missing field {name}"))
            };
            let binary = field("binary")?;
            let config = field("config")?;
            let log = field("log")?;
            if CHILD.lock().unwrap().is_some() {
                return Err("core already running".into());
            }
            if !config.is_file() {
                return Err("config not found".into());
            }
            let exe_dir = std::env::current_exe()
                .map_err(|e| e.to_string())?
                .parent()
                .ok_or("service exe has no parent")?
                .to_path_buf();
            let bin_canon = binary.canonicalize().map_err(|e| e.to_string())?;
            let dir_canon = exe_dir.canonicalize().map_err(|e| e.to_string())?;
            if bin_canon.parent() != Some(&dir_canon) {
                return Err("binary must live next to the service".into());
            }
            let name = bin_canon.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if !name.to_lowercase().starts_with("mihomo") {
                return Err("only mihomo cores are managed".into());
            }
            let log_file = std::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&log)
                .map_err(|e| format!("open log: {e}"))?;
            let log_err = log_file.try_clone().map_err(|e| format!("clone log: {e}"))?;
            let workdir = config.parent().ok_or("config has no parent")?;
            let child = std::process::Command::new(&bin_canon)
                .arg("-d")
                .arg(workdir)
                .arg("-f")
                .arg(&config)
                .stdout(log_file)
                .stderr(log_err)
                .spawn()
                .map_err(|e| format!("spawn: {e}"))?;
            let pid = child.id();
            *CHILD.lock().unwrap() = Some(child);
            Ok(serde_json::json!({"ok": true, "pid": pid}))
        })();
        match reply {
            Ok(v) => v,
            Err(error) => serde_json::json!({"ok": false, "error": error}),
        }
    }

    pub fn run() -> i32 {
        if std::env::args().any(|a| a == "--console") {
            // 调试模式：不走 SCM，直接跑管道服务
            pipe_server_loop();
            return 0;
        }
        let mut name = wide("CrossbowService");
        let mut table = [
            SERVICE_TABLE_ENTRYW {
                lpServiceName: name.as_mut_ptr(),
                lpServiceProc: Some(service_main),
            },
            SERVICE_TABLE_ENTRYW {
                lpServiceName: std::ptr::null_mut(),
                lpServiceProc: None,
            },
        ];
        unsafe {
            if StartServiceCtrlDispatcherW(table.as_mut_ptr()) == 0 {
                return 1;
            }
        }
        0
    }
}

#[cfg(windows)]
fn main() {
    std::process::exit(imp::run());
}

#[cfg(not(windows))]
fn main() {
    // 仅 Windows 有意义；为 macOS 本地 cargo check 提供可编译目标
    eprintln!("crossbow-service is Windows-only");
    std::process::exit(1);
}
