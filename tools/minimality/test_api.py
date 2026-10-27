"""Network-independent checks of the public API's trust and process boundaries."""

from __future__ import annotations

import io
import http.client
import json
import stat
import subprocess
import sys
import tempfile
import threading
import unittest
import warnings
import zipfile
from contextlib import closing
from http.server import ThreadingHTTPServer
from importlib.util import spec_from_file_location
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from api import minimality as api  # noqa: E402
from tools.minimality.dev import local_zoo  # noqa: E402

COMMIT = "a" * 40


def request():
    return {
        "theory": {
            "name": "Unary test", "generators": {"g": {"type": 1}},
            "equations": [{"id": "square", "lhs": {"wires": 1, "ops": [
                {"gen": "g", "on": [0]}, {"gen": "g", "on": [0]},
            ]}, "rhs": {"wires": 1, "ops": []}}],
        }, "timeout": 2,
    }


def archive(extra=None):
    output = io.BytesIO()
    prefix = f"minimality-auto-{COMMIT}/src/minimality_auto/"
    with warnings.catch_warnings(), zipfile.ZipFile(output, "w") as bundle:
        warnings.filterwarnings("ignore", message="Duplicate name:", category=UserWarning)
        for name in ("__init__.py", "core.py", "search.py"):
            bundle.writestr(prefix + name, "# test fixture, never executed\n")
        bundle.writestr(f"minimality-auto-{COMMIT}/README.md", "not extracted")
        if extra is not None:
            extra(bundle, prefix)
    return output.getvalue()


def zoo_archive(extra=None, commit=COMMIT):
    def entries(bundle, _prefix):
        prefix = f"minimality-auto-{commit}/theories/"
        bundle.writestr(prefix + "qubit_clifford.json", json.dumps(request()["theory"]))
        if extra:
            extra(bundle, prefix)
    return archive(entries)


class RequestBoundaryTests(unittest.TestCase):
    def test_prop_permutations_are_preserved_without_a_fake_generator(self):
        value = request()
        value["theory"].update(structure="PROP", generators={}, equations=[{
            "id": "swap", "lhs": {"wires": 2, "ops": [{"perm": [1, 0]}]},
            "rhs": {"wires": 2, "ops": []},
        }])
        theory, _ = api.decode_request(json.dumps(value).encode())
        self.assertEqual(theory["generators"], {})
        self.assertNotIn("structure", theory)
        self.assertEqual(theory["equations"][0]["lhs"]["ops"], [{"perm": [1, 0]}])

    def test_prop_rejects_malformed_permutations_and_mixed_operations(self):
        for operation in (
            {"perm": [0, 0]}, {"perm": [0]}, {"perm": [1, 2]}, {"perm": [True, 0]},
            {"perm": "10"}, {"perm": [1, 0], "on": [0, 1]},
            {"perm": [1, 0], "gen": "g"}, {"perm": [1, 0], "repeat": 2},
        ):
            with self.subTest(operation=operation):
                value = request()
                value["theory"]["structure"] = "PROP"
                value["theory"]["equations"][0]["lhs"] = {"wires": 2, "ops": [operation]}
                value["theory"]["equations"][0]["rhs"]["wires"] = 2
                with self.assertRaises(api.RequestError):
                    api.validate_request(value)

    def test_pro_still_requires_generators_and_rejects_permutations(self):
        value = request()
        value["theory"]["generators"] = {}
        with self.assertRaises(api.RequestError):
            api.validate_request(value)
        value = request()
        value["theory"]["equations"][0]["lhs"]["ops"] = [{"perm": [0]}]
        for structure in (None, "PRO"):
            if structure is not None:
                value["theory"]["structure"] = structure
            with self.assertRaisesRegex(api.RequestError, "permutations require a PROP"):
                api.validate_request(value)

    def test_unsupported_structures_and_control_nodes_are_not_erased(self):
        for structure in ("Braided", "Controlled PROP", "Polycontrolled PROP", [], None):
            with self.subTest(structure=structure):
                value = request()
                value["theory"]["structure"] = structure
                with self.assertRaisesRegex(api.RequestError, "supports PRO and PROP only"):
                    api.validate_request(value)
        for operation in ({"braid": [0, 1]}, {"gen": "g", "on": [0], "controls": [1]}):
            value = request()
            value["theory"]["structure"] = "PROP"
            value["theory"]["equations"][0]["lhs"]["ops"] = [operation]
            with self.assertRaises(api.RequestError):
                api.validate_request(value)

    def test_accepts_empty_identities_and_scalar_placements(self):
        value = request()
        value["theory"]["generators"]["scalar"] = {"type": 0}
        value["theory"]["equations"].append({
            "id": "scalar", "lhs": {"wires": 0, "ops": [{"gen": "scalar", "on": []}]},
            "rhs": {"wires": 0, "ops": []},
        })
        theory, timeout = api.decode_request(json.dumps(value).encode())
        self.assertEqual(theory["generators"], {"g": 1, "scalar": 0})
        self.assertEqual(timeout, 2)

    def test_expanded_sides_accept_128_operations_and_reject_129_including_permutations(self):
        generator = {"gen": "g", "on": [0]}
        swap = {"perm": [1, 0]}
        for structure, operations in (
            ("PRO", [generator] * 128),
            ("PROP", [swap] * 128),
            ("PROP", [generator, swap] * 64),
        ):
            for side in ("lhs", "rhs"):
                with self.subTest(structure=structure, side=side, first=operations[0]):
                    value = request()
                    value["theory"]["structure"] = structure
                    equation = value["theory"]["equations"][0]
                    equation.update(lhs={"wires": 2, "ops": []}, rhs={"wires": 2, "ops": []})
                    equation[side]["ops"] = list(operations)
                    theory, _ = api.decode_request(json.dumps(value).encode())
                    self.assertEqual(theory["equations"][0][side]["ops"], operations)
                    equation[side]["ops"].append(generator)
                    with self.assertRaisesRegex(api.RequestError, "at most 128 operations"):
                        api.decode_request(json.dumps(value).encode())

    def test_rejects_crossings_nonadjacent_placement_and_wrong_wire_counts(self):
        for placement in ([1, 0], [0, 2], [1, 2, 3], [0, True], [-1, 0], [2, 3]):
            with self.subTest(placement=placement):
                value = request()
                value["theory"]["generators"] = {"g": {"type": 2}}
                value["theory"]["equations"][0]["lhs"] = {
                    "wires": 3, "ops": [{"gen": "g", "on": placement}],
                }
                value["theory"]["equations"][0]["rhs"]["wires"] = 3
                with self.assertRaises(api.RequestError):
                    api.validate_request(value)
        value = request()
        value["theory"]["equations"][0]["rhs"]["wires"] = 2
        with self.assertRaises(api.RequestError):
            api.validate_request(value)

    def test_rejects_user_source_semantics_macros_and_permutations(self):
        changes = [
            lambda value: value.update(repository="https://example.com"),
            lambda value: value.update(code="print('user code')"),
            lambda value: value["theory"].update(macros={}),
            lambda value: value["theory"]["generators"]["g"].update(matrix=[[1]]),
            lambda value: value["theory"]["equations"][0]["lhs"]["ops"].append({"perm": [0]}),
        ]
        for change in changes:
            with self.subTest(change=change):
                value = request()
                change(value)
                with self.assertRaises(api.RequestError):
                    api.validate_request(value)

    def test_rejects_duplicate_json_and_unbounded_requests(self):
        for raw in (b'{"theory":{},"theory":{}}', b'{"timeout":NaN}', b'{"timeout":Infinity}',
                    b'{"timeout":' + b'9' * 5000 + b'}'):
            with self.subTest(raw=raw), self.assertRaises(api.RequestError):
                api.decode_request(raw)
        for field, value in (("timeout", 31), ("timeout", True), ("timeout", 0), ("timeout", 10**1000)):
            invalid = request()
            invalid[field] = value
            with self.assertRaises(api.RequestError):
                api.validate_request(invalid)
        invalid = request()
        invalid["theory"]["equations"][0]["lhs"]["ops"] = [{"gen": "g", "on": [0]}] * (api.MAX_OPERATIONS + 1)
        with self.assertRaises(api.RequestError):
            api.validate_request(invalid)
        invalid = request()
        invalid["theory"]["equations"] *= 2
        with self.assertRaises(api.RequestError):
            api.validate_request(invalid)


class SourceBoundaryTests(unittest.TestCase):
    def test_extracts_only_package_python_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = api.extract_source(archive(), Path(temporary), COMMIT)
            self.assertEqual(len(list(root.rglob("*.py"))), 3)
            self.assertFalse(list(root.rglob("*.md")))

    def test_rejects_archive_traversal_symlinks_and_duplicate_sources(self):
        def symlink(bundle, prefix):
            info = zipfile.ZipInfo(prefix + "linked.py")
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            bundle.writestr(info, "../../outside.py")

        extras = [
            lambda bundle, prefix: bundle.writestr(prefix + "../outside.py", "bad"),
            symlink,
            lambda bundle, prefix: bundle.writestr(prefix + "core.py", "duplicate"),
        ]
        for extra in extras:
            with self.subTest(extra=extra), tempfile.TemporaryDirectory() as temporary:
                with self.assertRaises(api.SourceError):
                    api.extract_source(archive(extra), Path(temporary), COMMIT)

    def test_source_is_resolved_and_downloaded_on_every_run(self):
        events = []
        with patch.object(api, "_download", side_effect=[
            json.dumps({"sha": COMMIT}).encode(), archive(),
            json.dumps({"sha": COMMIT}).encode(), archive(),
        ]) as download, tempfile.TemporaryDirectory() as temporary:
            for index in range(2):
                api.fetch_source(Path(temporary) / str(index), events.append)
        urls = [call.args[0] for call in download.call_args_list]
        self.assertEqual(urls, [api.COMMIT_URL, api.ARCHIVE_URL + COMMIT] * 2)
        source_events = [event for event in events if event["type"] == "source"]
        self.assertEqual([event["commit"] for event in source_events], [COMMIT, COMMIT])

    def test_child_does_not_inherit_deployment_credentials(self):
        with patch.dict(api.os.environ, {"DATABASE_URL": "secret", "MINIMALITY_GITHUB_TOKEN": "secret"}):
            environment = api._worker_environment()
        self.assertNotIn("DATABASE_URL", environment)
        self.assertNotIn("MINIMALITY_GITHUB_TOKEN", environment)


class ZooBoundaryTests(unittest.TestCase):
    def setUp(self):
        patcher = patch.object(api, "_cached_zoo", None)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_reads_only_direct_json_and_omits_ignored_fields(self):
        theory = {**request()["theory"], "macros": {"double": {"gen": "g", "repeat": 2}},
                  "source": {"citation": "ignored", "paper": "arXiv:2602.09874"}, "wire_dimension": 2,
                  "generators": {"g": {"type": 1, "matrix": [[1, 0], [0, 1]]}}}
        raw = zoo_archive(lambda bundle, prefix: (
            bundle.writestr(prefix + "other.json", json.dumps(theory)),
            bundle.writestr(prefix + "listing.py", "raise RuntimeError('never run')"),
        ))
        with patch.object(api.subprocess, "Popen") as process:
            result = api.extract_zoo(raw, COMMIT)
        process.assert_not_called()
        self.assertEqual(result["repository"], api.REPOSITORY)
        self.assertEqual(result["commit"], COMMIT)
        self.assertEqual([entry["id"] for entry in result["theories"]], ["other", "qubit_clifford"])
        syntax = {key: value for key, value in theory.items() if key not in {"source", "wire_dimension"}}
        syntax["generators"] = {"g": 1}
        self.assertEqual(result["theories"][0]["theory"], syntax)
        self.assertEqual(result["theories"][0]["arxiv"], "2602.09874")

    def test_official_zoo_reference_associations(self):
        groups = {
            "2602.09874": {"clifford_cs", "clifford_t", "cnot_dihedral", "qubit_clifford",
                           "qutrit_clifford", "real_clifford"},
            "2602.06644": {"real_clifford_ch", "realclifford-ch-simplified"},
            "2609.40106": {"multi_qudit_clifford_d3", "multi_qudit_clifford_d5", "multi_qudit_clifford_d7"},
            "2603.06466": {"affine_d5", "affine_simplified_d11", "affine_simplified_d5",
                           "affine_simplified_d7", "cubic_phase_d5", "cubic_phase_simplified_d5",
                           "cubic_phase_simplified_d7", "linear_phase_d5", "linear_phase_simplified_d5",
                           "linear_phase_simplified_d7", "quadratic_phase_d5",
                           "quadratic_phase_simplified_d5", "quadratic_phase_simplified_d7"},
        }
        fixtures = Path(__file__).resolve().parents[2] / "tests/fixtures/minimality/zoo"
        expected = {identifier: arxiv for arxiv, identifiers in groups.items() for identifier in identifiers}
        self.assertEqual({path.stem for path in fixtures.glob("*.json")}, expected.keys())
        self.assertEqual(len(expected), 24)
        for identifier, arxiv in expected.items():
            with self.subTest(theory=identifier):
                entry = api.decode_zoo_entry(identifier, (fixtures / f"{identifier}.json").read_bytes())
                self.assertEqual(entry["arxiv"], arxiv)
                self.assertNotIn("source", entry["theory"])

    def test_reference_normalization_preserves_versions_and_legacy_ids(self):
        references = {
            "arXiv:2602.09874": "2602.09874",
            " arXiv:2602.09874v2 ": "2602.09874v2",
            "https://arxiv.org/abs/2602.09874v12": "2602.09874v12",
            "https://arxiv.org/pdf/2602.09874": "2602.09874",
            "https://arxiv.org/pdf/2602.09874v2.pdf": "2602.09874v2",
            "arXiv:0704.0001": "0704.0001",
            "arXiv:quant-ph/9501012": "quant-ph/9501012",
            "https://arxiv.org/abs/quant-ph/9501012v2": "quant-ph/9501012v2",
            "https://arxiv.org/pdf/quant-ph/9501012.pdf": "quant-ph/9501012",
        }
        for paper, arxiv in references.items():
            with self.subTest(paper=paper):
                entry = api.decode_zoo_entry("fixture", json.dumps({
                    "name": "Reference", "source": {"paper": paper, "citation": "ignored"},
                    "wire_dimension": 2, "generators": {"g": {"type": 1, "matrix": [[1]]}},
                    "future": {"syntax": True},
                }).encode())
                self.assertEqual(entry, {"id": "fixture", "name": "Reference", "arxiv": arxiv,
                                         "theory": {"name": "Reference", "generators": {"g": 1},
                                                    "future": {"syntax": True}}})

    def test_missing_non_arxiv_and_unsafe_references_are_omitted(self):
        sources = (None, "arXiv:2602.09874", [], {}, {"citation": "arXiv:2602.09874"},
                   *({"paper": paper} for paper in (
                       None, True, 2602, [], {}, "", "2602.09874", "arXiv:2602.09874.pdf",
                       "arXiv:2600.09874", "arXiv:2613.09874", "arXiv:2602.987",
                       "arXiv:2602.098740", "arXiv:2602.09874v0", "arXiv:2602.09874v01",
                       "arXiv:quant-ph/9500012", "arXiv:quant-ph/9513012",
                       "https://example.com/paper", "javascript:alert(1)",
                       "http://arxiv.org/abs/2602.09874", "https://arxiv.org.evil/abs/2602.09874",
                       "https://arxiv.org@evil.com/abs/2602.09874", "https://arxiv.org:443/abs/2602.09874",
                       "https://arxiv.org/abs/2602.09874.pdf", "https://arxiv.org/abs/2602.09874/extra",
                       "https://arxiv.org/abs/2602.09874?redirect=evil", "https://arxiv.org/abs/2602.09874#x",
                       "https://arxiv.org/pdf/../../evil.pdf", "arXiv:2602.09874\nextra",
                       "https://liqcs2026.github.io/assets/pdfs/LIQCS_2026_extended_abstract_27.pdf",
                   )))
        for source in sources:
            with self.subTest(source=source):
                entry = api.decode_zoo_entry("fixture", json.dumps({"source": source}).encode())
                self.assertEqual(entry, {"id": "fixture", "name": "fixture", "theory": {}})
        self.assertNotIn("arxiv", api.decode_zoo_entry("fixture", b"{}"))

    def test_projection_preserves_unknown_fields_and_invalid_generator_shapes(self):
        theory = {"name": "Future syntax", "future": {"meaningful": True}, "generators": {
            "fixed": {"type": 2}, "pattern": {"type": 1, "matrix": [], "pattern": "n"},
            "missing": {"matrix": []}, "malformed": [1, 2], "scalar": 0,
        }}
        result = api.decode_zoo_entry("future", json.dumps(theory).encode())["theory"]
        self.assertEqual(result, {**theory, "generators": {
            "fixed": 2, "pattern": {"type": 1, "pattern": "n"},
            "missing": {}, "malformed": [1, 2], "scalar": 0,
        }})

    def test_rejects_duplicate_nonregular_and_unsafe_theory_paths(self):
        def symlink(bundle, prefix):
            info = zipfile.ZipInfo(prefix + "linked.json")
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            bundle.writestr(info, "../../outside.json")

        extras = (
            lambda bundle, prefix: bundle.writestr(prefix + "qubit_clifford.json", "{}"),
            lambda bundle, prefix: bundle.writestr(prefix + "../outside.json", "{}"),
            lambda bundle, prefix: bundle.writestr(prefix + "nested/theory.json", "{}"),
            lambda bundle, prefix: bundle.writestr(prefix + "bad\\theory.json", "{}"),
            symlink,
        )
        for extra in extras:
            with self.subTest(extra=extra), self.assertRaises(api.SourceError):
                api.extract_zoo(zoo_archive(extra), COMMIT)

    def test_rejects_unbounded_or_ambiguous_json_before_catalog_delivery(self):
        invalid = (
            b'{"name":"one","name":"two"}', b'{"number":NaN}', b'{"number":Infinity}',
            b'{"number":1e999}', b'{"name":"x","nested":' + b'[' * 33 + b'0' + b']' * 33 + b'}',
            b'{"source":{"duplicate":1,"duplicate":2}}',
            b'{"generators":{"g":{"type":1,"matrix":[NaN]}}}',
            b'{' + b' ' * api.MAX_ZOO_ENTRY_BYTES + b'}', b'[]', b'\xff',
        )
        for raw in invalid:
            with self.subTest(raw=raw[:60]), self.assertRaises(api.SourceError):
                api.decode_zoo_entry("fixture", raw)
        quoted = {"name": "Escaped quote \" and [brackets]", "text": "[" * 100}
        self.assertEqual(api.decode_zoo_entry("fixture", json.dumps(quoted).encode())["theory"], quoted)
        for constant in ("MAX_ZOO_ENTRIES", "MAX_ZOO_BYTES"):
            with self.subTest(constant=constant), patch.object(api, constant, 0), self.assertRaises(api.SourceError):
                api.extract_zoo(zoo_archive(), COMMIT)
        with self.assertRaises(api.SourceError):
            api.extract_zoo(archive(), COMMIT)

    def test_catalog_reuses_only_the_current_verified_revision_without_loading_python(self):
        next_commit = "b" * 40
        downloads = [json.dumps({"sha": COMMIT}).encode(), zoo_archive(),
                     json.dumps({"sha": COMMIT}).encode(), json.dumps({"sha": next_commit}).encode(),
                     zoo_archive(commit=next_commit)]
        with patch.object(api, "_download", side_effect=downloads) as download, \
                patch.object(api, "extract_source") as source, patch.object(api.subprocess, "Popen") as process:
            first = api.fetch_zoo()
            self.assertIs(api.fetch_zoo(), first)
            self.assertEqual(api.fetch_zoo()["commit"], next_commit)
        self.assertEqual([call.args[0] for call in download.call_args_list],
                         [api.COMMIT_URL, api.ARCHIVE_URL + COMMIT, api.COMMIT_URL,
                          api.COMMIT_URL, api.ARCHIVE_URL + next_commit])
        source.assert_not_called()
        process.assert_not_called()
        with patch.object(api, "_download", side_effect=api.SourceError("Offline")), \
                self.assertRaisesRegex(api.SourceError, "Offline"):
            api.fetch_zoo()
        for revision in (None, "../escape", "A" * 40):
            with patch.object(api, "_download", return_value=json.dumps({"sha": revision}).encode()), \
                    self.assertRaises(api.SourceError):
                api.fetch_zoo()

    def test_changed_revision_download_failure_never_serves_the_previous_catalog(self):
        first = api.extract_zoo(zoo_archive(), COMMIT)
        with patch.object(api, "_cached_zoo", first), \
                patch.object(api, "_current_commit", return_value="b" * 40), \
                patch.object(api, "_download", side_effect=api.SourceError("Unavailable")):
            with self.assertRaisesRegex(api.SourceError, "Unavailable"):
                api.fetch_zoo()
            self.assertIs(api._cached_zoo, first)

    def test_local_catalog_uses_explicit_checkout_json(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "theories").mkdir()
            path = root / "theories" / "local.json"
            path.write_text(json.dumps(request()["theory"]), encoding="utf-8")
            result = local_zoo(root)()
            self.assertEqual(result["commit"], "local checkout")
            self.assertEqual(result["theories"][0]["id"], "local")
            updated = {**request()["theory"], "name": "Edited locally"}
            path.write_text(json.dumps(updated), encoding="utf-8")
            self.assertEqual(local_zoo(root)()["theories"][0]["name"], "Edited locally")
            path.write_text('{"name":Infinity}', encoding="utf-8")
            with self.assertRaises(api.SourceError):
                local_zoo(root)()

    def test_get_catalog_is_json_and_other_gets_keep_method_error(self):
        catalog = api.extract_zoo(zoo_archive(), COMMIT)

        class CatalogHandler(api.handler):
            zoo_loader = staticmethod(lambda: catalog)

            def log_message(self, *_args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), CatalogHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for path, status, content_type in (
                ("/api/minimality?zoo=1", 200, "application/json"),
                ("/api/minimality", 405, "application/x-ndjson"),
                ("/elsewhere?zoo=1", 405, "application/x-ndjson"),
                ("/api/minimality?zoo=1&path=elsewhere", 405, "application/x-ndjson"),
            ):
                with closing(http.client.HTTPConnection("127.0.0.1", server.server_port)) as connection:
                    connection.request("GET", path)
                    response = connection.getresponse()
                    self.assertEqual(response.status, status)
                    self.assertEqual(response.headers.get_content_type(), content_type)
                    self.assertIn("no-store", response.headers["Cache-Control"])
                    raw = response.read()
                    value = json.loads(raw)
                    self.assertEqual(value, catalog if status == 200 else {
                        "type": "error", "message": "Submit a theory with POST."})
                    self.assertEqual(raw, (json.dumps(value, separators=(",", ":")) + "\n").encode())
            with patch.object(CatalogHandler, "zoo_loader", side_effect=api.SourceError("Unavailable")), \
                    closing(http.client.HTTPConnection("127.0.0.1", server.server_port)) as connection:
                connection.request("GET", "/api/minimality?zoo=1")
                response = connection.getresponse()
                self.assertEqual(response.status, 502)
                self.assertEqual(response.headers.get_content_type(), "application/json")
                self.assertEqual(json.loads(response.read())["message"], "Unavailable")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


class ProcessBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.launched = []
        original = subprocess.Popen

        def launch(*args, **kwargs):
            process = original(*args, **kwargs)
            self.launched.append(process)
            return process

        patcher = patch.object(api.subprocess, "Popen", side_effect=launch)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_isolated_worker_can_load_the_handlers_vendored_numpy_without_credentials(self):
        events = []
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            package = root / "source" / "minimality_auto"
            package.mkdir(parents=True)
            (package / "__init__.py").write_text("", encoding="utf-8")
            (package / "core.py").write_text(
                "class Theory:\n    from_json = staticmethod(lambda value: value)\n", encoding="utf-8")
            (package / "search.py").write_text(
                "import numpy, os, sys\n"
                "class Report:\n"
                "    def as_dict(self):\n"
                "        return {'vendored': numpy.DEPLOYMENT_DEPENDENCY, 'isolated': sys.flags.isolated, "
                "'credentials': any(name in os.environ for name in "
                "('DATABASE_URL', 'MINIMALITY_GITHUB_TOKEN', 'PYTHONPATH'))}\n"
                "def search_theory(*args, **kwargs): return Report()\n", encoding="utf-8")
            numpy = root / "vendor" / "numpy" / "__init__.py"
            numpy.parent.mkdir(parents=True)
            numpy.write_text("DEPLOYMENT_DEPENDENCY = True\n", encoding="utf-8")
            with patch.object(api, "find_spec", return_value=spec_from_file_location("numpy", numpy)), \
                    patch.dict(api.os.environ, {"DATABASE_URL": "secret", "MINIMALITY_GITHUB_TOKEN": "secret", "PYTHONPATH": "untrusted"}):
                api.run_search(api.Source(package.parent, COMMIT), {"name": "test", "equations": []}, 2, events.append)
        self.assertEqual(events[-1]["type"], "complete")
        self.assertEqual(events[-1]["report"], {"vendored": True, "isolated": 1, "credentials": False})
        self.assertIsNotNone(self.launched[0].poll())

    def test_hard_timeout_reaps_the_child_and_returns_an_unresolved_report(self):
        # This transport fixture never produces a mathematical search result.
        events = []
        with tempfile.TemporaryDirectory() as temporary, patch.object(
            api, "WORKER", "import time; time.sleep(20)"
        ), patch.object(api, "PROCESS_GRACE_SECONDS", 0):
            api.run_search(api.Source(Path(temporary), COMMIT), {"name": "test", "equations": [{"id": "r"}]}, 0.1, events.append)
        self.assertIsNotNone(self.launched[0].poll())
        report = events[-1]["report"]
        self.assertTrue(report["timed_out"])
        self.assertEqual(report["witnesses"], {})
        self.assertEqual(report["unresolved"], ["r"])
        self.assertEqual(events[-1]["commit"], COMMIT)

    def test_disconnect_reaps_the_child(self):
        def disconnected(event):
            if event["type"] == "witness":
                raise BrokenPipeError("test disconnect")

        worker = 'import json, time; print(json.dumps({"type":"witness","witness":{"equation":"r"}}), flush=True); time.sleep(20)'
        with tempfile.TemporaryDirectory() as temporary, patch.object(api, "WORKER", worker), self.assertRaises(BrokenPipeError):
            api.run_search(api.Source(Path(temporary), COMMIT), {"name": "test", "equations": []}, 2, disconnected)
        self.assertIsNotNone(self.launched[0].poll())


if __name__ == "__main__":
    unittest.main()
