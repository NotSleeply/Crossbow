"""Package the experimental Linux build without installing a privileged service."""
import argparse
import io
from pathlib import Path
import tarfile

from release_checks import ROOT, source_version


FILES = {
    'crossbow-desktop': ('target/release/crossbow-desktop', 0o755),
    'mihomo': ('apps/desktop/src-tauri/binaries/mihomo-x86_64-unknown-linux-gnu', 0o755),
    'crossbow-service': ('target/release/crossbow-service', 0o755),
    'install-service.sh': ('scripts/linux/install-service.sh', 0o755),
    'org.crossbow.tun.policy': ('scripts/linux/org.crossbow.tun.policy', 0o644),
}
RUN = b'#!/bin/sh\nset -eu\ncd -- "$(dirname -- "$0")"\nexec ./crossbow-desktop "$@"\n'
GUIDE = """Crossbow {version} — Linux x86_64 experimental build

Requires a systemd desktop, GTK3, WebKitGTK 4.1 and AppIndicator runtime libraries.
Built on Ubuntu 24.04 (glibc 2.39 baseline); older distributions may not run it.
Target validation: CachyOS x86_64 + niri/Wayland. This is not an AppImage or DEB.

Extract the whole directory and run ./run.sh as your normal desktop user.
For native Wayland: GDK_BACKEND=wayland ./run.sh
Import a subscription, choose mihomo, and enable Explicit Proxy.
Configure your browser's HTTP/SOCKS proxy manually using the displayed mixed port.
Linux system proxy integration and automatic app updates are not available.

Optional TUN requires systemd, polkit, iproute2, /dev/net/tun and a running polkit
authentication agent. From this extracted directory, explicitly install:
  sudo ./install-service.sh "$PWD/crossbow-service" "$PWD/mihomo"
Then enable TUN in Crossbow and complete authorization. Close other proxy/VPN
tunnels first. Strict rp_filter=1 is rejected; the app never changes sysctls.
Installation does not start a service or change networking.

Before upgrading the service, disable TUN and wait for crossbow-tun.service to stop
(the idle grace period is up to 30 seconds). Replace both binaries together by
running the installer from the newly extracted version. Never run the GUI as root.
Close TUN before removing the installed service. See the repository documentation
for recovery/uninstall steps; do not delete an unresolved network journal.

Checksums detect corruption; this archive is not an updater-signed Linux package.
Report distro, desktop, version and notification details with any issue.
Docs: https://github.com/Richard-Zhang1019/Crossbow/blob/v{version}/docs/LINUX-NETWORK.md
"""


def elf_x64(data, name):
    # ELF64, little-endian, executable/shared-object, EM_X86_64.
    if (len(data) < 64 or data[:6] != b'\x7fELF\x02\x01'
            or int.from_bytes(data[16:18], 'little') not in (2, 3)
            or int.from_bytes(data[18:20], 'little') != 62):
        raise ValueError(f'{name}: expected a Linux x86_64 ELF executable')


def package(root, output, version):
    name = f'Crossbow_{version}_linux_x86_64'
    payloads = {}
    for target, (source, mode) in FILES.items():
        path = root / source
        if path.is_symlink() or not path.is_file():
            raise ValueError(f'Missing regular release file: {source}')
        data = path.read_bytes()
        if mode == 0o755 and not path.stat().st_mode & 0o111:
            raise ValueError(f'Not executable: {source}')
        if target in ('crossbow-desktop', 'crossbow-service', 'mihomo'):
            elf_x64(data, target)
        payloads[target] = (data, mode)
    payloads['run.sh'] = (RUN, 0o755)
    payloads['README.txt'] = (GUIDE.format(version=version).encode(), 0o644)
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f'{name}.tar.gz'
    with tarfile.open(archive, 'w:gz') as tar:
        for filename, (data, mode) in payloads.items():
            entry = tarfile.TarInfo(f'{name}/{filename}')
            entry.size, entry.mode = len(data), mode
            tar.addfile(entry, io.BytesIO(data))
    # Verify the exact uploaded archive, including contents and executable modes.
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        if {m.name for m in members} != {f'{name}/{p}' for p in payloads}:
            raise ValueError('Linux archive file list mismatch')
        for member in members:
            data, mode = payloads[Path(member.name).name]
            if not member.isfile() or member.mode != mode or tar.extractfile(member).read() != data:
                raise ValueError(f'Linux archive content/mode mismatch: {member.name}')
    return archive


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tag', help='Require an exact version for formal releases')
    parser.add_argument('--output', type=Path, default=ROOT / 'dist-linux')
    args = parser.parse_args()
    print(package(ROOT, args.output, source_version(tag=args.tag)))
