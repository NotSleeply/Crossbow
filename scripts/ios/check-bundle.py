#!/usr/bin/env python3
"""Check the app/extension pair and, optionally, actual device signing rights."""
import argparse
from datetime import datetime, timezone
from pathlib import Path
import plistlib
import subprocess

APP = 'com.richard.crossbow.ios'
EXTENSION = APP + '.PacketTunnel'
GROUP = 'group.com.richard.crossbow.ios'


def check(condition, message):
    if not condition:
        raise ValueError(message)


def validate(app, signed):
    for bundle, identifier in [(app, APP), (app / 'PlugIns/PacketTunnel.appex', EXTENSION)]:
        check(bundle.is_dir(), f'Missing bundle: {bundle.name}')
        info = plistlib.loads((bundle / 'Info.plist').read_bytes())
        check(info['CFBundleIdentifier'] == identifier, 'Bundle ID mismatch')
        check(info['CrossbowAppGroup'] == GROUP, 'Shared App Group mismatch')
        check((bundle / info['CFBundleExecutable']).is_file(), 'Missing executable')
        if identifier == EXTENSION:
            check(info['NSExtension']['NSExtensionPointIdentifier'] == 'com.apple.networkextension.packet-tunnel', 'Wrong extension point')
        else:
            check(info['CrossbowTunnelID'] == EXTENSION, 'Wrong provider ID')
        if signed:
            subprocess.run(['codesign', '--verify', '--strict', str(bundle)], check=True, capture_output=True)
            entitlements = plistlib.loads(subprocess.run(
                ['codesign', '-d', '--entitlements', ':-', str(bundle)], check=True, capture_output=True).stdout)
            profile = plistlib.loads(subprocess.run(
                ['security', 'cms', '-D', '-i', str(bundle / 'embedded.mobileprovision')], check=True, capture_output=True).stdout)
            for rights in [entitlements, profile['Entitlements']]:
                check(GROUP in rights.get('com.apple.security.application-groups', []), 'App Group is missing from signature or provisioning profile')
                check('packet-tunnel-provider' in rights.get('com.apple.developer.networking.networkextension', []), 'Packet Tunnel entitlement missing')
            check(entitlements['application-identifier'] == profile['TeamIdentifier'][0] + '.' + identifier, 'Signing team/App ID mismatch')
            check(profile['ExpirationDate'] > datetime.now(timezone.utc).replace(tzinfo=None), 'Provisioning profile expired')
        print(f'{identifier}: bundle' + (' and signing' if signed else '') + ' verified')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('app', type=Path)
    parser.add_argument('--signed', action='store_true')
    args = parser.parse_args()
    validate(args.app, args.signed)


if __name__ == '__main__':
    main()
