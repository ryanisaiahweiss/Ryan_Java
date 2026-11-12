"""Storage layer.

Dashboards talk to a store through four methods: read(), write(), version().
JsonStore keeps one JSON file per collection. A PostgresStore with the same
interface can replace it later without touching the server or the dashboards.
"""
import json
import os
import tempfile
import threading
from pathlib import Path


class JsonStore:
    def __init__(self, data_dir: Path, collections: list[str]):
        self.dir = Path(data_dir)
        self.collections = list(collections)
        self.lock = threading.RLock()
        self.dir.mkdir(parents=True, exist_ok=True)

    def _path(self, collection: str) -> Path:
        if collection not in self.collections:
            raise KeyError(collection)
        return self.dir / f"{collection}.json"

    def read(self, collection: str) -> list:
        path = self._path(collection)
        with self.lock:
            if not path.exists():
                return []
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)

    def write(self, collection: str, items: list) -> None:
        path = self._path(collection)
        with self.lock:
            fd, tmp = tempfile.mkstemp(dir=self.dir, suffix=".tmp")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    json.dump(items, f, indent=2, ensure_ascii=False)
                    f.write("\n")
                os.replace(tmp, path)  # atomic: readers never see a partial file
            except BaseException:
                if os.path.exists(tmp):
                    os.remove(tmp)
                raise

    def version(self) -> str:
        """Changes whenever any collection file changes (including hand edits)."""
        parts = []
        for c in self.collections:
            try:
                st = self._path(c).stat()
                parts.append(f"{st.st_mtime_ns}:{st.st_size}")
            except FileNotFoundError:
                parts.append("-")
        return "|".join(parts)
