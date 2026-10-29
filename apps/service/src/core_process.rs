//! Keep canonical paths for broker checks and I/O, but pass ordinary Windows
//! paths to mihomo: its GeoIP/cache helpers append `/` with Go's path.Join.
//! Verbatim (`\\?\`) Windows paths do not accept that separator.
use std::os::windows::process::CommandExt;
use std::path::{Component, Path, PathBuf, Prefix};
use std::process::Command;
use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

fn core_path(path: &Path) -> Result<PathBuf, String> {
    let mut components = path.components();
    match components.next() {
        Some(Component::Prefix(prefix)) => match prefix.kind() {
            Prefix::VerbatimDisk(drive) => {
                let mut ordinary = PathBuf::from(format!("{}:\\", char::from(drive)));
                for component in components {
                    match component {
                        Component::RootDir => {}
                        Component::Normal(part) => ordinary.push(part),
                        _ => return Err("invalid canonical core path".into()),
                    }
                }
                Ok(ordinary)
            }
            Prefix::Disk(_) if path.is_absolute() => Ok(path.to_path_buf()),
            // The broker only permits a local Program Files installation. Do
            // not reinterpret device/UNC namespaces as local disk paths.
            _ => Err("core path must use a local absolute drive path".into()),
        },
        _ => Err("core path must use a local absolute drive path".into()),
    }
}

pub fn command(binary: &Path, runtime: &Path, config: &Path) -> Result<Command, String> {
    let mut command = Command::new(binary);
    command
        .arg("-d")
        .arg(core_path(runtime)?)
        .arg("-f")
        .arg(core_path(config)?)
        .current_dir(runtime)
        .env_remove("SAFE_PATHS")
        .env_remove("SKIP_SAFE_PATH_CHECK")
        .creation_flags(CREATE_NO_WINDOW);
    Ok(command)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_only_local_verbatim_paths_without_losing_unicode() {
        let normal = Path::new(r"C:\Program Files\Crossbow\service-runtime\用户\runtime.yaml");
        assert_eq!(core_path(normal).unwrap(), normal);
        assert_eq!(
            core_path(Path::new(
                r"\\?\C:\Program Files\Crossbow\service-runtime\用户\runtime.yaml"
            ))
            .unwrap(),
            normal
        );
        assert_eq!(core_path(Path::new(r"\\?\C:\")).unwrap(), Path::new(r"C:\"));
        for unsupported in [
            r"C:relative",
            r"relative",
            r"\\.\pipe\test",
            r"\\?\GLOBALROOT\Device\x",
            r"\\?\UNC\server\share\x",
            r"\\server\share\x",
        ] {
            assert!(core_path(Path::new(unsupported)).is_err(), "{unsupported}");
        }
    }

    struct Scratch(PathBuf);
    impl Scratch {
        fn new() -> Self {
            let root = std::env::temp_dir()
                .join(format!(
                    "crossbow-core-path-{}-{}",
                    std::process::id(),
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_nanos()
                ))
                .join("Program Files 测试");
            std::fs::create_dir_all(&root).unwrap();
            Self(root.canonicalize().unwrap())
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(self.0.parent().unwrap());
        }
    }

    #[test]
    fn canonical_runtime_supports_mihomo_style_asset_paths() {
        let scratch = Scratch::new();
        let home = core_path(&scratch.0).unwrap();
        // Reproduce Go path.Join, which uses `/` rather than Windows `\`.
        let asset = format!("{}/geoip.metadb", home.display());
        std::fs::write(&asset, b"invalid MMDB fixture").unwrap();
        assert!(scratch.0.join("geoip.metadb").exists());
        std::fs::remove_file(&asset).unwrap();
        assert!(!scratch.0.join("geoip.metadb").exists());
        let command = command(
            Path::new(r"C:\mihomo.exe"),
            &scratch.0,
            &scratch.0.join("runtime.yaml"),
        )
        .unwrap();
        let args: Vec<_> = command.get_args().collect();
        assert_eq!(args[1], home.as_os_str());
        assert_eq!(args[3], home.join("runtime.yaml").as_os_str());
    }

    #[test]
    fn real_mihomo_reads_providers_and_removes_invalid_mmdb() {
        // Enabled by the Windows installer smoke test after installing the
        // pinned sidecar. Never opens a listener, enables TUN or sets a proxy.
        let Some(binary) = std::env::var_os("CROSSBOW_CORE_BIN") else {
            return;
        };
        let scratch = Scratch::new();
        let config = scratch.0.join("runtime.yaml");
        std::fs::create_dir(scratch.0.join("rules")).unwrap();
        std::fs::write(
            scratch.0.join("rules/test.yaml"),
            "payload:\n  - DOMAIN,example.com\n",
        )
        .unwrap();
        std::fs::write(&config, "mixed-port: 0\nrules:\n  - RULE-SET,test,DIRECT\n  - MATCH,DIRECT\nrule-providers:\n  test:\n    type: file\n    behavior: classical\n    path: ./rules/test.yaml\n").unwrap();
        let output = command(Path::new(&binary), &scratch.0, &config)
            .unwrap()
            .arg("-t")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );

        // Exercise exactly the failed operation in #185. The deliberately
        // invalid MMDB must be removable before a controlled download failure.
        // A closed loopback port avoids any external download or GeoIP fixture.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        std::fs::write(scratch.0.join("geoip.metadb"), b"invalid MMDB fixture").unwrap();
        std::fs::write(&config, format!("mixed-port: 0\ngeodata-mode: false\ngeox-url:\n  mmdb: http://127.0.0.1:{port}/geoip.metadb\nrules:\n  - GEOIP,NETFLIX,DIRECT\n  - MATCH,DIRECT\n")).unwrap();
        let output = command(Path::new(&binary), &scratch.0, &config)
            .unwrap()
            .arg("-t")
            .output()
            .unwrap();
        let log = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            !output.status.success(),
            "invalid fixture must fail validation"
        );
        assert!(
            !scratch.0.join("geoip.metadb").exists(),
            "invalid MMDB was not removed: {log}"
        );
        assert!(!log.contains("can't remove invalid MMDB"), "{log}");
        assert!(
            log.contains("127.0.0.1"),
            "expected controlled download failure: {log}"
        );
    }
}
