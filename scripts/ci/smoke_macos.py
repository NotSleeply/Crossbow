"""Launch the packaged app briefly on a disposable macOS GitHub runner only.

This catches immediate process exits/crashes, not browser/network functionality
or a hung UI. It never launches against the developer's real HOME/configuration.
"""
import os
from pathlib import Path
import plistlib
import shutil
import signal
import subprocess
import sys
import tempfile
import time


def main():
    if sys.platform != 'darwin' or os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted':
        raise RuntimeError('Startup smoke test is restricted to disposable GitHub-hosted macOS runners')
    app = Path(sys.argv[1]).resolve()
    with (app / 'Contents/Info.plist').open('rb') as stream:
        executable = app / 'Contents/MacOS' / plistlib.load(stream)['CFBundleExecutable']
    diagnostics = Path('target/ci-diagnostics').resolve()
    diagnostics.mkdir(parents=True, exist_ok=True)
    started = time.time()
    with tempfile.TemporaryDirectory(prefix='crossbow-smoke-') as home:
        env = dict(os.environ, HOME=home, XDG_CONFIG_HOME=home + '/config',
                   XDG_DATA_HOME=home + '/data', XDG_CACHE_HOME=home + '/cache')
        with (diagnostics / 'startup.log').open('w') as log:
            process = subprocess.Popen([str(executable)], env=env, stdout=log,
                                       stderr=subprocess.STDOUT, start_new_session=True)
            try:
                for _ in range(15):
                    if process.poll() is not None:
                        raise RuntimeError(f'Packaged app exited during startup: {process.returncode}')
                    time.sleep(1)
                print('Packaged app stayed running for 15 seconds in an empty configuration')
            finally:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait()
                for directory in [Path(home) / 'Library/Logs/DiagnosticReports',
                                  Path.home() / 'Library/Logs/DiagnosticReports']:
                    if directory.exists():
                        for report in directory.iterdir():
                            if 'crossbow' in report.name.lower() and report.stat().st_mtime >= started:
                                shutil.copy2(report, diagnostics / report.name)


if __name__ == '__main__':
    main()
