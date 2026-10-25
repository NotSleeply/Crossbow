"""Exercise real Git worktrees and concurrent CLI processes; no user repo writes."""

from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "coordination.py"


class CoordinationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.repo = base / "repo with spaces"
        self.repo.mkdir()
        self.git(self.repo, "init", "-q")
        self.git(self.repo, "symbolic-ref", "HEAD", "refs/heads/main")
        self.git(self.repo, "-c", "user.name=Tests", "-c", "user.email=tests@example.invalid",
                 "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-qm", "init")
        self.one, self.two = base / "worktree one", base / "worktree two"
        self.git(self.repo, "worktree", "add", "-b", "codex/one", str(self.one))
        self.git(self.repo, "worktree", "add", "-b", "codex/two", str(self.two))
        self.head = self.git(self.repo, "rev-parse", "HEAD")

    def git(self, cwd, *args):
        return subprocess.run(["git", *args], cwd=cwd, text=True, encoding="utf-8",
                              capture_output=True, check=True).stdout.strip()

    def cli(self, cwd, *args):
        return subprocess.run([sys.executable, str(SCRIPT), *args], cwd=cwd,
                              text=True, encoding="utf-8", capture_output=True, timeout=15)

    def claim(self, cwd, session, path="apps/desktop"):
        return self.cli(cwd, "claim", "--session", session, "--issue", "96",
                        "--file", path, "--summary", "测试认领")

    def active(self, cwd):
        result = self.cli(cwd, "status", "--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_worktrees_share_journal_without_tracking_or_changing_refs(self):
        a = self.cli(self.one, "path")
        b = self.cli(self.two, "path")
        self.assertEqual(a.returncode, 0, a.stderr)
        self.assertEqual(a.stdout, b.stdout)
        self.assertEqual(self.claim(self.one, "codex").returncode, 0)
        rows = self.active(self.two)
        self.assertEqual(rows[0]["session"], "codex")
        self.assertEqual(rows[0]["branch"], "codex/one")
        self.assertEqual(Path(rows[0]["worktree"]), self.one.resolve())
        for root in [self.repo, self.one, self.two]:
            self.assertEqual(self.git(root, "status", "--porcelain"), "")
            self.assertEqual(self.git(root, "rev-parse", "HEAD"), self.head)
        # The common directory also resolves correctly from nested CWDs.
        nested = self.two / "nested"
        nested.mkdir()
        self.assertEqual(self.cli(nested, "path").stdout, a.stdout)

    def test_concurrent_overlapping_claims_have_exactly_one_winner(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            a = pool.submit(self.claim, self.one, "codex")
            b = pool.submit(self.claim, self.two, "zcode")
            results = [a.result(), b.result()]
        self.assertEqual(sorted(r.returncode for r in results), [0, 1])
        self.assertEqual(len(self.active(self.repo)), 1)
        failure = next(r for r in results if r.returncode)
        self.assertIn("重叠", failure.stderr)

    def test_disjoint_claims_can_coexist_and_same_session_cannot_overwrite(self):
        self.assertEqual(self.claim(self.one, "codex", "README.md").returncode, 0)
        self.assertEqual(self.claim(self.two, "zcode", "apps/desktop").returncode, 0)
        self.assertEqual(len(self.active(self.repo)), 2)
        retry = self.claim(self.one, "codex", "another.md")
        self.assertNotEqual(retry.returncode, 0)
        self.assertIn("未完成", retry.stderr)
        self.assertEqual(len(self.active(self.repo)), 2)

    def test_directory_claim_blocks_descendants_but_not_similar_names(self):
        self.assertEqual(self.claim(self.one, "codex", "apps/desktop").returncode, 0)
        self.assertNotEqual(self.claim(self.two, "zcode", "apps/desktop/src/App.tsx").returncode, 0)
        self.assertEqual(self.claim(self.two, "zcode", "apps/desktop-extra").returncode, 0)

    def test_finish_is_append_only_and_releases_only_own_claim(self):
        self.assertEqual(self.claim(self.one, "codex").returncode, 0)
        path = Path(self.cli(self.one, "path").stdout.strip()) / "codex.jsonl"
        before = path.read_bytes()
        wrong = self.cli(self.two, "finish", "--session", "codex", "--summary", "wrong")
        self.assertNotEqual(wrong.returncode, 0)
        self.assertEqual(path.read_bytes(), before)
        done = self.cli(self.one, "finish", "--session", "codex", "--pr", "123", "--summary", "已提 PR")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertTrue(path.read_bytes().startswith(before))
        self.assertEqual(self.active(self.repo), [])
        history = self.cli(self.one, "history", "--session", "codex")
        entries = [json.loads(line) for line in history.stdout.splitlines()]
        self.assertEqual([row["event"] for row in entries], ["claim", "finish"])
        self.assertEqual(entries[0]["claim_id"], entries[1]["claim_id"])
        self.assertEqual(entries[1]["pr"], 123)
        self.assertEqual(self.claim(self.two, "zcode").returncode, 0)

    def test_main_detached_head_and_unsafe_paths_are_rejected(self):
        self.assertNotEqual(self.claim(self.repo, "codex").returncode, 0)
        for path in ["../outside", str(self.repo), ".git", "apps/*"]:
            result = self.claim(self.one, "codex", path)
            self.assertNotEqual(result.returncode, 0, path)
        self.assertNotEqual(self.claim(self.one, "../zcode").returncode, 0)
        self.git(self.one, "checkout", "--detach", "-q")
        self.assertNotEqual(self.claim(self.one, "codex").returncode, 0)
        self.assertEqual(self.active(self.repo), [])

    def test_corrupt_journal_is_not_silently_ignored(self):
        directory = Path(self.cli(self.one, "path").stdout.strip())
        directory.mkdir()
        (directory / "zcode.jsonl").write_text('{"event":', encoding="utf-8")
        result = self.claim(self.one, "codex")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("流水损坏", result.stderr)
        self.assertFalse((directory / "codex.jsonl").exists())


if __name__ == "__main__":
    unittest.main()
