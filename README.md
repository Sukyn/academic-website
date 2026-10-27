# Academic website

Colin Blake's academic website, built with Astro.

Requires Node 24, Python 3.11+, and NumPy for the minimality search API.

```sh
npm ci
python -m pip install -r requirements.txt
npm run dev
npm test
npm run check
npm run build
```

For local scoring APIs, see [setup](tools/quantum-golf/SETUP.md).

`npm run dev` starts Astro and the `/minimality/` Python search API together.
See its
[local setup and runner](tools/minimality/README.md).
