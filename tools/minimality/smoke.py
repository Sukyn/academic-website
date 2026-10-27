"""Exercise the real upstream search over HTTP from GitHub or a local checkout."""

from __future__ import annotations

import argparse
import http.client
import json
import threading
from contextlib import closing
from http.server import ThreadingHTTPServer
from pathlib import Path

from dev import handler, local_source, local_zoo


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, help="Explicit local checkout; otherwise fetch GitHub")
    options = parser.parse_args()

    class SmokeHandler(handler):
        def log_message(self, *_args):
            pass

    if options.source_root:
        SmokeHandler.source_loader = staticmethod(local_source(options.source_root))
        SmokeHandler.zoo_loader = staticmethod(local_zoo(options.source_root))

    server = ThreadingHTTPServer(("127.0.0.1", 0), SmokeHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with closing(http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=45)) as connection:
            connection.request("GET", "/api/minimality?zoo=1")
            response = connection.getresponse()
            assert response.status == 200, response.status
            assert response.headers.get_content_type() == "application/json"
            catalog = json.loads(response.read())
        clifford = next(entry for entry in catalog["theories"] if entry["id"] == "qubit_clifford")
        assert "Clifford" in clifford["name"] and "CNOT" in clifford["theory"]["generators"]
        print(json.dumps({"catalog": len(catalog["theories"]), "commit": catalog["commit"],
                          "qubit_clifford_equations": len(clifford["theory"]["equations"])}))
        operation = {"gen": "g", "on": [0]}
        payload = {"timeout": 3, "theory": {
            "name": "Local upstream smoke", "generators": {"g": {"type": 1}},
            "equations": [
                {"id": "square", "lhs": {"wires": 1, "ops": [operation] * 2},
                 "rhs": {"wires": 1, "ops": []}},
                {"id": "fourth", "lhs": {"wires": 1, "ops": [operation] * 4},
                 "rhs": {"wires": 1, "ops": []}},
            ],
        }}
        swap = {"perm": [1, 0]}
        prop = {"timeout": 3, "theory": {
            "name": "Structural swap smoke", "structure": "PROP", "generators": {},
            "equations": [
                {"id": "swap", "lhs": {"wires": 2, "ops": [swap]},
                 "rhs": {"wires": 2, "ops": []}},
                {"id": "swap-square", "lhs": {"wires": 2, "ops": [swap, swap]},
                 "rhs": {"wires": 2, "ops": []}},
            ],
        }}
        for structure, request, independent, dependent in (
            ("PRO", payload, "square", "fourth"), ("PROP", prop, "swap", "swap-square"),
        ):
            with closing(http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=45)) as connection:
                connection.request("POST", "/api/minimality", json.dumps(request), {"Content-Type": "application/json"})
                response = connection.getresponse()
                assert response.status == 200, response.status
                assert response.headers.get_content_type() == "application/x-ndjson"
                events = [json.loads(line) for line in response]
            errors = [event for event in events if event["type"] == "error"]
            assert not errors, errors
            source_event = next(event for event in events if event["type"] == "source")
            assert source_event["local"] == bool(options.source_root)
            complete = events[-1]
            assert complete["type"] == "complete", events
            report = complete["report"]
            assert report["witnesses"][independent]["certified"], report
            assert dependent in report["unresolved"] and dependent not in report["witnesses"], report
            assert any(event["type"] == "witness" for event in events[:-1])
            if structure == "PROP":
                assert report["witnesses"][independent]["parameters"]["swap"] == 1, report
            print(json.dumps({"structure": structure, "commit": complete["commit"],
                              "events": [event["type"] for event in events],
                              "certified": list(report["witnesses"]), "unresolved": report["unresolved"]}))
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


if __name__ == "__main__":
    main()
