//! 特权服务客户端（Windows）：命名管道 `\\.\pipe\crossbow-service` 的
//! 一问一答 JSON 协议，见 apps/service/src/main.rs 模块注释。
//! 服务由 NSIS 安装器注册（开机自启）；TUN 内核以 SYSTEM 运行必须经它
//! 拉起/停止——GUI 直接杀 SYSTEM 进程是 EPERM。

#[cfg(target_os = "windows")]
pub mod imp {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt as _;
    use std::path::Path;

    use windows_sys::Win32::Foundation::{
        CloseHandle, GetLastError, ERROR_FILE_NOT_FOUND, ERROR_PIPE_BUSY,
    };
    use windows_sys::Win32::Security::{GENERIC_READ, GENERIC_WRITE};
    use windows_sys::Win32::Storage::FileSystem::{CreateFileW, ReadFile, WriteFile, OPEN_EXISTING};
    use windows_sys::Win32::System::Pipes::{WaitNamedPipeW, PIPE_ACCESS_DUPLEX};

    pub const PIPE_PATH: &str = "\\\\.\\pipe\\crossbow-service";

    fn wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    }

    /// 服务是否已随安装器注册（exe 同目录有服务二进制即视为已装）
    pub fn installed() -> bool {
        std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|dir| dir.join("crossbow-service.exe")))
            .is_some_and(|p| p.is_file())
    }

    fn connect_pipe() -> Result<*mut core::ffi::c_void, String> {
        let wide_path = wide(PIPE_PATH);
        for attempt in 0..20 {
            let handle = unsafe {
                CreateFileW(
                    wide_path.as_ptr(),
                    GENERIC_READ | GENERIC_WRITE,
                    0,
                    std::ptr::null(),
                    OPEN_EXISTING,
                    PIPE_ACCESS_DUPLEX,
                    std::ptr::null(),
                )
            };
            let err = unsafe { GetLastError() };
            if !handle.is_null() {
                return Ok(handle);
            }
            if err == ERROR_PIPE_BUSY {
                let wide = wide(PIPE_PATH);
                unsafe {
                    WaitNamedPipeW(wide.as_ptr(), 2000);
                }
            } else if err == ERROR_FILE_NOT_FOUND && attempt >= 5 {
                // 服务没起来（安装器未注册/被禁用）：快速失败，调用方给指引
                return Err("service not running".into());
            }
            std::thread::sleep(std::time::Duration::from_millis(150));
        }
        Err("service pipe timeout".into())
    }

    /// 单行请求/应答。每次新建连接：服务端一连接一请求，串行处理。
    fn request(payload: serde_json::Value) -> Result<serde_json::Value, String> {
        let handle = connect_pipe()?;
        let mut out = payload.to_string().into_bytes();
        out.push(b'\n');
        let sent = unsafe {
            let mut written = 0u32;
            let ok = WriteFile(handle, out.as_ptr(), out.len() as u32, &mut written, std::ptr::null_mut());
            (ok, written)
        };
        if sent.0 == 0 {
            unsafe { CloseHandle(handle) };
            return Err("pipe write failed".into());
        }
        let mut line = Vec::with_capacity(256);
        unsafe {
            let mut byte = [0u8; 1];
            while line.len() < 4096 {
                let mut read = 0u32;
                if ReadFile(handle, byte.as_mut_ptr(), 1, &mut read, std::ptr::null_mut()) == 0
                    || read == 0
                {
                    break;
                }
                if byte[0] == b'\n' {
                    break;
                }
                line.push(byte[0]);
            }
            CloseHandle(handle);
        }
        serde_json::from_slice(&line)
            .map_err(|e| format!("service response: {e}"))
    }

    fn unwrap_ok(response: serde_json::Value) -> Result<serde_json::Value, String> {
        if response.get("ok").and_then(|v| v.as_bool()) == Some(true) {
            Ok(response)
        } else {
            Err(response
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("service error")
                .to_string())
        }
    }

    /// 让服务以 SYSTEM 拉起内核，返回 pid
    pub fn start_core(binary: &Path, config: &Path, log: &Path) -> Result<u32, String> {
        let path_str = |p: &Path| p.to_string_lossy().into_owned();
        let response = request(serde_json::json!({
            "cmd": "start",
            "binary": path_str(binary),
            "config": path_str(config),
            "log": path_str(log),
        }))?;
        let ok = unwrap_ok(response)?;
        ok.get("pid")
            .and_then(|v| v.as_u64())
            .map(|p| p as u32)
            .ok_or_else(|| "service returned no pid".into())
    }

    /// 让服务停掉其托管内核。服务无内核在跑时返回 Err（调用方回落到
    /// 常规用户态停止路径，避免误把普通内核标成已停）。
    pub fn stop_core() -> Result<(), String> {
        let response = request(serde_json::json!({"cmd": "stop"}))?;
        unwrap_ok(response).map(|_| ())
    }

    pub fn running() -> Result<Option<u32>, String> {
        let response = request(serde_json::json!({"cmd": "status"}))?;
        let ok = unwrap_ok(response)?;
        Ok(ok.get("pid").and_then(|v| v.as_u64()).map(|p| p as u32))
    }

    /// 服务缺失时的一次性兜底安装：PowerShell 弹 UAC 后 `sc create`。
    /// 常规路径是 NSIS 安装器已注册；此处只在用户从非安装包环境跑时用。
    pub fn install_elevated() -> Result<(), String> {
        let exe = std::env::current_exe()
            .map_err(|e| e.to_string())?
            .parent()
            .ok_or("no parent")?
            .join("crossbow-service.exe");
        if !exe.is_file() {
            return Err("crossbow-service.exe 未随应用安装".into());
        }
        let script = format!(
            "Start-Process sc.exe -Verb RunAs -Wait -ArgumentList 'create','CrossbowService','binPath=','\"{}\"','start=','auto','obj=','LocalSystem','DisplayName=','\"Crossbow Service\"'",
            exe.display()
        );
        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(format!(
                "服务安装失败（用户取消或权限不足）：{}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok(())
    }
}

#[cfg(target_os = "windows")]
pub use imp::*;

#[cfg(not(target_os = "windows"))]
pub fn installed() -> bool {
    false
}
