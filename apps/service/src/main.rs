//! Windows LocalSystem TUN broker. Only the installed GUI can request a pinned
//! sibling core; user files are read/opened under client impersonation. The core
//! receives a sanitized copy in an administrator-protected runtime directory.
#[cfg(any(windows, test))]
mod policy;
#[cfg(windows)]
mod core_process;
#[cfg(windows)]
mod windows;

#[cfg(windows)]
fn main() {
    std::process::exit(windows::run());
}
#[cfg(not(windows))]
fn main() {
    eprintln!("crossbow-service is Windows-only");
}
