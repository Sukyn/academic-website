# Minimality

The direct-link preview stays unlisted and `noindex`. Its editor is in `src/lib/minimality/` and `src/scripts/minimality.js`; `api/minimality.py` runs the search.
Development launchers are in `tools/minimality/`; all unit, Python and browser checks are under `tests/`.

## Local development

`npm run dev` starts the Python API on port 8787, then Astro. Ctrl+C stops both.
The launcher checks `.venv` before Python on PATH; install NumPy with `python -m pip install -r requirements.txt`.
Use `.venv/Scripts/python` on Windows or `.venv/bin/python` on macOS/Linux when installing into that environment.

`MINIMALITY_PYTHON` chooses an interpreter; `MINIMALITY_API_PORT` changes the API port.
`npm run dev -- --port 4325` forwards the Astro port. The managed server stays in the foreground; `--background` is unsupported.
An existing API is reused only when health checks match its service, checkout, source mode and loaded revision. Restart after changing the endpoint or wrapper.

For an explicit offline checkout, set `MINIMALITY_SOURCE_ROOT` before starting development.
Both source and zoo entries then come from that checkout, and events report `local: true`.
Only development launchers support this override; deployed requests cannot select another repository or local directory.

To serve a built site and the API together:

```sh
npm run build
python tools/minimality/dev.py --static-dir dist --port 4325
```

Open `http://127.0.0.1:4325/minimality/`. Optional `--source-root` selects a local upstream checkout; `--temp-root tmp/minimality-dev` selects a writable temporary directory.

## Source and search

Every deployed search resolves the current `main` commit of [minimality-auto](https://github.com/Sukyn/minimality-auto), downloads that revision and extracts regular Python package files into a temporary directory.
There is no bundled or stale source fallback. The response records repository and commit.
`MINIMALITY_GITHUB_TOKEN` may supply server-side read access for GitHub metadata; it is never sent to the browser or child process.
The child receives no deployment credentials, has an enforced deadline, and is terminated when a disconnected client is detected.
Vercel serves the file-based Python handler with a 90-second function duration.

The wrapper runs presence, modular counting and finite permutation strategies. An exact separator certifies independence.
An unresolved or timed-out search proves nothing; no result certifies completeness.
Search supports PRO and PROP only. Braided, controlled and polycontrolled diagrams remain editable and saveable but cannot be exported for search.

## Data contracts

POST accepts `theory` and `timeout`. The optional PRO/PROP structure is validated and removed before calling upstream.
Generators have fixed endomorphic arities; a side contains `wires` and `ops`, with consecutive ordered generator placements.
PROP permutations list the input wire arriving at each output and must contain every wire once. PRO rejects them.
Validation and resource limits are defined in `api/minimality.py` and `src/lib/minimality/validation.js`.

Responses stream `application/x-ndjson` events:

| Event | Payload |
| --- | --- |
| `source` | `commit`, `repository`, `local` |
| `status` | `message` |
| `witness` | Upstream `Separation.as_dict()` |
| `complete` | Upstream report and source metadata |
| `error` | `message` |

Witnesses survive the outer timeout. Status updates flush once per second.
Source lookup and download share a bounded deadline. Unsafe archive paths, symlinks, duplicate fields and nonfinite data are rejected.

Editor saves, autosave and undo use compact version 2 JSON; version 1 object saves also open.
Defaults and empty trailing sides are omitted. IDs, sparse columns and ordered control values are preserved.
Shortcuts define reusable circuits and expand for search without adding generators or axioms. Names must be unique; recursive definitions are rejected.
The editor supports 2–6 polycontrol values and preserves nesting order without assuming extra laws between them.

## Theory zoo

GET `/api/minimality?zoo=1` resolves the current upstream revision and reads only regular `theories/*.json` files, without executing Python.
A warm instance reuses a catalogue only after verifying the same commit. Responses use `Cache-Control: no-store`.
The catalogue strips ignored source annotations and generator matrices; the browser validates the remaining syntax before loading it.

The importer opens editor saves and native upstream JSON, expands repeats and tensors, and routes nonadjacent operations with structural swaps.
Fixed named macros become editable shortcuts where possible. Unsupported syntax or excessive expansion rejects the whole import.
Loading a theory is undoable; refreshing the catalogue never replaces the current draft.
References show pinned arXiv papers or Ask Colin when no reference is known.

Frozen zoo fixtures are stored verbatim under `tests/fixtures/minimality/zoo/`; [source metadata](../tests/fixtures/minimality/source.json) pins their revision.
That checkout declares no separate license. Tests compare the fixture revision with the catalogue's audit boundary.

## Checks

```sh
npm test
npm run test:minimality
python tests/minimality/smoke.py --source-root /path/to/minimality-auto
python tests/minimality/smoke.py
```

Unit and Python tests are network-independent. The smoke test exercises the real upstream search using the selected checkout or GitHub.
With the built API preview running on port 4325, run `npm run test:minimality:browser`.
`MINIMALITY_BASE_URL`, `PLAYWRIGHT_MODULE_DIR` and `PLAYWRIGHT_EXECUTABLE` select another preview or browser.
`MINIMALITY_ZOO_ONLY=1` limits the browser check to zoo imports, references and shortcuts. Reports go to `tmp/minimality/`.

Deployment references: [Python handlers](https://vercel.com/docs/functions/runtimes/python/api-directory), [streaming Python responses](https://vercel.com/docs/functions/streaming-functions#streaming-python-functions).
