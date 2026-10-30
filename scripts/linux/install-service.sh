#!/bin/sh
# Run explicitly as administrator after reviewing/building this checkout.
set -eu
if [ "$(id -u)" != 0 ] || [ "$#" != 2 ]; then
    echo "Usage: sudo $0 /absolute/path/crossbow-service /absolute/path/mihomo" >&2
    exit 1
fi
case "$1:$2" in /*:/*) ;; *) echo 'Both binary paths must be absolute' >&2; exit 1 ;; esac
test -f "$1" && test -x "$1"
test -f "$2" && test -x "$2"
# Never replace the helper/core underneath a live session.
if systemctl is-active --quiet crossbow-tun.service; then
    echo 'Close the Crossbow TUN session before installing its service' >&2
    exit 1
fi
script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
install -d -o root -g root -m 0755 /usr/lib/crossbow
install -o root -g root -m 0755 "$1" /usr/lib/crossbow/crossbow-service
install -o root -g root -m 0755 "$2" /usr/lib/crossbow/mihomo
install -o root -g root -m 0644 "$script_dir/org.crossbow.tun.policy" /usr/share/polkit-1/actions/org.crossbow.tun.policy
echo 'Crossbow service installed. TUN starts only after an explicit desktop request.'
