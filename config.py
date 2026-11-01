"""Saari paths aur constants yahin. Baaki modules yahin se import karenge."""
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

DATA_DIR = BASE_DIR / "data"
TEMPLATES_DIR = DATA_DIR / "templates"   # exam patterns (step 2)
TESTS_DIR = DATA_DIR / "tests"           # ek test = ek .json file
ATTEMPTS_DIR = DATA_DIR / "attempts"     # ek attempt = ek .json file (step 5)
SETTINGS_FILE = DATA_DIR / "settings.json"

# Default sirf phone ke liye (localhost). LAN pe kholna ho: python app.py --host 0.0.0.0
HOST = "127.0.0.1"
PORT = 8080


def ensure_dirs():
    for d in (DATA_DIR, TEMPLATES_DIR, TESTS_DIR, ATTEMPTS_DIR):
        d.mkdir(parents=True, exist_ok=True)
