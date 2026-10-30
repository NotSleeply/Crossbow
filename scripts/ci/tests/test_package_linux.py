from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import package_linux as linux


class LinuxPackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.elf = bytearray(64)
        self.elf[:6] = b'\x7fELF\x02\x01'
        self.elf[16:20] = b'\x03\x00\x3e\x00'
        for name, (source, mode) in linux.FILES.items():
            path = self.root / source
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(self.elf if name in ('crossbow-desktop', 'crossbow-service', 'mihomo') else b'fixture')
            path.chmod(mode)

    def package(self):
        return linux.package(self.root, self.root / 'out', '1.2.3')

    def test_roundtrip_contains_service_and_preserves_executable_modes(self):
        with tarfile.open(self.package()) as tar:
            members = {Path(m.name).name: m for m in tar.getmembers()}
            self.assertEqual(set(members), set(linux.FILES) | {'run.sh', 'README.txt'})
            for name in ['run.sh', 'crossbow-desktop', 'mihomo', 'crossbow-service', 'install-service.sh']:
                self.assertEqual(members[name].mode, 0o755)
            guide = tar.extractfile(members['README.txt']).read().decode()
            self.assertIn('sudo ./install-service.sh', guide)
            self.assertIn('1.2.3', guide)

    def test_wrong_architecture_and_non_elf_are_rejected(self):
        for content in [b'not ELF', self.elf[:18] + b'\xb7\x00' + self.elf[20:]]:
            (self.root / linux.FILES['crossbow-desktop'][0]).write_bytes(content)
            with self.assertRaisesRegex(ValueError, 'x86_64 ELF'):
                self.package()

    def test_missing_or_nonexecutable_service_is_rejected(self):
        path = self.root / linux.FILES['crossbow-service'][0]
        path.chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'Not executable'):
            self.package()
        path.unlink()
        with self.assertRaisesRegex(ValueError, 'Missing regular'):
            self.package()


if __name__ == '__main__':
    unittest.main()
