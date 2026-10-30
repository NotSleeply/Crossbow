//! TUN broker for the installed desktop app. Windows uses client impersonation;
//! Linux runs as the authorized user with only CAP_NET_ADMIN. Both launch a fixed
//! core with a sanitized configuration and own the resulting process lifetime.
#[cfg(windows)]
mod core_process;
#[cfg(target_os = "linux")]
mod linux;
#[cfg(any(windows, target_os = "linux", test))]
mod policy;
#[cfg(windows)]
mod windows;

#[cfg(windows)]
fn main() {
    std::process::exit(windows::run());
}
#[cfg(target_os = "linux")]
fn main() {
    if let Err(error) = linux::run() {
        eprintln!("crossbow-service: {error}");
        std::process::exit(1);
    }
}
#[cfg(not(any(windows, target_os = "linux")))]
fn main() {
    eprintln!("crossbow-service is unavailable on this platform");
}
