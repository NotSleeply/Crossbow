"""Fetch a pinned sidecar; mirrors must supply exactly the same verified bytes."""
import gzip
import hashlib
import io
import re
from pathlib import Path
import sys
import urllib.request
import zipfile

VERSION = 'v1.19.32'
# GitHub release asset digests, reviewed against MetaCubeX/mihomo v1.19.32.
ASSETS = {
    'aarch64-apple-darwin': ('mihomo-darwin-arm64-v1.19.32.gz',
        '3312a6780652c622890fd4357c6a853bbf865464fd047ac7b7f52dab8de18652'),
    'x86_64-pc-windows-msvc': ('mihomo-windows-amd64-v1.19.32.zip',
        '1ac84e795b5b915446e20139677fb6cc013a0778e876e8d4c96f994750b4c4a3'),
}
ROOT = Path(__file__).resolve().parents[2]


def verify(data, expected):
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError('Sidecar SHA-256 mismatch')


def main():
    runtime_source = (ROOT / 'apps/desktop/src-tauri/src/core_download.rs').read_text()
    runtime_version = re.search(r'CORE_VERSION: &str = "([^"]+)"', runtime_source)
    if runtime_version is None or runtime_version.group(1) != VERSION:
        raise ValueError('CI sidecar version must match core_download.rs CORE_VERSION')
    target = sys.argv[1]
    asset, digest = ASSETS[target]
    url = f'https://github.com/MetaCubeX/mihomo/releases/download/{VERSION}/{asset}'
    data = None
    for candidate in [url, 'https://gh-proxy.com/' + url]:
        try:
            with urllib.request.urlopen(candidate, timeout=60) as response:
                candidate_data = response.read()
            verify(candidate_data, digest)
            data = candidate_data
            break
        except Exception as error:
            print(f'Sidecar download/verification failed: {error}', file=sys.stderr)
    if data is None:
        raise RuntimeError('No mirror returned the expected sidecar')
    if asset.endswith('.gz'):
        binary = gzip.decompress(data)
    else:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            executables = [name for name in archive.namelist() if name.endswith('.exe')]
            if len(executables) != 1:
                raise ValueError('Expected exactly one sidecar executable')
            binary = archive.read(executables[0])
    destination = ROOT / 'apps/desktop/src-tauri/binaries' / ('mihomo-' + target + ('.exe' if asset.endswith('.zip') else ''))
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(binary)
    destination.chmod(0o755)
    print(f'Verified sidecar: {destination.name}')


if __name__ == '__main__':
    main()
