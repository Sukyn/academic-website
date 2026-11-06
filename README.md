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

`npm run dev` starts Astro and the `/minimality/` Python search API together.

Documentation: [development](docs/development.md), [game tools](docs/games.md), [Minimality](docs/minimality.md).
