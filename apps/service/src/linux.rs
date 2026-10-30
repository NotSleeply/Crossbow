//! A single-user TUN session. The system manager grants only CAP_NET_ADMIN;
//! the GUI owns a live socket, while this process owns the core and its routes.
use crossbow_service::linux_network::{self as network, DEVICE, MARK, PRIORITY, PROTOCOL, TABLE};
use serde_json::{json, Value};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::os::fd::AsRawFd;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

const INSTALL: &str = "/usr/lib/crossbow";
const SERVICE: &str = "/usr/lib/crossbow/crossbow-service";
const CORE: &str = "/usr/lib/crossbow/mihomo";
const RUNTIME: &str = "/run/crossbow-tun";
const SOCKET: &str = "/run/crossbow-tun/control.sock";
const JOURNAL: &str = "/run/crossbow-tun/network.json";
const SESSION: &str = "/run/crossbow-tun/session";
const FRAME_LIMIT: usize = 4096;
static STOP: AtomicBool = AtomicBool::new(false);

extern "C" fn stop_signal(_: libc::c_int) {
    STOP.store(true, Ordering::Relaxed);
}
fn uid() -> u32 {
    unsafe { libc::geteuid() }
}

pub fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    match args.as_slice() {
        [mode] if mode == "--authorize" => authorize(),
        [mode] if mode == "--serve" => serve(),
        [mode] if mode == "--cleanup" => cleanup(),
        _ => Err("expected --authorize, --serve or --cleanup".into()),
    }
}

fn protected_install() -> Result<(), String> {
    for path in ["/usr", "/usr/lib", INSTALL, SERVICE, CORE] {
        let meta = fs::symlink_metadata(path).map_err(|e| format!("安装不完整：{path}: {e}"))?;
        if meta.file_type().is_symlink() || meta.uid() != 0 || meta.mode() & 0o022 != 0 {
            return Err(format!(
                "安装路径必须由 root 管理且不可被普通用户改写：{path}"
            ));
        }
        if [SERVICE, CORE].contains(&path) && (!meta.is_file() || meta.mode() & 0o111 == 0) {
            return Err(format!("安装程序不可执行：{path}"));
        }
    }
    Ok(())
}

fn authorize() -> Result<(), String> {
    if uid() != 0 {
        return Err("请通过系统授权启动 Crossbow TUN 服务".into());
    }
    let owner = std::env::var("PKEXEC_UID")
        .ok()
        .and_then(|s| s.parse::<u32>().ok())
        .filter(|owner| *owner > 0)
        .ok_or("缺少有效的 pkexec 调用用户")?;
    protected_install()?;
    if Path::new(JOURNAL).symlink_metadata().is_ok() {
        return Err("上次 TUN 清理尚未完成，请先由原用户恢复网络；没有覆盖残留记录".into());
    }
    if let Ok(meta) = fs::symlink_metadata(RUNTIME) {
        if !meta.is_dir() || meta.file_type().is_symlink() || meta.uid() != owner {
            return Err("TUN 运行目录属于其他用户或状态异常，请管理员核查；没有接管该目录".into());
        }
    }
    let result = Command::new("/usr/bin/systemd-run")
        .env_clear()
        .env("PATH", "/usr/sbin:/usr/bin")
        .env("LC_ALL", "C")
        .args([
            "--unit=crossbow-tun",
            "--collect",
            "--quiet",
            "--service-type=exec",
        ])
        .arg(format!("--property=User={owner}"))
        .args([
            "--property=AmbientCapabilities=CAP_NET_ADMIN",
            "--property=CapabilityBoundingSet=CAP_NET_ADMIN",
            "--property=NoNewPrivileges=yes",
            "--property=ProtectSystem=full",
            "--property=PrivateTmp=yes",
            "--property=RuntimeDirectory=crossbow-tun",
            "--property=RuntimeDirectoryMode=0700",
            "--property=RuntimeDirectoryPreserve=yes",
            "--property=KillMode=control-group",
            "--property=TimeoutStopSec=10",
            "--property=UMask=0077",
            "--property=ExecStopPost=/usr/lib/crossbow/crossbow-service --cleanup",
            SERVICE,
            "--serve",
        ])
        .output()
        .map_err(|e| format!("启动系统服务失败：{e}"))?;
    if !result.status.success() {
        return Err(format!(
            "启动系统服务失败：{}",
            String::from_utf8_lossy(&result.stderr).trim()
        ));
    }
    Ok(())
}

fn own_directory(path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_dir()
        || meta.file_type().is_symlink()
        || meta.uid() != uid()
        || meta.mode() & 0o077 != 0
    {
        return Err(format!("运行目录权限不正确：{}", path.display()));
    }
    Ok(())
}

fn peer_uid(stream: &UnixStream) -> Result<u32, String> {
    let mut credentials: libc::ucred = unsafe { std::mem::zeroed() };
    let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    if unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&mut credentials as *mut libc::ucred).cast(),
            &mut len,
        )
    } != 0
    {
        return Err(std::io::Error::last_os_error().to_string());
    }
    if len as usize != std::mem::size_of::<libc::ucred>() {
        return Err("invalid peer credentials".into());
    }
    Ok(credentials.uid)
}

fn reply(stream: &mut UnixStream, value: Value) -> Result<(), String> {
    let mut bytes = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    stream.write_all(&bytes).map_err(|e| e.to_string())
}

/// Preserve partial frames across the short socket timeout used by the watchdog.
fn read_frame(stream: &mut UnixStream, buffer: &mut Vec<u8>) -> Result<Option<Value>, String> {
    loop {
        let mut byte = [0];
        match stream.read(&mut byte) {
            Ok(0) => return Err("desktop disconnected".into()),
            Ok(_) if byte[0] == b'\n' => {
                let value = serde_json::from_slice(buffer).map_err(|_| "invalid request JSON")?;
                buffer.clear();
                return Ok(Some(value));
            }
            Ok(_) => {
                if buffer.len() >= FRAME_LIMIT {
                    return Err("request too large".into());
                }
                buffer.push(byte[0]);
            }
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                return Ok(None)
            }
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => return Ok(None),
            Err(e) => return Err(e.to_string()),
        }
    }
}

fn read_limited(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let file = File::open(path).map_err(|e| format!("读取 {} 失败：{e}", path.display()))?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("source must be a regular file".into());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("file too large".into());
    }
    Ok(bytes)
}

fn controlled_config(
    bytes: &[u8],
) -> Result<(String, Vec<String>, SocketAddr, String, u16), String> {
    if bytes.len() as u64 > crate::policy::MAX_CONFIG {
        return Err("config too large".into());
    }
    let mut document: serde_yaml::Value =
        serde_yaml::from_slice(bytes).map_err(|_| "invalid config YAML")?;
    document.apply_merge().map_err(|_| "invalid YAML merge")?;
    let normalized = serde_yaml::to_string(&document).map_err(|e| e.to_string())?;
    let (base, paths) = crate::policy::config(normalized.as_bytes())?;
    let mut value: serde_yaml::Value = serde_yaml::from_str(&base).map_err(|e| e.to_string())?;
    let root = value.as_mapping_mut().ok_or("config must be a mapping")?;
    let key = serde_yaml::Value::from;
    let controller: SocketAddr = root[&key("external-controller")]
        .as_str()
        .ok_or("controller missing")?
        .parse()
        .map_err(|_| "invalid controller")?;
    let secret = root[&key("secret")]
        .as_str()
        .ok_or("secret missing")?
        .to_owned();
    if secret.len() > 128
        || !secret
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("invalid controller secret".into());
    }
    let mixed = root
        .get(key("mixed-port"))
        .and_then(serde_yaml::Value::as_u64)
        .filter(|port| (1024..=65535).contains(port))
        .ok_or("invalid mixed port")?;
    if controller.port() < 1024 || controller.port() == mixed as u16 {
        return Err("invalid controller port".into());
    }
    for name in [
        "listeners",
        "tunnels",
        "port",
        "socks-port",
        "redir-port",
        "tproxy-port",
        "tuic-server",
        "ss-config",
        "vmess-config",
        "iptables",
        "ebpf",
        "ntp",
        "interface-name",
        "external-controller-cors",
        "external-doh-server",
        "external-controller-routing-mark",
    ] {
        root.remove(key(name));
    }
    root.insert(key("allow-lan"), serde_yaml::Value::Bool(false));
    root.insert(key("bind-address"), key("127.0.0.1"));
    root.insert(key("routing-mark"), serde_yaml::Value::from(MARK));
    root.insert(key("ipv6"), serde_yaml::Value::Bool(true));
    // mihomo 1.19.32 / sing-tun 0.4.27 installs IPv6 routes and an oif rule even
    // with auto-route=false if Inet6Address is nonempty. gvisor still forwards
    // IPv6 with an empty list; this service owns both families' routes instead.
    let tun = json!({"enable":true,"device":DEVICE,"stack":"gvisor","auto-route":false,
        "auto-redirect":false,"auto-detect-interface":true,"dns-mode":"disabled",
        "dns-hijack":["any:53","tcp://any:53"],"inet6-address":[]});
    root.insert(
        key("tun"),
        serde_yaml::to_value(tun).map_err(|e| e.to_string())?,
    );
    // Keep upstream DNS choices, but never let the service bind another DNS listener.
    let dns = root
        .entry(key("dns"))
        .or_insert_with(|| serde_yaml::Value::Mapping(Default::default()));
    if !dns.is_mapping() {
        return Err("dns must be a mapping".into());
    }
    let dns = dns.as_mapping_mut().unwrap();
    dns.remove(key("listen"));
    dns.insert(key("enable"), serde_yaml::Value::Bool(true));
    dns.insert(key("enhanced-mode"), key("fake-ip"));
    dns.entry(key("nameserver"))
        .or_insert_with(|| serde_yaml::to_value(["https://1.1.1.1/dns-query"]).unwrap());
    let text = serde_yaml::to_string(&value).map_err(|e| e.to_string())?;
    Ok((text, paths, controller, secret, mixed as u16))
}

fn ensure_ports_available(addresses: &[SocketAddr]) -> Result<(), String> {
    let mut listeners = Vec::with_capacity(addresses.len());
    for address in addresses {
        listeners.push(
            TcpListener::bind(address)
                .map_err(|e| format!("内核监听端口 {address} 已被占用或不可用：{e}"))?,
        );
    }
    Ok(())
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(|e| e.to_string())?;
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.uid() != uid() || meta.mode() & 0o077 != 0 {
        return Err("runtime file has unsafe permissions".into());
    }
    file.set_len(0)
        .and_then(|()| file.write_all(bytes))
        .and_then(|()| file.sync_all())
        .map_err(|e| e.to_string())
}

fn prepare(request: &Value) -> Result<(SocketAddr, String, File), String> {
    let config = request["config"]
        .as_str()
        .map(Path::new)
        .filter(|p| p.is_absolute())
        .ok_or("config must be an absolute path")?;
    let log = request["log"]
        .as_str()
        .map(Path::new)
        .filter(|p| p.is_absolute())
        .ok_or("log must be an absolute path")?;
    let bytes = read_limited(config, crate::policy::MAX_CONFIG)?;
    let (yaml, mut paths, controller, secret, mixed) = controlled_config(&bytes)?;
    fs::create_dir(SESSION).map_err(|e| format!("建立 TUN 工作目录失败：{e}"))?;
    fs::set_permissions(SESSION, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    own_directory(Path::new(SESSION))?;
    let base = config.parent().ok_or("missing configuration directory")?;
    paths.extend(
        [
            "GeoIP.dat",
            "GeoSite.dat",
            "geoip.metadb",
            "geosite.db",
            "country.mmdb",
            "Country.mmdb",
            "ASN.mmdb",
        ]
        .map(str::to_string),
    );
    paths.sort();
    paths.dedup();
    let mut total = 0usize;
    for relative in paths {
        let source = base.join(&relative);
        let bytes = match read_limited(&source, crate::policy::MAX_ASSET) {
            Ok(bytes) => bytes,
            Err(_) if !source.exists() => continue,
            Err(e) => return Err(e),
        };
        total += bytes.len();
        if total > 128 * 1024 * 1024 {
            return Err("provider assets too large".into());
        }
        let output = Path::new(SESSION).join(relative);
        fs::create_dir_all(output.parent().unwrap()).map_err(|e| e.to_string())?;
        write_private(&output, &bytes)?;
    }
    write_private(&Path::new(SESSION).join("runtime.yaml"), yaml.as_bytes())?;
    // This process has the requesting user's filesystem privileges, never root's.
    let log = OpenOptions::new()
        .create(true)
        .write(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(log)
        .map_err(|e| e.to_string())?;
    let meta = log.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.uid() != uid() {
        return Err("log must be a user-owned regular file".into());
    }
    log.set_len(0).map_err(|e| e.to_string())?;
    ensure_ports_available(&[SocketAddr::from((Ipv4Addr::LOCALHOST, mixed)), controller])?;
    Ok((controller, secret, log))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Resource {
    Route(u8, usize),
    Rule(u8),
}
const V4: &[&str] = &[
    "default",
    "10.0.0.0/8",
    "100.64.0.0/10",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "224.0.0.0/4",
    "255.255.255.255/32",
];
const V6: &[&str] = &["default", "::1/128", "fc00::/7", "fe80::/10", "ff00::/8"];
impl Resource {
    fn id(self) -> String {
        match self {
            Self::Route(f, i) => format!("{f}:route:{i}"),
            Self::Rule(f) => format!("{f}:rule"),
        }
    }
    fn all() -> Vec<Self> {
        [4, 6]
            .into_iter()
            .flat_map(|f| (0..prefixes(f).len()).map(move |i| Self::Route(f, i)))
            .chain([Self::Rule(4), Self::Rule(6)])
            .collect()
    }
    fn parse(id: &str) -> Option<Self> {
        Self::all().into_iter().find(|r| r.id() == id)
    }
    fn family(self) -> u8 {
        match self {
            Self::Route(f, _) | Self::Rule(f) => f,
        }
    }
    fn args(self, action: &str) -> Vec<String> {
        let mut args = vec![format!("-{}", self.family())];
        match self {
            Self::Rule(_) => args.extend([
                "rule".into(),
                action.into(),
                "not".into(),
                "from".into(),
                "all".into(),
                "fwmark".into(),
                MARK.to_string(),
                "table".into(),
                TABLE.to_string(),
                "priority".into(),
                PRIORITY.to_string(),
                "protocol".into(),
                PROTOCOL.to_string(),
            ]),
            Self::Route(f, index) => {
                args.extend(["route".into(), action.into()]);
                if index != 0 {
                    args.push("throw".into());
                }
                args.push(prefixes(f)[index].into());
                if index == 0 {
                    args.extend(["dev".into(), DEVICE.into()]);
                }
                args.extend([
                    "table".into(),
                    TABLE.to_string(),
                    "proto".into(),
                    PROTOCOL.to_string(),
                ]);
                if f == 6 {
                    args.extend(["metric".into(), "1024".into()]);
                }
            }
        }
        args
    }
    fn matches(self, row: &Value) -> bool {
        let number = |key: &str, n: u32| {
            row[key].as_u64() == Some(n as u64)
                || row[key].as_str().and_then(|s| s.parse::<u32>().ok()) == Some(n)
        };
        if !number("protocol", PROTOCOL) {
            return false;
        }
        match self {
            Self::Rule(_) => {
                number("priority", PRIORITY)
                    && number("table", TABLE)
                    && row.get("not").is_some()
                    && row["src"] == "all"
                    && row["fwmark"] == format!("0x{MARK:x}")
                    && row.get("fwmask").is_none_or(|mask| mask == "0xffffffff")
                    && row.as_object().is_some_and(|m| {
                        m.keys().all(|key| {
                            matches!(
                                key.as_str(),
                                "priority"
                                    | "table"
                                    | "protocol"
                                    | "not"
                                    | "fwmark"
                                    | "fwmask"
                                    | "src"
                            )
                        })
                    })
            }
            Self::Route(f, index) => {
                let prefix = prefixes(f)[index];
                // iproute2 omits the host-length suffix in its JSON output.
                let printed = prefix
                    .strip_suffix(if f == 4 { "/32" } else { "/128" })
                    .unwrap_or(prefix);
                row["dst"] == printed
                    && row.as_object().is_some_and(|m| {
                        m.keys().all(|key| {
                            matches!(
                                key.as_str(),
                                "dst"
                                    | "dev"
                                    | "protocol"
                                    | "scope"
                                    | "flags"
                                    | "metric"
                                    | "pref"
                                    | "type"
                                    | "table"
                            )
                        })
                    })
                    && if f == 6 {
                        number("metric", 1024)
                    } else {
                        row.get("metric").is_none_or(|metric| metric == 0)
                    }
                    && if index == 0 {
                        row["dev"] == DEVICE && row.get("type").is_none_or(|kind| kind == "unicast")
                    } else {
                        row["type"] == "throw"
                            && if f == 6 {
                                row["dev"] == "lo"
                            } else {
                                row.get("dev").is_none()
                            }
                    }
            }
        }
    }
    fn exists(self) -> Result<bool, String> {
        self.exists_in(&resource_rows(
            self.family(),
            matches!(self, Self::Rule(_)),
        )?)
    }
    fn exists_in(self, rows: &[Value]) -> Result<bool, String> {
        let table = TABLE.to_string();
        let count = rows
            .iter()
            .filter(|row| {
                let in_table = matches!(self, Self::Rule(_))
                    || row["table"] == table
                    || row["table"].as_u64() == Some(TABLE as u64);
                in_table && self.matches(row)
            })
            .count();
        if count > 1 {
            return Err("发现重复网络资源，保留记录供核查".into());
        }
        Ok(count == 1)
    }
}
fn prefixes(family: u8) -> &'static [&'static str] {
    if family == 4 {
        V4
    } else {
        V6
    }
}
fn resource_rows(family: u8, rule: bool) -> Result<Vec<Value>, String> {
    let family = format!("-{family}");
    let args = if rule {
        vec![family.as_str(), "-j", "rule", "show"]
    } else {
        vec![family.as_str(), "-j", "route", "show", "table", "all"]
    };
    serde_json::from_str(&network::ip(&args)?).map_err(|e| e.to_string())
}
fn change(resource: Resource, action: &str) -> Result<(), String> {
    let args = resource.args(action);
    network::ip(&args.iter().map(String::as_str).collect::<Vec<_>>()).map(|_| ())
}

struct Journal {
    ifindex: u32,
    resources: Vec<Resource>,
    pending: Option<Resource>,
}
impl Journal {
    fn decode(bytes: &[u8]) -> Result<Self, String> {
        let value: Value = serde_json::from_slice(bytes).map_err(|_| "网络恢复记录损坏")?;
        if value["version"] != 1 || value["uid"] != uid() {
            return Err("网络恢复记录不属于当前服务用户".into());
        }
        let ifindex = value["ifindex"]
            .as_u64()
            .and_then(|n| u32::try_from(n).ok())
            .filter(|n| *n > 0)
            .ok_or("invalid interface record")?;
        let mut resources = Vec::new();
        for id in value["resources"].as_array().ok_or("invalid resources")? {
            let resource = id
                .as_str()
                .and_then(Resource::parse)
                .ok_or("unknown resource in journal")?;
            if resources.contains(&resource) {
                return Err("duplicate journal resource".into());
            }
            resources.push(resource);
        }
        let pending = if value["pending"].is_null() {
            None
        } else {
            Some(
                value["pending"]
                    .as_str()
                    .and_then(Resource::parse)
                    .ok_or("invalid pending resource")?,
            )
        };
        Ok(Self {
            ifindex,
            resources,
            pending,
        })
    }
    fn save(&self) -> Result<(), String> {
        let value = json!({"version":1,"uid":uid(),"ifindex":self.ifindex,
            "resources":self.resources.iter().map(|r|r.id()).collect::<Vec<_>>(),"pending":self.pending.map(Resource::id)});
        let temp = Path::new(RUNTIME).join("network.json.tmp");
        write_private(
            &temp,
            &serde_json::to_vec(&value).map_err(|e| e.to_string())?,
        )?;
        fs::rename(&temp, JOURNAL).map_err(|e| e.to_string())?;
        File::open(RUNTIME)
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())
    }
    fn install(&mut self) -> Result<(), String> {
        self.save()?;
        for resource in Resource::all() {
            self.install_one(
                resource,
                || resource.exists(),
                || change(resource, "add"),
                Self::save,
            )?;
        }
        Ok(())
    }
    fn install_one(
        &mut self,
        resource: Resource,
        exists: impl FnOnce() -> Result<bool, String>,
        add: impl FnOnce() -> Result<(), String>,
        mut save: impl FnMut(&Self) -> Result<(), String>,
    ) -> Result<(), String> {
        if exists()? {
            return Err("所需网络资源已存在，没有接管该资源".into());
        }
        self.pending = Some(resource);
        save(self)?;
        if let Err(error) = add() {
            // An unsuccessful add (notably EEXIST) does not establish ownership.
            self.pending = None;
            save(self).map_err(|persist| format!("{error}；恢复记录保存失败：{persist}"))?;
            return Err(error);
        }
        self.resources.push(resource);
        self.pending = None;
        save(self)
    }
}

fn cleanup() -> Result<(), String> {
    if !Path::new(RUNTIME).exists() {
        return Ok(());
    }
    own_directory(Path::new(RUNTIME))?;
    if Path::new(JOURNAL).symlink_metadata().is_ok() {
        let mut file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(JOURNAL)
            .map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        Read::by_ref(&mut file)
            .take(65537)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 65536 {
            return Err("network journal too large".into());
        }
        let mut journal = Journal::decode(&bytes)?;
        if network::device_index()?.is_some_and(|index| index != journal.ifindex) {
            return Err("Crossbow 接口身份已变化，没有删除其他接口或网络记录".into());
        }
        while let Some(resource) = journal.resources.last().copied() {
            if resource.exists()? {
                change(resource, "del")?;
                if resource.exists()? {
                    return Err("网络资源尚未移除，保留恢复记录".into());
                }
            }
            journal.resources.pop();
            journal.save()?;
        }
        // An intent recorded before `ip add` is not proof that the add succeeded.
        // In the crash window, prefer an explicit recovery error to deleting a
        // resource another network manager might have created concurrently.
        if let Some(pending) = journal.pending {
            if pending.exists()? {
                return Err(
                    "网络恢复记录含有未确认创建的资源，已保留；请管理员核查并恢复后重试".into(),
                );
            }
            journal.pending = None;
            journal.save()?;
        }
        if network::device_index()? == Some(journal.ifindex) {
            network::ip(&["link", "delete", "dev", DEVICE])?;
        }
        fs::remove_file(JOURNAL).map_err(|e| e.to_string())?;
    }
    if Path::new(SESSION).symlink_metadata().is_ok() {
        own_directory(Path::new(SESSION))?;
        fs::remove_dir_all(SESSION).map_err(|e| e.to_string())?;
    }
    Ok(())
}

struct Session {
    child: Option<Child>,
    ifindex: Option<u32>,
}
impl Session {
    fn new() -> Self {
        Self {
            child: None,
            ifindex: None,
        }
    }
    fn start(&mut self, request: &Value) -> Result<(), String> {
        network::ensure_available(None, &[std::process::id()])?;
        let (controller, secret, log) = prepare(request)?;
        let stderr = log.try_clone().map_err(|e| e.to_string())?;
        let child = Command::new(CORE)
            .args([
                "-d",
                SESSION,
                "-f",
                "/run/crossbow-tun/session/runtime.yaml",
            ])
            .current_dir(SESSION)
            .env_clear()
            // Older pinned cores ignore dns-mode and discover resolvectl through
            // PATH. Only the two installed binaries are in this root-owned dir.
            .env("PATH", INSTALL)
            .env("HOME", SESSION)
            .env("LC_ALL", "C")
            .stdin(Stdio::null())
            .stdout(log)
            .stderr(stderr)
            .spawn()
            .map_err(|e| format!("启动 mihomo 失败：{e}"))?;
        self.child = Some(child);
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            if STOP.load(Ordering::Relaxed) {
                return Err("服务正在停止".into());
            }
            if self
                .child
                .as_mut()
                .unwrap()
                .try_wait()
                .map_err(|e| e.to_string())?
                .is_some()
            {
                return Err("mihomo 在就绪前退出，请查看内核日志".into());
            }
            if let Some(index) = network::device_index()? {
                if self.ifindex != Some(index) {
                    self.ifindex = Some(index);
                    // Record interface identity before waiting for the controller.
                    Journal {
                        ifindex: index,
                        resources: Vec::new(),
                        pending: None,
                    }
                    .save()?;
                }
                if controller_ready(controller, &secret) {
                    break;
                }
            }
            if Instant::now() >= deadline {
                return Err("等待 TUN 设备和内核控制器超时".into());
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        network::ensure_available(
            self.ifindex,
            &[std::process::id(), self.child.as_ref().unwrap().id()],
        )?;
        Journal {
            ifindex: self.ifindex.unwrap(),
            resources: Vec::new(),
            pending: None,
        }
        .install()?;
        Ok(())
    }
    fn stop(&mut self) -> Result<(), String> {
        if let Some(child) = self.child.as_mut() {
            if child.try_wait().map_err(|e| e.to_string())?.is_none() {
                unsafe {
                    libc::kill(child.id() as i32, libc::SIGTERM);
                }
                let deadline = Instant::now() + Duration::from_secs(5);
                loop {
                    if child.try_wait().map_err(|e| e.to_string())?.is_some() {
                        break;
                    }
                    if Instant::now() >= deadline {
                        child.kill().map_err(|e| format!("停止内核失败：{e}"))?;
                        let deadline = Instant::now() + Duration::from_secs(2);
                        loop {
                            if child.try_wait().map_err(|e| e.to_string())?.is_some() {
                                break;
                            }
                            if Instant::now() >= deadline {
                                return Err("内核未确认退出，保留会话和恢复记录".into());
                            }
                            std::thread::sleep(Duration::from_millis(50));
                        }
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
            }
            self.child = None;
        }
        cleanup()?;
        self.ifindex = None;
        Ok(())
    }
    fn status(&self) -> Value {
        json!({"ok":true,"active":self.child.is_some(),"pid":self.child.as_ref().map(Child::id),"ifindex":self.ifindex,"stopped":self.child.is_none() && self.ifindex.is_none()})
    }
    fn verify_network(&self) -> Result<(), String> {
        let expected = self.ifindex.ok_or("TUN 尚未就绪")?;
        if network::device_index()? != Some(expected) {
            return Err("TUN 接口已消失或身份发生变化".into());
        }
        for family in [4, 6] {
            let routes = resource_rows(family, false)?;
            let rules = resource_rows(family, true)?;
            for resource in Resource::all().into_iter().filter(|r| r.family() == family) {
                let rows = if matches!(resource, Resource::Rule(_)) {
                    &rules
                } else {
                    &routes
                };
                if !resource.exists_in(rows)? {
                    return Err("TUN 路由已变化，正在退出本次接管".into());
                }
            }
        }
        Ok(())
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        if let Err(error) = self.stop() {
            eprintln!("TUN cleanup incomplete: {error}");
        }
    }
}

fn controller_ready(address: SocketAddr, secret: &str) -> bool {
    let Ok(mut socket) = TcpStream::connect_timeout(&address, Duration::from_millis(200)) else {
        return false;
    };
    let _ = socket.set_read_timeout(Some(Duration::from_millis(200)));
    let _ = socket.set_write_timeout(Some(Duration::from_millis(200)));
    if write!(socket, "GET /version HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {secret}\r\nConnection: close\r\n\r\n").is_err() { return false; }
    let mut response = [0; 128];
    socket
        .read(&mut response)
        .ok()
        .is_some_and(|n| response[..n].starts_with(b"HTTP/1.1 200"))
}

/// true means a normal stop: retain the authorized unit briefly for a restart.
fn connection(mut stream: UnixStream) -> Result<bool, String> {
    if peer_uid(&stream)? != uid() {
        return Err("service belongs to another user".into());
    }
    stream
        .set_read_timeout(Some(Duration::from_millis(500)))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(3)))
        .map_err(|e| e.to_string())?;
    let mut buffer = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(10);
    let request = loop {
        if STOP.load(Ordering::Relaxed) || Instant::now() >= deadline {
            return Err("first request timed out".into());
        }
        if let Some(request) = read_frame(&mut stream, &mut buffer)? {
            break request;
        }
    };
    let mut session = Session::new();
    match request["cmd"].as_str() {
        Some("status") => {
            cleanup()?;
            reply(&mut stream, session.status())?;
            return Ok(true);
        }
        Some("stop") => {
            session.stop()?;
            reply(&mut stream, json!({"ok":true,"stopped":true}))?;
            return Ok(true);
        }
        Some("start") => {}
        _ => {
            reply(
                &mut stream,
                json!({"ok":false,"error":"unknown command","stopped":true}),
            )?;
            return Ok(true);
        }
    }
    if let Err(error) = session.start(&request) {
        let recovery = session.stop();
        let stopped = recovery.is_ok();
        let error = match recovery {
            Ok(()) => error,
            Err(recovery) => format!("{error}；清理尚未完成：{recovery}"),
        };
        reply(
            &mut stream,
            json!({"ok":false,"error":error,"stopped":stopped}),
        )?;
        if stopped {
            return Ok(true);
        }
    } else {
        session.verify_network()?;
        reply(&mut stream, session.status())?;
    }
    loop {
        if STOP.load(Ordering::Relaxed) {
            session.stop()?;
            return Ok(false);
        }
        if let Some(child) = session.child.as_mut() {
            let pid = child.id();
            if child.try_wait().map_err(|e| e.to_string())?.is_some() {
                session.stop()?;
                let _ = reply(
                    &mut stream,
                    json!({"ok":false,"error":"mihomo exited","stopped":true}),
                );
                return Ok(false);
            }
            if let Err(error) =
                network::ensure_available(session.ifindex, &[std::process::id(), pid])
            {
                let recovery = session.stop();
                let _ = reply(
                    &mut stream,
                    json!({"ok":false,"error":error,"stopped":recovery.is_ok()}),
                );
                recovery?;
                return Ok(false);
            }
            if let Err(error) = session.verify_network() {
                let recovery = session.stop();
                let _ = reply(
                    &mut stream,
                    json!({"ok":false,"error":error,"stopped":recovery.is_ok()}),
                );
                recovery?;
                return Ok(false);
            }
        }
        match read_frame(&mut stream, &mut buffer) {
            Ok(Some(request)) => match request["cmd"].as_str() {
                Some("status") => reply(&mut stream, session.status())?,
                Some("stop") => match session.stop() {
                    Ok(()) => {
                        reply(&mut stream, json!({"ok":true,"stopped":true}))?;
                        return Ok(true);
                    }
                    Err(error) => reply(
                        &mut stream,
                        json!({"ok":false,"error":error,"stopped":false}),
                    )?,
                },
                _ => reply(&mut stream, json!({"ok":false,"error":"unknown command"}))?,
            },
            Ok(None) => {}
            Err(_) => {
                session.stop()?;
                return Ok(false);
            }
        }
    }
}

fn serve() -> Result<(), String> {
    own_directory(Path::new(RUNTIME))?;
    protected_install()?;
    cleanup()?;
    unsafe {
        libc::signal(
            libc::SIGTERM,
            stop_signal as *const () as libc::sighandler_t,
        );
        libc::signal(libc::SIGINT, stop_signal as *const () as libc::sighandler_t);
        libc::umask(0o077);
    }
    // A fixed systemd singleton owns this socket; never unlink another live server.
    if Path::new(SOCKET).symlink_metadata().is_ok() {
        if UnixStream::connect(SOCKET).is_ok() {
            return Err("TUN service already running".into());
        }
        let meta = fs::symlink_metadata(SOCKET).map_err(|e| e.to_string())?;
        if meta.uid() != uid() || meta.file_type().is_symlink() {
            return Err("invalid service socket".into());
        }
        fs::remove_file(SOCKET).map_err(|e| e.to_string())?;
    }
    let listener = UnixListener::bind(SOCKET).map_err(|e| e.to_string())?;
    fs::set_permissions(SOCKET, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let mut idle = Instant::now();
    let result = loop {
        if STOP.load(Ordering::Relaxed) || idle.elapsed() >= Duration::from_secs(30) {
            break Ok(());
        }
        match listener.accept() {
            Ok((stream, _)) => match connection(stream) {
                Ok(true) => idle = Instant::now(),
                Ok(false) => break Ok(()),
                Err(error) => break Err(error),
            },
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100))
            }
            Err(error) => break Err(error.to_string()),
        }
    };
    let _ = fs::remove_file(SOCKET);
    let recovered = cleanup();
    result.and(recovered)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn base() -> &'static str {
        "mixed-port: 19080\nexternal-controller: 127.0.0.1:19090\nsecret: abcdef0123456789abcdef\nrules: [MATCH,DIRECT]\n"
    }
    #[test]
    fn privileged_config_replaces_network_controls_after_yaml_merge() {
        let input = format!("{}defaults: &d {{auto-route: true, auto-redirect: true, device: foreign}}\ntun: {{<<: *d}}\nlisteners: [{{type: tun, name: extra}}]\niptables: {{enable: true}}\nrouting-mark: 1\nallow-lan: true\ndns: {{enable: false, listen: '0.0.0.0:53', nameserver: ['https://example.invalid/dns']}}\n", base());
        let (output, _, _, _, _) = controlled_config(input.as_bytes()).unwrap();
        let value: serde_yaml::Value = serde_yaml::from_str(&output).unwrap();
        assert_eq!(value["tun"]["device"].as_str(), Some(DEVICE));
        assert_eq!(value["tun"]["auto-route"].as_bool(), Some(false));
        assert_eq!(value["tun"]["auto-redirect"].as_bool(), Some(false));
        assert!(value["tun"]["inet6-address"]
            .as_sequence()
            .unwrap()
            .is_empty());
        assert_eq!(value["routing-mark"].as_u64(), Some(MARK as u64));
        assert_eq!(value["allow-lan"].as_bool(), Some(false));
        assert!(value["listeners"].is_null() && value["iptables"].is_null());
        assert!(value["dns"]["listen"].is_null());
        assert_eq!(
            value["dns"]["nameserver"][0].as_str(),
            Some("https://example.invalid/dns")
        );
    }
    #[test]
    fn config_rejects_unsafe_provider_and_controller_inputs() {
        assert!(controlled_config(
            format!("{}rule-providers: {{bad: {{path: ../outside}}}}", base()).as_bytes()
        )
        .is_err());
        assert!(controlled_config(base().replace("127.0.0.1", "0.0.0.0").as_bytes()).is_err());
        assert!(controlled_config(base().replace("19080", "80").as_bytes()).is_err());
        assert!(controlled_config(
            base()
                .replace("abcdef0123456789abcdef", "bad secret with spaces")
                .as_bytes()
        )
        .is_err());
    }
    #[test]
    fn refuses_occupied_listener_ports_before_starting_core() {
        let occupied = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let address = occupied.local_addr().unwrap();
        assert!(ensure_ports_available(&[address]).is_err());
        drop(occupied);
        assert!(ensure_ports_available(&[address]).is_ok());
        assert!(ensure_ports_available(&[address, address]).is_err());
    }
    #[test]
    fn resource_ledger_cannot_request_arbitrary_routes_or_owners() {
        let valid = json!({"version":1,"uid":uid(),"ifindex":7,"resources":["4:route:0","4:rule"],"pending":null});
        assert!(Journal::decode(valid.to_string().as_bytes()).is_ok());
        let mut invalid = valid.clone();
        invalid["uid"] = json!(uid().wrapping_add(1));
        assert!(Journal::decode(invalid.to_string().as_bytes()).is_err());
        let mut invalid = valid.clone();
        invalid["resources"] = json!(["4:route:999"]);
        assert!(Journal::decode(invalid.to_string().as_bytes()).is_err());
        for resource in Resource::all() {
            let args = resource.args("del");
            assert!(!args.iter().any(|arg| arg == "flush"));
            assert!(args.contains(&TABLE.to_string()) && args.contains(&PROTOCOL.to_string()));
        }
        let own = json!({"src":"all","not":null,"fwmark":format!("0x{MARK:x}"),"priority":PRIORITY,"table":TABLE.to_string(),"protocol":PROTOCOL.to_string()});
        assert!(Resource::Rule(4).matches(&own));
        let mut foreign = own.clone();
        foreign["iif"] = json!("wg-work");
        assert!(!Resource::Rule(4).matches(&foreign));
        let mut foreign = own;
        foreign["table"] = json!(52);
        assert!(!Resource::Rule(4).matches(&foreign));
    }
    #[test]
    fn failed_add_never_records_another_owners_resource() {
        let old = Resource::Route(4, 0);
        let candidate = Resource::Rule(4);
        let mut journal = Journal {
            ifindex: 7,
            resources: vec![old],
            pending: None,
        };
        let mut saved = Vec::new();
        let result = journal.install_one(
            candidate,
            || Ok(false),
            || Err("EEXIST".into()),
            |state| {
                saved.push((state.resources.clone(), state.pending));
                Ok(())
            },
        );
        assert!(result.is_err());
        assert_eq!(journal.resources, [old]);
        assert_eq!(journal.pending, None);
        assert_eq!(saved.last(), Some(&(vec![old], None)));
        let result = journal.install_one(
            candidate,
            || Ok(true),
            || panic!("must not add an existing resource"),
            |_| panic!("must not record an existing resource"),
        );
        assert!(result.is_err());
    }
    #[test]
    fn exact_resource_presence_rejects_removed_replaced_or_duplicate_routes() {
        let route = Resource::Route(6, 0);
        let expected = json!({"dst":"default","dev":DEVICE,"table":TABLE,
            "protocol":PROTOCOL.to_string(),"metric":1024,"pref":"medium","flags":[]});
        assert!(route.exists_in(std::slice::from_ref(&expected)).unwrap());
        assert!(!route.exists_in(&[]).unwrap());
        let mut replaced = expected.clone();
        replaced["dev"] = json!("wg-work");
        assert!(!route.exists_in(&[replaced]).unwrap());
        let mut replaced = expected.clone();
        replaced["protocol"] = json!(99);
        assert!(!route.exists_in(&[replaced]).unwrap());
        let mut replaced = expected.clone();
        replaced["gateway"] = json!("2001:db8::1");
        assert!(!route.exists_in(&[replaced]).unwrap());
        assert!(route.exists_in(&[expected.clone(), expected]).is_err());
    }
    #[test]
    fn matches_iproute2_host_and_ipv6_throw_output() {
        // Captured in an isolated user/network namespace with iproute2.
        let v4 = json!({"type":"throw","dst":"255.255.255.255","table":"20220",
            "protocol":"242","flags":[]});
        let v6 = json!({"type":"throw","dst":"::1","dev":"lo","table":"20220",
            "protocol":"242","metric":1024,"flags":[],"pref":"medium"});
        assert!(Resource::Route(4, 8).exists_in(&[v4]).unwrap());
        assert!(Resource::Route(6, 1)
            .exists_in(std::slice::from_ref(&v6))
            .unwrap());
        let mut foreign = v6;
        foreign["dev"] = json!("wg-work");
        assert!(!Resource::Route(6, 1).exists_in(&[foreign]).unwrap());
    }
    #[test]
    fn socket_identity_and_partial_frames_are_checked_without_network_changes() {
        let (mut reader, mut writer) = UnixStream::pair().unwrap();
        reader
            .set_read_timeout(Some(Duration::from_millis(10)))
            .unwrap();
        assert_eq!(peer_uid(&reader).unwrap(), uid());
        let mut buffer = Vec::new();
        writer.write_all(b"{\"cmd\":").unwrap();
        assert!(read_frame(&mut reader, &mut buffer).unwrap().is_none());
        writer.write_all(b"\"status\"}\n").unwrap();
        assert_eq!(
            read_frame(&mut reader, &mut buffer).unwrap().unwrap()["cmd"],
            "status"
        );
        writer.write_all(&vec![b'x'; FRAME_LIMIT + 1]).unwrap();
        assert!(read_frame(&mut reader, &mut buffer).is_err());
    }
}
