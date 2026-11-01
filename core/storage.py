"""Shared JSON helpers. Har write atomic hai: temp file -> flush/fsync -> os.replace.

`os.replace` POSIX pe atomic hai (same filesystem pe). Isliye temp file
target ki hi directory me banate hain — cross-device rename fail hota hai.
"""
import json
import os
import tempfile
from pathlib import Path


def read_json(path):
    """JSON file padho. Missing/invalid pe normal exception raise hoga."""
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json_atomic(path, data):
    """Temp me likho, fsync (agar possible ho), phir atomic rename se swap."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp_", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
            try:
                # FUSE (/sdcard) pe fsync kabhi fail karta hai; best-effort.
                os.fsync(f.fileno())
            except OSError:
                pass
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise