"""Test base: temp data dirs so real data/ touch na ho."""
import tempfile
import unittest
from pathlib import Path

import config


class TempDataCase(unittest.TestCase):
    def setUp(self):
        self._tmp = Path(tempfile.mkdtemp(prefix="cbt_test_"))
        self._orig = {
            "DATA_DIR": config.DATA_DIR,
            "TEMPLATES_DIR": config.TEMPLATES_DIR,
            "TESTS_DIR": config.TESTS_DIR,
            "ATTEMPTS_DIR": config.ATTEMPTS_DIR,
            "SETTINGS_FILE": config.SETTINGS_FILE,
        }
        config.DATA_DIR = self._tmp
        config.TEMPLATES_DIR = self._tmp / "templates"
        config.TESTS_DIR = self._tmp / "tests"
        config.ATTEMPTS_DIR = self._tmp / "attempts"
        config.SETTINGS_FILE = self._tmp / "settings.json"
        config.ensure_dirs()

    def tearDown(self):
        import shutil
        for k, v in self._orig.items():
            setattr(config, k, v)
        shutil.rmtree(self._tmp, ignore_errors=True)