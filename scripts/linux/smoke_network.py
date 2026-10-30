#!/usr/bin/env python3
"""Exercise the real Linux broker/core inside private user, PID, mount and network namespaces.
No sudo, service installation, host routes, DNS or firewall writes. Requires bubblewrap/iproute2.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import shlex
import signal
import socket
import socketserver
import struct
import subprocess
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
SERVICE = '/usr/lib/crossbow/crossbow-service'
SOCKET = '/run/crossbow-tun/control.sock'


def run(*args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed: {result.stderr.strip()}')
    return result.stdout


def snapshot():
    values = [run('ip', '-j', family, kind, 'show', *(['table', 'all'] if kind == 'route' else []))
              for family in ['-4', '-6'] for kind in ['route', 'rule']]
    values.append(Path('/etc/resolv.conf').read_text())
    return hashlib.sha256('\n'.join(values).encode()).hexdigest()


def wait(check, timeout=12):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        time.sleep(.1)
    raise AssertionError('condition did not become true')


def request(stream, value):
    stream.sendall(json.dumps(value).encode() + b'\n')
    data = bytearray()
    while not data.endswith(b'\n'):
        part = stream.recv(1)
        if not part:
            raise AssertionError('service disconnected: ' + data.decode())
        data.extend(part)
        assert len(data) <= 4096
    return json.loads(data)


def connect():
    stream = socket.socket(socket.AF_UNIX)
    stream.settimeout(35)
    stream.connect(SOCKET)
    return stream


def free_port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


def inside(output):
    # This is a test runner guard, not a production mode of the broker.
    assert os.environ.get('CROSSBOW_TEST_NETNS') == os.readlink('/proc/self/ns/net')
    assert os.getuid() == 0 and os.environ['CROSSBOW_HOST_NETNS'] != os.readlink('/proc/self/ns/net')
    os.umask(0o077)
    Path('/run/crossbow-tun').mkdir(mode=0o700)
    run('ip', 'link', 'set', 'lo', 'up')
    run('ip', 'link', 'add', 'uplink', 'type', 'dummy')
    run('ip', 'addr', 'add', '192.0.2.2/24', 'dev', 'uplink')
    run('ip', '-6', 'addr', 'add', '2001:db8:1::2/64', 'dev', 'uplink', 'nodad')
    run('ip', 'link', 'set', 'uplink', 'up')
    run('ip', 'route', 'add', 'default', 'dev', 'uplink')
    run('ip', '-6', 'route', 'add', 'default', 'dev', 'uplink')
    baseline = snapshot()
    checks = []
    proxies = []

    class Proxy(socketserver.StreamRequestHandler):
        def handle(self):
            first = self.rfile.readline().decode().strip()
            while self.rfile.readline().strip():
                pass
            assert first.startswith('CONNECT '), first
            proxies.append(first)
            self.wfile.write(b'HTTP/1.1 200 Connection established\r\n\r\n')
            self.wfile.flush()
            assert self.rfile.readline().startswith(b'GET ')
            while self.rfile.readline().strip():
                pass
            body = b'crossbow-isolated-tun-ok'
            self.wfile.write(b'HTTP/1.1 200 OK\r\nContent-Length: ' + str(len(body)).encode()
                             + b'\r\nConnection: close\r\n\r\n' + body)
            self.wfile.flush()

    class Server(socketserver.ThreadingTCPServer):
        daemon_threads = True
        allow_reuse_address = True

    server = Server(('127.0.0.1', 0), Proxy)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    config = output / 'config.yaml'
    core_log = output / 'core.log'
    mixed, controller = free_port(), free_port()
    while controller == mixed:
        controller = free_port()
    config.write_text(f'''mixed-port: {mixed}
external-controller: 127.0.0.1:{controller}
secret: crossbow-isolated-test-secret
log-level: debug
proxies:
  - name: fixture
    type: http
    server: 127.0.0.1
    port: {server.server_address[1]}
rules: [MATCH,fixture]
dns:
  nameserver: [127.0.0.1:65530]
'''.replace('rules: [MATCH,fixture]', 'rules: ["MATCH,fixture"]'))
    processes = []

    def launch():
        log = (output / f'service-{len(processes)}.log').open('wb')
        # Match the production service capability bound; no root filesystem powers.
        command = ['setpriv', '--bounding-set=-all,+net_admin', '--inh-caps=-all,+net_admin',
                   '--ambient-caps=-all,+net_admin', '--no-new-privs', SERVICE, '--serve']
        process = subprocess.Popen(command, stdout=log, stderr=log)
        log.close()
        processes.append(process)
        wait(lambda: Path(SOCKET).exists() or process.poll() is not None)
        assert process.poll() is None, f'service failed: {list(output.glob("service-*.log"))[-1].read_text()}'
        return process

    def start():
        stream = connect()
        result = request(stream, {'cmd': 'start', 'config': str(config), 'log': str(core_log)})
        assert result.get('ok') and result.get('active'), (result, core_log.read_text()[-5000:] if core_log.exists() else 'no core log')
        return stream, result

    def clean():
        assert not any(link['ifname'] == 'Crossbow' for link in json.loads(run('ip', '-j', 'link')))
        assert snapshot() == baseline, 'namespace routes/rules/DNS were not restored'
        assert not Path('/run/crossbow-tun/network.json').exists()

    try:
        process = launch()
        stream, state = start()
        status_text = Path(f'/proc/{state["pid"]}/status').read_text()
        cap = next(line.split()[1] for line in status_text.splitlines() if line.startswith('CapEff:'))
        assert int(cap, 16) == 1 << 12, cap
        checks.append('real core runs with CAP_NET_ADMIN only')
        for address in ['203.0.113.77', '2001:db8:2::77']:
            family = socket.AF_INET6 if ':' in address else socket.AF_INET
            with socket.socket(family) as connection:
                connection.settimeout(8)
                connection.connect((address, 80))
                connection.sendall(b'GET / HTTP/1.1\r\nHost: fixture.invalid\r\nConnection: close\r\n\r\n')
                response = bytearray()
                while part := connection.recv(4096):
                    response.extend(part)
                assert response.endswith(b'crossbow-isolated-tun-ok'), response
        assert len(proxies) == 2
        checks.append('unproxied IPv4 and IPv6 TCP requests traverse TUN and real mihomo')
        query = struct.pack('!6H', 99, 0x100, 1, 0, 0, 0) + b'\x0dlinux-fixture\x04test\0' + struct.pack('!2H', 1, 1)
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as dns:
            dns.settimeout(5)
            dns.sendto(query, ('1.1.1.1', 53))
            answer, _ = dns.recvfrom(4096)
            assert answer[:2] == query[:2] and struct.unpack('!H', answer[6:8])[0] > 0
        assert not (output / 'resolver-called').exists(), 'core tried to invoke a system DNS helper'
        checks.append('UDP DNS is handled in TUN without changing resolver configuration or invoking resolvectl')
        assert request(stream, {'cmd': 'stop'})['stopped']
        stream.close()
        clean()
        checks.append('normal stop restores the namespace network exactly')
        stream, state = start()
        assert request(stream, {'cmd': 'stop'})['stopped']
        stream.close()
        clean()
        checks.append('configuration restart reuses the authorized idle service')
        # Occupied listeners must not be killed or mistaken for readiness.
        with socket.socket() as occupied:
            occupied.bind(('127.0.0.1', mixed)); occupied.listen()
            with connect() as refused:
                result = request(refused, {'cmd': 'start', 'config': str(config), 'log': str(core_log)})
                assert not result['ok'] and result['stopped'], result
            clean()
        checks.append('occupied mixed port is rejected without modifying the network')
        stream, state = start()
        stream.close()  # Same kernel EOF as a killed desktop process.
        process.wait(timeout=10)
        clean()
        checks.append('desktop disconnect stops its core and releases all recorded resources')
        process = launch()
        stream, state = start()
        os.kill(state['pid'], signal.SIGKILL)
        process.wait(timeout=10); stream.close()
        clean()
        checks.append('core SIGKILL is detected and its network resources are released')
        process = launch()
        stream, state = start()
        run('ip', 'rule', 'add', 'priority', '11000', 'table', 'main')
        process.wait(timeout=10); stream.close()
        assert any(r['priority'] == 11000 for r in json.loads(run('ip', '-j', 'rule')))
        run('ip', 'rule', 'del', 'priority', '11000', 'table', 'main')
        clean()
        checks.append('new foreign policy route stops Crossbow while preserving the foreign rule')
        process = launch()
        stream, state = start()
        run('ip', 'rule', 'del', 'not', 'fwmark', '49451', 'table', '20220', 'priority', '12020', 'protocol', '242')
        process.wait(timeout=10); stream.close()
        clean()
        checks.append('missing owned rule is detected; remaining owned resources are cleaned')
        process = launch()
        stream, state = start()
        os.kill(state['pid'], signal.SIGKILL)
        process.kill(); process.wait(timeout=5); stream.close()
        # Exercise the same executable as ExecStopPost. systemd itself is not
        # running inside this namespace, so this is not a systemd acceptance claim.
        run(SERVICE, '--cleanup')
        clean()
        checks.append('standalone ExecStopPost cleanup recovers a killed service/core pair')
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()
                try: process.wait(timeout=8)
                except subprocess.TimeoutExpired: process.kill(); process.wait()
        server.shutdown()
    return {'passed': True, 'checks': checks, 'systemd_authorization_tested': False,
            'mode': 'real broker and pinned mihomo in private user/PID/mount/network namespaces'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--service', type=Path, default=ROOT / 'target/debug/crossbow-service')
    parser.add_argument('--core', type=Path, default=ROOT / 'apps/desktop/src-tauri/binaries/mihomo-x86_64-unknown-linux-gnu')
    parser.add_argument('--output', type=Path, default=ROOT / 'target/linux-validation/network')
    parser.add_argument('--inside', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    output = args.output.resolve(); output.mkdir(parents=True, exist_ok=True)
    if args.inside:
        result = inside(output)
    else:
        before = snapshot()
        (output / 'report.json').write_text(json.dumps({'passed': False, 'mode': 'namespace test in progress'}) + '\n')
        fixture = output / 'install/usr/lib/crossbow'; fixture.mkdir(parents=True, exist_ok=True)
        for source, name in [(args.service, 'crossbow-service'), (args.core, 'mihomo')]:
            shutil.copyfile(source.resolve(), fixture / name)
            (fixture / name).chmod(0o755)
        helper = output / 'install/usr/bin/resolvectl'
        helper.parent.mkdir(parents=True, exist_ok=True)
        helper.write_text('#!/bin/sh\n: > ' + shlex.quote(str(output / 'resolver-called')) + '\nexit 1\n')
        helper.chmod(0o755)
        (output / 'resolver-called').unlink(missing_ok=True)
        host_ns = os.readlink('/proc/self/ns/net')
        command = ['bwrap', '--unshare-user', '--uid', '0', '--gid', '0', '--unshare-net', '--unshare-pid',
                   '--cap-add', 'ALL', '--die-with-parent', '--ro-bind', '/', '/', '--proc', '/proc',
                   '--dev', '/dev', '--dev-bind', '/dev/net/tun', '/dev/net/tun',
                   '--tmpfs', '/run', '--tmpfs', '/tmp', '--overlay-src', '/usr',
                   '--overlay-src', str(output / 'install/usr'), '--ro-overlay', '/usr',
                   '--bind', str(output), str(output), '--setenv', 'CROSSBOW_HOST_NETNS', host_ns,
                   '--', '/bin/sh', '-c', 'export CROSSBOW_TEST_NETNS=$(readlink /proc/self/ns/net); exec "$@"', 'crossbow-test',
                   '/usr/bin/python3', str(Path(__file__).resolve()), '--inside', '--output', str(output)]
        process = subprocess.run(command)
        unchanged = snapshot() == before
        if process.returncode or not unchanged:
            (output / 'report.json').write_text(json.dumps({
                'passed': False, 'exit_code': process.returncode,
                'host_network_unchanged': unchanged}) + '\n')
            raise SystemExit(f'namespace test failed ({process.returncode}); host network unchanged={unchanged}')
        result = json.loads((output / 'report.json').read_text())
        result['host_network_unchanged'] = unchanged
        result['service_sha256'] = hashlib.sha256(args.service.read_bytes()).hexdigest()
    (output / 'report.json').write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
    if not args.inside:
        print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
