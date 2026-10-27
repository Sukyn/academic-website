"""Local server for the Vercel Python endpoint; optionally use a local checkout."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

PROJECT_ROOT = Path(__file__).resolve().parents[2]
# Capture the code loaded by this process, rather than files changed afterward.
SOURCE_FINGERPRINT = hashlib.sha256(b"".join(
    (PROJECT_ROOT / path).read_bytes() + b"\0"
    for path in ("api/minimality.py", "tools/minimality/dev.py")
)).hexdigest()
sys.path.insert(0, str(PROJECT_ROOT))
from api.minimality import (MAX_ZOO_BYTES, MAX_ZOO_ENTRIES, MAX_ZOO_ENTRY_BYTES,
                            REPOSITORY, Source, SourceError, decode_zoo_entry, handler)  # noqa: E402


def local_revision(root: Path) -> str:
    commit = "local checkout"
    git_root = root / ".git"
    if git_root.is_dir():
        head = (git_root / "HEAD").read_text(encoding="utf-8").strip()
        if head.startswith("ref: refs/heads/"):
            reference = git_root / head.removeprefix("ref: ")
            if reference.is_file():
                commit = reference.read_text(encoding="utf-8").strip()
        elif len(head) == 40:
            commit = head
    return commit


def local_source(root: Path):
    root = root.resolve()
    package_root = root / "src"
    if not (package_root / "minimality_auto" / "search.py").is_file():
        raise ValueError("--source-root must be a minimality-auto checkout containing src/minimality_auto.")
    commit = local_revision(root)

    def load(_destination, emit):
        source = Source(package_root, commit, local=True)
        emit({"type": "source", **source.metadata()})
        emit({"type": "status", "message": "Using the explicitly selected local checkout."})
        return source

    return load


def local_zoo(root: Path):
    root = root.resolve()

    def load():
        theories = []
        total = 0
        for path in sorted((root / "theories").glob("*.json")):
            if path.is_symlink() or not path.is_file():
                raise SourceError("The local theory zoo must contain regular JSON files.")
            with path.open("rb") as stream:
                raw = stream.read(MAX_ZOO_ENTRY_BYTES + 1)
            total += len(raw)
            if len(theories) >= MAX_ZOO_ENTRIES or total > MAX_ZOO_BYTES:
                raise SourceError("The local theory zoo exceeds this prototype's size limit.")
            theories.append(decode_zoo_entry(path.stem, raw))
        if not theories:
            raise SourceError("The local checkout has no theory zoo JSON files.")
        return {"repository": REPOSITORY, "commit": local_revision(root), "theories": theories}

    return load


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--source-root", type=Path, help="Explicit local checkout, for development only")
    parser.add_argument("--static-dir", type=Path, help="Serve an Astro build alongside the API")
    parser.add_argument("--temp-root", type=Path, help="Writable temporary directory for local development")
    options = parser.parse_args()
    static_root = options.static_dir.resolve() if options.static_dir else None
    if static_root is not None and not (static_root / "index.html").is_file():
        parser.error("--static-dir must contain an Astro build with index.html.")
    if options.temp_root:
        temporary_root = options.temp_root.resolve()
        temporary_root.mkdir(parents=True, exist_ok=True)
        tempfile.tempdir = str(temporary_root)

    class DevelopmentHandler(handler, SimpleHTTPRequestHandler):
        def do_POST(self):
            if urlsplit(self.path).path != "/api/minimality":
                self.send_error(404)
                return
            super().do_POST()

        def do_GET(self):
            path = urlsplit(self.path).path
            if path == "/__minimality_health":
                content = json.dumps({"service": "minimality-dev", "version": 1,
                                      "projectRoot": str(PROJECT_ROOT), "sourceFingerprint": SOURCE_FINGERPRINT,
                                      "sourceRoot": str(options.source_root.resolve()) if options.source_root else None}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(content)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(content)
                return
            if path == "/api/minimality" or static_root is None:
                super().do_GET()
                return
            SimpleHTTPRequestHandler.do_GET(self)

        def do_HEAD(self):
            self.send_error(405)

        def send_head(self):
            target = Path(self.translate_path(self.path)).resolve()
            if not target.is_relative_to(static_root):
                self.send_error(404)
                return None
            return super().send_head()

        def list_directory(self, _path):
            self.send_error(404)

    if options.source_root:
        DevelopmentHandler.source_loader = staticmethod(local_source(options.source_root))
        DevelopmentHandler.zoo_loader = staticmethod(local_zoo(options.source_root))
    server = ThreadingHTTPServer(("127.0.0.1", options.port), partial(DevelopmentHandler, directory=static_root))
    print(f"Minimality API listening at http://127.0.0.1:{options.port}/api/minimality", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
