"""Stream bounded minimality-auto searches for the graphical PRO/PROP editor."""

from __future__ import annotations

import io
import json
import logging
import math
import os
import queue
import re
import stat
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler
from importlib.util import find_spec
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

REPOSITORY = "https://github.com/Sukyn/minimality-auto"
COMMIT_URL = "https://api.github.com/repos/Sukyn/minimality-auto/commits/main"
ARCHIVE_URL = "https://codeload.github.com/Sukyn/minimality-auto/zip/"
MAX_BODY_BYTES = 256_000
MAX_ARCHIVE_BYTES = 8_000_000
MAX_SOURCE_BYTES = 2_000_000
MAX_TIMEOUT = 30
MAX_WIRES = 6
MAX_GENERATORS = 12
MAX_EQUATIONS = 24
MAX_OPERATIONS = 128
MAX_ZOO_ENTRIES = 64
MAX_ZOO_BYTES = 1_000_000
MAX_ZOO_ENTRY_BYTES = 128_000
MAX_JSON_DEPTH = 32
SOURCE_TIMEOUT = 20
PROCESS_GRACE_SECONDS = 5
LOGGER = logging.getLogger(__name__)
_cached_zoo: dict[str, Any] | None = None


class RequestError(ValueError):
    """A bounded, user-facing request validation failure."""


class SourceError(RuntimeError):
    """The current upstream source could not be retrieved safely."""


@dataclass(frozen=True)
class Source:
    root: Path
    commit: str
    local: bool = False

    def metadata(self) -> dict[str, Any]:
        return {"commit": self.commit, "repository": REPOSITORY, "local": self.local}


def _object(value: Any, fields: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RequestError(f"{label} must be an object.")
    unknown = value.keys() - fields
    if unknown:
        raise RequestError(f"Unsupported {label} field: {sorted(unknown)[0]}.")
    return value


def _integer(value: Any, minimum: int, maximum: int, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise RequestError(f"{label} must be an integer from {minimum} to {maximum}.")
    return value


def _name(value: Any, maximum: int, label: str) -> str:
    if (
        not isinstance(value, str)
        or not value.strip()
        or len(value) > maximum
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
    ):
        raise RequestError(f"{label} must contain 1–{maximum} printable characters.")
    return value


def _circuit(value: Any, generators: dict[str, int], label: str, structure: str) -> dict[str, Any]:
    circuit = _object(value, {"wires", "ops"}, label)
    wires = _integer(circuit.get("wires"), 0, MAX_WIRES, f"{label} wire count")
    operations = circuit.get("ops")
    if not isinstance(operations, list) or len(operations) > MAX_OPERATIONS:
        raise RequestError(f"{label} must have at most {MAX_OPERATIONS} operations.")
    for index, raw in enumerate(operations):
        operation_label = f"{label} operation {index + 1}"
        if isinstance(raw, dict) and "perm" in raw:
            if structure != "PROP":
                raise RequestError("Wire permutations require a PROP theory.")
            operation = _object(raw, {"perm"}, operation_label)
            order = operation["perm"]
            if not isinstance(order, list) or len(order) != wires:
                raise RequestError("A permutation must list every wire exactly once.")
            for wire in order:
                _integer(wire, 0, wires - 1, "Permutation wire")
            if sorted(order) != list(range(wires)):
                raise RequestError("A permutation must list every wire exactly once.")
            continue
        operation = _object(raw, {"gen", "on"}, operation_label)
        name = operation.get("gen")
        if not isinstance(name, str) or name not in generators:
            raise RequestError(f"{label} operation {index + 1} uses an unknown generator.")
        width = generators[name]
        on = operation.get("on")
        if not isinstance(on, list) or len(on) != width:
            raise RequestError(f"Generator {name} needs an ordered placement of {width} wires.")
        selected = [_integer(item, 0, wires - 1, "Wire position") for item in on]
        if selected and selected != list(range(selected[0], selected[0] + width)):
            raise RequestError("Generators must act on consecutive wires in their original order.")
    return circuit


def validate_request(value: Any) -> tuple[dict[str, Any], float]:
    request = _object(value, {"theory", "timeout"}, "request")
    timeout = request.get("timeout", MAX_TIMEOUT)
    if (
        isinstance(timeout, bool)
        or not isinstance(timeout, (int, float))
        or not 1 <= timeout <= MAX_TIMEOUT
    ):
        raise RequestError(f"Search time must be between 1 and {MAX_TIMEOUT} seconds.")
    theory = _object(request.get("theory"), {"name", "structure", "generators", "equations"}, "theory")
    structure = theory.get("structure", "PRO")
    if not isinstance(structure, str) or structure not in {"PRO", "PROP"}:
        raise RequestError("Search supports PRO and PROP only; braided and controlled structures are not supported.")
    name = _name(theory.get("name", "Graphical theory"), 120, "Theory name")
    raw_generators = theory.get("generators")
    minimum_generators = 0 if structure == "PROP" else 1
    if not isinstance(raw_generators, dict) or not minimum_generators <= len(raw_generators) <= MAX_GENERATORS:
        raise RequestError(f"Define between {minimum_generators} and {MAX_GENERATORS} generators.")
    generators: dict[str, int] = {}
    for generator_name, raw_spec in raw_generators.items():
        _name(generator_name, 32, "Generator name")
        spec = _object(raw_spec, {"type"}, "generator")
        generators[generator_name] = _integer(spec.get("type"), 0, MAX_WIRES, "Generator arity")
    raw_equations = theory.get("equations")
    if not isinstance(raw_equations, list) or not 1 <= len(raw_equations) <= MAX_EQUATIONS:
        raise RequestError(f"Define between 1 and {MAX_EQUATIONS} equations.")
    identifiers: set[str] = set()
    for raw_equation in raw_equations:
        equation = _object(raw_equation, {"id", "lhs", "rhs"}, "equation")
        identifier = _name(equation.get("id"), 64, "Equation name")
        if identifier in identifiers:
            raise RequestError("Equation names must be unique.")
        identifiers.add(identifier)
        left = _circuit(equation.get("lhs"), generators, f"{identifier} left side", structure)
        right = _circuit(equation.get("rhs"), generators, f"{identifier} right side", structure)
        if left["wires"] != right["wires"]:
            raise RequestError(f"Both sides of {identifier} must have the same number of wires.")
    # Upstream uses bare arities and has no structure setting; PROP coherence is native.
    return {"name": name, "generators": generators, "equations": raw_equations}, float(timeout)


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise RequestError(f"Duplicate JSON field: {key}.")
        value[key] = item
    return value


def _reject_constant(_value: str) -> None:
    raise RequestError("JSON numbers must be finite.")


def decode_request(raw: bytes) -> tuple[dict[str, Any], float]:
    try:
        value = json.loads(raw, object_pairs_hook=_unique_object, parse_constant=_reject_constant)
    except RequestError:
        raise
    except (ValueError, RecursionError) as error:
        raise RequestError("The request must contain valid JSON.") from error
    return validate_request(value)


def _download(url: str, limit: int, deadline: float, *, github_api: bool = False) -> bytes:
    headers = {"User-Agent": "colin-blake.eu/minimality", "Cache-Control": "no-cache"}
    if github_api:
        headers["Accept"] = "application/vnd.github+json"
        token = os.environ.get("MINIMALITY_GITHUB_TOKEN")
        if token:
            headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise SourceError("Fetching the current GitHub version took too long. Please try again.")
    try:
        with urllib.request.urlopen(request, timeout=min(10, remaining)) as response:
            chunks = []
            count = 0
            while True:
                if time.monotonic() >= deadline:
                    raise SourceError("Fetching the current GitHub version took too long. Please try again.")
                chunk = response.read(min(65_536, limit + 1 - count))
                if not chunk:
                    return b"".join(chunks)
                count += len(chunk)
                if count > limit:
                    raise SourceError("The upstream download exceeds this prototype's size limit.")
                chunks.append(chunk)
    except urllib.error.HTTPError as error:
        if error.code in {403, 429}:
            raise SourceError("GitHub's download limit was reached. Please try again later.") from error
        raise SourceError("GitHub could not provide the current minimality-auto version.") from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise SourceError("Cannot reach GitHub to download minimality-auto. Please try again.") from error


def _archive_entries(bundle: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    entries = bundle.infolist()
    if len(entries) > 2048 or sum(item.file_size for item in entries) > 32_000_000:
        raise SourceError("The upstream archive exceeds this prototype's size limit.")
    return entries


def extract_source(archive: bytes, destination: Path, commit: str) -> Path:
    """Copy regular Python package files only; never extract arbitrary archive paths."""
    prefix = f"minimality-auto-{commit}/src/"
    package_prefix = prefix + "minimality_auto/"
    copied: set[str] = set()
    total = 0
    try:
        with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
            for item in _archive_entries(bundle):
                if not item.filename.startswith(package_prefix) or not item.filename.endswith(".py"):
                    continue
                relative = item.filename[len(prefix):]
                if (
                    not re.fullmatch(r"minimality_auto/(?:[A-Za-z0-9_]+/)*[A-Za-z0-9_]+\.py", relative)
                    or stat.S_IFMT(item.external_attr >> 16) not in {0, stat.S_IFREG}
                    or item.file_size > 256_000
                    or relative in copied
                ):
                    raise SourceError("The upstream archive has an unsupported source layout.")
                total += item.file_size
                if total > MAX_SOURCE_BYTES or len(copied) >= 128:
                    raise SourceError("The upstream Python source exceeds this prototype's size limit.")
                target = destination / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(bundle.read(item))
                copied.add(relative)
    except SourceError:
        raise
    except (zipfile.BadZipFile, RuntimeError) as error:
        raise SourceError("GitHub returned an unreadable source archive.") from error
    required = {"minimality_auto/__init__.py", "minimality_auto/core.py", "minimality_auto/search.py"}
    if not required <= copied:
        raise SourceError("The current upstream version has an unsupported package layout.")
    return destination


def _current_commit(deadline: float) -> str:
    raw_commit = _download(COMMIT_URL, 128_000, deadline, github_api=True)
    try:
        commit = json.loads(raw_commit)["sha"]
    except (ValueError, KeyError, TypeError) as error:
        raise SourceError("GitHub returned an unreadable commit response.") from error
    if not isinstance(commit, str) or re.fullmatch(r"[0-9a-f]{40}", commit) is None:
        raise SourceError("GitHub returned an invalid source revision.")
    return commit


def fetch_source(destination: Path, emit: Callable[[dict[str, Any]], None]) -> Source:
    deadline = time.monotonic() + SOURCE_TIMEOUT
    emit({"type": "status", "message": "Checking the current GitHub version…"})
    commit = _current_commit(deadline)
    source = Source(destination, commit)
    emit({"type": "source", **source.metadata()})
    emit({"type": "status", "message": "Downloading minimality-auto…"})
    archive = _download(ARCHIVE_URL + commit, MAX_ARCHIVE_BYTES, deadline)
    extract_source(archive, destination, commit)
    return source


def _arxiv_reference(source: Any) -> str | None:
    paper = source.get("paper") if isinstance(source, dict) else None
    if not isinstance(paper, str):
        return None
    paper = paper.strip()
    if paper == "https://liqcs2026.github.io/assets/pdfs/LIQCS_2026_extended_abstract_26.pdf":
        return "2609.40106"
    if paper.startswith("arXiv:"):
        paper = paper.removeprefix("arXiv:")
    elif paper.startswith("https://arxiv.org/abs/"):
        paper = paper.removeprefix("https://arxiv.org/abs/")
    elif paper.startswith("https://arxiv.org/pdf/"):
        paper = paper.removeprefix("https://arxiv.org/pdf/").removesuffix(".pdf")
    else:
        return None
    identifier = r"(?:[0-9]{2}(?:0[1-9]|1[0-2])\.[0-9]{4,5}|quant-ph/[0-9]{2}(?:0[1-9]|1[0-2])[0-9]{3})(?:v[1-9][0-9]*)?"
    return paper if re.fullmatch(identifier, paper) else None


def decode_zoo_entry(identifier: str, raw: bytes) -> dict[str, Any]:
    """Read bounded data only; no downloaded Python is imported for the catalog."""
    if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", identifier) is None:
        raise SourceError("The upstream theory zoo has an unsupported file layout.")
    if len(raw) > MAX_ZOO_ENTRY_BYTES:
        raise SourceError("An upstream theory exceeds this prototype's size limit.")
    depth = 0
    quoted = escaped = False
    for character in raw:
        if quoted:
            if escaped:
                escaped = False
            elif character == 92:
                escaped = True
            elif character == 34:
                quoted = False
        elif character == 34:
            quoted = True
        elif character in (91, 123):
            depth += 1
            if depth > MAX_JSON_DEPTH:
                raise SourceError("An upstream theory exceeds the JSON nesting limit.")
        elif character in (93, 125):
            depth -= 1

    def finite_float(value: str) -> float:
        number = float(value)
        if not math.isfinite(number):
            _reject_constant(value)
        return number

    try:
        theory = json.loads(raw, object_pairs_hook=_unique_object,
                            parse_constant=_reject_constant, parse_float=finite_float)
        if not isinstance(theory, dict):
            raise RequestError("A theory must be an object.")
        name = _name(theory.get("name", identifier), 120, "Theory name")
    except (ValueError, RecursionError) as error:
        raise SourceError("The upstream theory zoo contains invalid JSON data.") from error
    arxiv = _arxiv_reference(theory.pop("source", None))
    theory.pop("wire_dimension", None)
    generators = theory.get("generators")
    if isinstance(generators, dict):
        for generator, definition in generators.items():
            if isinstance(definition, dict):
                definition.pop("matrix", None)
                if definition.keys() == {"type"}:
                    generators[generator] = definition["type"]
    entry = {"id": identifier, "name": name, "theory": theory}
    if arxiv is not None:
        entry["arxiv"] = arxiv
    return entry


def extract_zoo(archive: bytes, commit: str) -> dict[str, Any]:
    prefix = f"minimality-auto-{commit}/theories/"
    theories: dict[str, Any] = {}
    total = 0
    try:
        with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
            for item in _archive_entries(bundle):
                if not item.filename.startswith(prefix) or not item.filename.endswith(".json"):
                    continue
                identifier = item.filename[len(prefix):-5]
                if (
                    identifier in theories
                    or stat.S_IFMT(item.external_attr >> 16) not in {0, stat.S_IFREG}
                    or item.file_size > MAX_ZOO_ENTRY_BYTES
                ):
                    raise SourceError("The upstream theory zoo has an unsupported file layout.")
                total += item.file_size
                if len(theories) >= MAX_ZOO_ENTRIES or total > MAX_ZOO_BYTES:
                    raise SourceError("The upstream theory zoo exceeds this prototype's size limit.")
                theories[identifier] = decode_zoo_entry(identifier, bundle.read(item))
    except SourceError:
        raise
    except (zipfile.BadZipFile, RuntimeError) as error:
        raise SourceError("GitHub returned an unreadable theory archive.") from error
    if not theories:
        raise SourceError("The current upstream version has no supported theory zoo files.")
    return {"repository": REPOSITORY, "commit": commit,
            "theories": [theories[key] for key in sorted(theories)]}


def fetch_zoo() -> dict[str, Any]:
    global _cached_zoo
    deadline = time.monotonic() + SOURCE_TIMEOUT
    commit = _current_commit(deadline)
    if _cached_zoo is not None and _cached_zoo["commit"] == commit:
        return _cached_zoo
    archive = _download(ARCHIVE_URL + commit, MAX_ARCHIVE_BYTES, deadline)
    catalog = extract_zoo(archive, commit)
    _cached_zoo = catalog
    return catalog


WORKER = r'''
import json, sys
if sys.argv[2]:
    sys.path.insert(0, sys.argv[2])
sys.path.insert(0, sys.argv[1])
from minimality_auto.core import Theory
from minimality_auto.search import search_theory

def emit(event):
    print(json.dumps(event, allow_nan=False, separators=(",", ":")), flush=True)

try:
    request = json.load(sys.stdin)
    theory = Theory.from_json(request["theory"])
    report = search_theory(
        theory, strategies=("presence", "counting", "finite_model"),
        timeout=request["timeout"], max_modulus=6, max_permutation_degree=4,
        on_witness=lambda witness: emit({"type": "witness", "witness": witness.as_dict()}),
    )
    emit({"type": "complete", "report": report.as_dict()})
except Exception:
    emit({"type": "error", "message": "The current upstream search could not process this theory."})
'''


def _worker_environment() -> dict[str, str]:
    # The downloaded public package has no need for deployment credentials.
    allowed = {"SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"}
    environment = {key: value for key, value in os.environ.items() if key.upper() in allowed}
    environment.update({"OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1", "MKL_NUM_THREADS": "1"})
    return environment


def run_search(source: Source, theory: dict[str, Any], timeout: float,
               emit: Callable[[dict[str, Any]], None]) -> None:
    emit({"type": "status", "message": "Searching for separating invariants…"})
    started = time.monotonic()
    events: queue.Queue[bytes | None] = queue.Queue()
    witnesses: dict[str, Any] = {}
    # Vercel adds vendored packages to the handler's path, which an isolated child does not inherit.
    numpy_spec = find_spec("numpy")
    numpy_directory = str(Path(numpy_spec.origin).resolve().parent.parent) if numpy_spec and numpy_spec.origin else ""
    process = subprocess.Popen(
        [sys.executable, "-I", "-u", "-c", WORKER, str(source.root), numpy_directory],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        cwd=source.root, env=_worker_environment(), shell=False,
    )
    assert process.stdin is not None and process.stdout is not None

    def read_output() -> None:
        try:
            for line in process.stdout:
                events.put(line)
        finally:
            events.put(None)

    reader = threading.Thread(target=read_output, daemon=True)
    reader.start()
    try:
        process.stdin.write(json.dumps({"theory": theory, "timeout": timeout}, separators=(",", ":")).encode("utf-8"))
        process.stdin.close()
        expires_at = started + timeout + PROCESS_GRACE_SECONDS
        while (remaining := expires_at - time.monotonic()) > 0:
            try:
                line = events.get(timeout=min(1, remaining))
            except queue.Empty:
                emit({"type": "status", "message": "Search in progress…"})
                continue
            if line is None:
                raise RuntimeError("The minimality search stopped without returning a report.")
            if len(line) > 1_000_000:
                raise RuntimeError("The upstream response exceeds the supported size.")
            event = json.loads(line)
            event_type = event.get("type")
            if event_type == "witness":
                witness = event["witness"]
                witnesses[witness["equation"]] = witness
            elif event_type == "complete":
                event.update(source.metadata())
            elif event_type != "error":
                continue
            emit(event)
            if event_type in {"complete", "error"}:
                return
        report = {
            "theory": theory["name"], "witnesses": witnesses,
            "unresolved": [equation["id"] for equation in theory["equations"]
                           if not witnesses.get(equation["id"], {}).get("certified")],
            "elapsed_seconds": round(time.monotonic() - started, 6), "timed_out": True,
        }
        emit({"type": "complete", "report": report, **source.metadata()})
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                process.kill()
        process.wait()
        reader.join(timeout=1)
        process.stdout.close()


class handler(BaseHTTPRequestHandler):
    source_loader = staticmethod(fetch_source)
    zoo_loader = staticmethod(fetch_zoo)

    def _headers(self, status: int, content_type: str = "application/x-ndjson; charset=utf-8") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store, no-transform")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

    def _emit(self, event: dict[str, Any]) -> None:
        self.wfile.write((json.dumps(event, allow_nan=False, ensure_ascii=True, separators=(",", ":")) + "\n").encode("utf-8"))
        self.wfile.flush()

    def do_POST(self) -> None:
        try:
            origin = self.headers.get("Origin")
            host = self.headers.get("Host", "").lower()
            try:
                origin_host = urlsplit(origin).netloc.lower() if origin else None
            except ValueError as error:
                raise RequestError("Invalid request origin.") from error
            if origin_host is not None and origin_host != host:
                self._headers(403)
                self._emit({"type": "error", "message": "Please run the search from this website."})
                return
            if self.headers.get_content_type() != "application/json":
                raise RequestError("Send the theory as application/json.")
            if self.headers.get("Transfer-Encoding"):
                raise RequestError("A fixed request length is required.")
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError as error:
                raise RequestError("Invalid request length.") from error
            if not 0 < length <= MAX_BODY_BYTES:
                raise RequestError("The theory is empty or exceeds the request size limit.")
            theory, timeout = decode_request(self.rfile.read(length))
        except RequestError as error:
            self._headers(400)
            self._emit({"type": "error", "message": str(error)})
            return
        self._headers(200)
        try:
            with tempfile.TemporaryDirectory(prefix="minimality-") as temporary:
                source = self.source_loader(Path(temporary), self._emit)
                run_search(source, theory, timeout, self._emit)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            # run_search's finally block stops the child on a disconnected stream.
            return
        except SourceError as error:
            self._emit({"type": "error", "message": str(error)})
        except Exception:
            LOGGER.exception("Minimality request failed")
            self._emit({"type": "error", "message": "The search service could not finish. Please try again."})

    def do_GET(self) -> None:
        target = urlsplit(self.path)
        if target.path == "/api/minimality" and target.query == "zoo=1":
            status = 200
            try:
                value = self.zoo_loader()
            except SourceError as error:
                status, value = 502, {"type": "error", "message": str(error)}
            except Exception:
                LOGGER.exception("Minimality zoo request failed")
                status, value = 500, {"type": "error", "message": "The theory zoo could not be loaded. Please try again."}
            try:
                self._headers(status, "application/json; charset=utf-8")
                self._emit(value)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass
            return
        self._headers(405)
        self._emit({"type": "error", "message": "Submit a theory with POST."})
