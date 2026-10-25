"""Fail closed on source, bundle and updater version/asset mismatches."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import tarfile
import tomllib
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def source_version(root=ROOT, tag=None):
    config = json.loads((root / 'apps/desktop/src-tauri/tauri.conf.json').read_text(encoding='utf-8'))
    package = json.loads((root / 'apps/desktop/package.json').read_text(encoding='utf-8'))
    cargo = tomllib.loads((root / 'Cargo.toml').read_text(encoding='utf-8'))
    lock = tomllib.loads((root / 'Cargo.lock').read_text(encoding='utf-8'))
    version = config['version']
    require(re.fullmatch(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?', version), 'Invalid app version')
    require(package['version'] == cargo['workspace']['package']['version'] == version,
            'Tauri, desktop package.json and Cargo workspace versions must agree')
    locked = [p['version'] for p in lock['package'] if p['name'] in ('crossbow-core', 'crossbow-desktop')]
    require(locked == [version, version], 'Cargo.lock package versions do not match app version')
    if tag is not None:
        require(tag == 'v' + version, f'Tag {tag!r} must equal v{version}')
    return version


def check_app(app, version):
    with (app / 'Contents/Info.plist').open('rb') as stream:
        plist = plistlib.load(stream)
    require(plist['CFBundleShortVersionString'] == version, 'Bundle version does not match source/tag')
    executable = app / 'Contents/MacOS' / plist['CFBundleExecutable']
    require(executable.is_file() and executable.stat().st_mode & 0o111,
            'App main executable is missing or not executable')
    sidecar = app / 'Contents/MacOS/mihomo'
    require(sidecar.is_file() and sidecar.stat().st_mode & 0o111,
            'Bundled mihomo is missing or not executable')
    return executable


def check_updater(archive, signature, manifest, app, version, tag, repo):
    check_app(app, version)
    require(archive.is_file() and archive.stat().st_size > 0, 'Updater archive is missing or empty')
    sig = signature.read_text(encoding='utf-8').strip()
    require(bool(sig), 'Updater signature is empty')
    data = json.loads(manifest.read_text(encoding='utf-8'))
    require(data['version'] == version, 'latest.json version mismatch')
    allowed_platforms = {'darwin-aarch64', 'windows-x86_64'}
    require({'darwin-aarch64'} <= set(data['platforms']) <= allowed_platforms,
            'Unexpected updater platform list')
    platform = data['platforms']['darwin-aarch64']
    expected = f'https://github.com/{repo}/releases/download/{tag}/{archive.name}'
    require(platform['url'] == expected and urlparse(expected).scheme == 'https', 'Updater URL mismatch')
    require(platform['signature'] == sig, 'latest.json signature does not match signature file')
    windows = data['platforms'].get('windows-x86_64')
    if windows is not None:
        win_name = f'Crossbow_{version}_x64-setup.exe'
        expected_win = f'https://github.com/{repo}/releases/download/{tag}/{win_name}'
        require(windows['url'] == expected_win and urlparse(expected_win).scheme == 'https',
                'Windows updater URL mismatch')
        require(bool(str(windows['signature']).strip()), 'Windows updater signature is empty')
    # Compare every bundle entry, including permissions/symlinks. A valid signed
    # DMG must not be paired with an older or differently signed updater archive.
    with tarfile.open(archive, 'r:gz') as tar:
        entries = {}
        for member in tar.getmembers():
            name = member.name.removeprefix('./').rstrip('/')
            require(name == app.name or name.startswith(app.name + '/'), 'Unexpected updater archive path')
            relative = Path(name).relative_to(app.name)
            require('..' not in relative.parts, 'Unsafe updater archive path')
            if str(relative) == '.':
                continue
            require(str(relative) not in entries, 'Duplicate updater archive path')
            entries[str(relative)] = member
        actual = {str(p.relative_to(app)): p for p in app.rglob('*')}
        require(set(entries) == set(actual), 'Updater bundle file list differs from packaged app')
        for name, path in actual.items():
            member = entries[name]
            if path.is_symlink():
                require(member.issym() and member.linkname == os.readlink(path), f'Symlink mismatch: {name}')
            elif path.is_file():
                require(member.isfile(), f'Not a regular file: {name}')
                require((member.mode & 0o111) == (path.stat().st_mode & 0o111), f'Executable mode mismatch: {name}')
                stream = tar.extractfile(member)
                require(stream is not None, f'Cannot read archive file: {name}')
                with stream, path.open('rb') as local:
                    require(hashlib.file_digest(stream, 'sha256').digest() == hashlib.file_digest(local, 'sha256').digest(),
                            f'Updater content differs from packaged app: {name}')
            else:
                require(member.isdir() and path.is_dir(), f'Directory mismatch: {name}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['source', 'app', 'updater'])
    parser.add_argument('app', nargs='?', type=Path)
    parser.add_argument('--tag')
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--signature', type=Path)
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--repo', default='Richard-Zhang1019/Crossbow')
    args = parser.parse_args()
    version = source_version(tag=args.tag)
    if args.mode != 'source':
        require(args.app is not None, 'App path required')
        check_app(args.app, version)
    if args.mode == 'updater':
        require(all([args.tag, args.archive, args.signature, args.manifest]), 'Updater check arguments missing')
        check_updater(args.archive, args.signature, args.manifest, args.app, version, args.tag, args.repo)
    print(f'{args.mode} validation passed: {version}')


if __name__ == '__main__':
    main()
