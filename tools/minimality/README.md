# Minimality prototype backend

`api/minimality.py` is a Vercel Python function. Install the runtime dependency
with `python -m pip install -r requirements.txt`. It uses the existing Astro
frontend and the file-based `/api/minimality` route; no Python framework preset
is required. `vercel.json` sets a 90-second function duration.

For each submitted theory, the production endpoint resolves the current `main`
commit of [Sukyn/minimality-auto](https://github.com/Sukyn/minimality-auto), downloads
that exact revision, and copies only regular Python package files into a temporary
directory. It never falls back to a bundled or cached revision. The stream records
the commit and repository so a result can be traced to its source.

`GET /api/minimality?zoo=1` returns the official theory zoo as one JSON document:
`{repository, commit, theories: [{id, name, theory, arxiv?}]}`. Each request resolves the
current GitHub commit. A warm instance reuses its last catalog only when that
verified commit is unchanged; a new commit downloads and reads only regular,
direct `theories/*.json` files from the pinned archive. Listing does not import
or execute downloaded Python. After validating the raw JSON, it removes ignored
source annotations, wire dimensions, and generator matrices, keeping a compact
arXiv identifier separately when a paper is identified, and reduces fixed
generator definitions to their arities. Other fields remain for the browser's
syntax importer to assess compatibility. The compact JSON response uses
`application/json` and `Cache-Control: no-store`; there is no stale fallback.
The catalog is limited to 64 entries, 128 KB per file, 1 MB total JSON, and 32
levels of JSON nesting. Duplicate fields and filenames, nonfinite numbers,
symlinks, and unsafe file paths are rejected. GitHub lookup and download share
a 20-second deadline. Other GET requests retain the existing method error.

The sidebar's Theory zoo selector loads that catalog and checks each presentation
against the editor's limits. Unavailable entries remain visible in dark gray,
with the reason in their tooltip. Reload checks GitHub again. Loading a theory
is an ordinary undoable edit; catalog loading never replaces the current draft.
Figure annotations are omitted from zoo names. See references lists each zoo
theory's arXiv paper, including unavailable theories, or Ask Colin when no arXiv
reference is known. References use the site's shared content dialog.
Open accepts both saved editor drafts and native minimality-auto JSON. The syntax
importer ignores semantics and preserves fixed named macros as editable shortcuts,
including nested and unused library definitions. Aliases that cannot fit the
shortcut editor remain inline. Repeats and tensors expand, and ordered or
nonadjacent gate placements route through structural swaps. It cancels only
adjacent identical structural swaps and schedules disjoint operations in parallel.
Unsupported forms or bounds reject the whole import without partially loading it.

The JSON request accepts only `theory` and `timeout`. A theory contains a name,
generator objects with a scalar `type`, and equations with `id`, `lhs`, `rhs`.
Its optional `structure` is `PRO` (the default) or `PROP`; the wrapper validates
this setting and removes it before calling upstream.
Each circuit side is `{ "wires": 2, "ops": [{ "gen": "g", "on": [0] }] }`.
Generator placements must be consecutive and ordered. In `PROP`, structural
swaps are full-register permutation operations, such as `{ "perm": [0, 2, 1] }`
on three wires. Each list gives the input wire at each output position and must
contain every wire exactly once; it has no `on` or generator field. `PRO`
rejects these operations. Swap-only `PROP` theories can have zero generators;
`PRO` requires at least one.

Generator arities are endomorphisms from 0 to 6; the API limits theories to 12 generators,
24 equations, 128 expanded operations per side, and 30 seconds of search time.
The editor retains 64 drawn gates and 16 columns per circuit side; shortcut
definitions can use other shortcuts to keep larger circuits compact.

Braided, controlled, and polycontrolled presentations cannot currently be searched:
upstream has no corresponding native nodes or category modes. Search rejects
these structures and operations explicitly; controls are never erased or turned
into ordinary generators. Only `PRO` and `PROP` presentations run upstream.

Saves, autosave, and undo history use compact version 2 JSON. Generators are
`[id, name, arity]`, equations are `[id, name, wires, left?, right?]`, and gates
are `[id, generator, wire, column, controls?]`. Controls are ordered
`[wire, value]` pairs. Empty trailing equation sides and default settings
(`PRO`, two control values) are omitted. IDs, sparse columns, categorical
structure, and control order are preserved. Version 1 object-based saves still
open; the editor keeps its existing autosave key so older drafts are recovered.
Unsupported structures can be saved and reopened while search and backend
export remain blocked for them.

Shortcuts below the generators define named circuits such as `X = H Z H`.
They use the same circuit editor and can be placed as gates in equations or
other shortcut definitions. Names cannot collide with generators, recursive
definitions are rejected, and referenced definitions cannot be removed.
Compact saves keep optional `[id, name, wires, body?]` shortcut tuples. Search
expands shortcuts into their underlying operations; they add no generators or
axioms. Expanded equation sides use the separate 128-operation request limit.

The editor's `+` menu includes swaps in PROP and controlled modes, and separate
crossings and inverse crossings in Braided mode. In controlled modes, select
gates by tapping them, then use `Control…` on that side; with no selection, it
controls the whole side. Choose a free wire or add one above/below the equation.
Controls can be repeated or removed, and each action is one undo step.
Polycontrolled mode offers 2–6 control values and preserves their nesting order;
it does not assume extra laws between different values. Incompatible category
changes are rejected without modifying the saved diagram.

The wrapper converts matrix-free generator definitions to upstream's bare arity
format and calls its `search_theory` with presence, modular counting (modulus at
most 6), and finite permutation models (degree at most 4). These exact strategies
can certify independence. A missing separator is unresolved, including after a
timeout. No result certifies completeness of the entered presentation.

Responses use `application/x-ndjson`, with one JSON event per line:

- `source`: `commit`, `repository`, `local`.
- `status`: `message`.
- `witness`: upstream `Separation.as_dict()` as `witness`.
- `complete`: upstream `SearchReport.as_dict()` as `report`, plus source fields.
- `error`: `message`.

The child process receives no deployment credentials. Its deadline is enforced
outside the search process; streamed witnesses are retained if the hard deadline
is reached. A disconnected client terminates the child when the next stream write
detects the closed connection. Search status is flushed once per second.

GitHub source lookup uses the public API. Optionally set a server-side
`MINIMALITY_GITHUB_TOKEN` with read access to public repository metadata to obtain
the authenticated GitHub request allowance. This token is used only for the fixed
GitHub API URL and is never passed to the search subprocess or browser.

For local development, start both the Python API and Astro with one command:

```powershell
npm run dev
```

The launcher waits for the API on port 8787 before starting Astro, forwards
arguments such as `npm run dev -- --port 4325`, and stops both servers when you
press Ctrl+C. An existing API is reused only after its health response confirms
the expected service, website checkout, source mode, and loaded backend revision.
After editing the Python endpoint or dev wrapper, restart `npm run dev`; an older
API is rejected with restart guidance. Both dev and deployed searches fetch the
current GitHub revision on every run.

The managed Astro instance runs in the foreground and can start alongside an
existing dev server without replacing it. `--background` is incompatible with
the launcher because the Python API shares the same lifetime.

Python 3.11+ and NumPy are required. The launcher checks the project's `.venv`
before interpreters on your PATH. A standard setup in PowerShell is:

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
npm run dev
```

On macOS/Linux, use `.venv/bin/python` for the installation command. Set
`MINIMALITY_PYTHON` to choose another interpreter, for example
`$env:MINIMALITY_PYTHON = "C:/path/to/python.exe"` in PowerShell.
`MINIMALITY_API_PORT` can select a different API port
when 8787 is occupied. To use an explicit offline upstream checkout during local
development, set `MINIMALITY_SOURCE_ROOT`:

```powershell
$env:MINIMALITY_SOURCE_ROOT = "C:/path/to/minimality-auto"
npm run dev
```

For a preview of the built site and API on one origin, including environments
where Astro's development server is unavailable:

```powershell
npm run build
python tools/minimality/dev.py --static-dir dist --port 4325
```

Open `http://127.0.0.1:4325/minimality/`. Add `--source-root` for an explicit
local upstream checkout, or `--temp-root tmp/minimality-dev` if the host's default
temporary directory is restricted.
The explicit local source mode also reads its catalog from that checkout's
`theories/` directory with the same JSON bounds.

Only the development launchers can select local source; the deployed handler has no
environment variable or request field that overrides the GitHub repository. Such
runs are labeled `local: true` in the event metadata.

Run the network-independent checks with:

```powershell
python -m unittest discover -s tools/minimality -p "test_*.py" -v
```

Exercise the real upstream search with a local checkout or a fresh GitHub download:

```powershell
python tools/minimality/smoke.py --source-root C:/Users/cblake/Documents/minimality-auto
python tools/minimality/smoke.py
```

The smoke check reads the real zoo catalog, including Qubit Clifford, and covers
both a generator relation and structural swaps. It finds
an exact parity separator for `swap = identity`, while `swap² = identity` stays
unresolved because it is already a structural PROP law.

With the built preview running on port 4325, run the browser checks with:

```powershell
node tools/minimality/browser.mjs
```

They exercise editing, drag-and-drop, touch and keyboard controls, persistence,
and a real search. Screenshots and accessibility results go to `tmp/minimality/`.
`MINIMALITY_BASE_URL`, `PLAYWRIGHT_MODULE_DIR`, and `PLAYWRIGHT_EXECUTABLE` can
select another local preview and installed browser runtime.
Set `MINIMALITY_ZOO_ONLY=1` to check just zoo imports, references, and shortcut
editing on desktop and mobile.

The deployment pattern follows Vercel's documentation for
[file-based Python handlers](https://vercel.com/docs/functions/runtimes/python/api-directory)
and [streaming Python responses](https://vercel.com/docs/functions/streaming-functions#streaming-python-functions).
