# CheatWall

CheatWall uses AI to make big, print-ready cheat sheet posters for any topic you study. You type a topic, and you get an A2 poster as a PDF and a PNG.

"CheatWall" is a working name.

## Status

Early. The site, job queue, limits, poster layout and PDF export all work and are tested. The poster text comes from a local fake provider with sample data, so real AI quality and cost are not measured yet. The Anthropic provider is written but has only run against a mocked client. Nothing here has been deployed.

## How it works

1. You send a topic, and optionally a level.
2. The server checks your limit and the daily spend cap.
3. A background job checks the topic, writes the poster as structured data, and reviews it in a second pass.
4. Our templates draw the poster. A headless Chrome fits it to one page and exports a PDF and a PNG.

The AI only writes data. An image model never draws words. Topics and AI output are untrusted, so everything is escaped and the poster is rendered in a browser with no network.

## Quick install

You need Node 24 or newer and a Chrome or Chromium (found automatically, or set `CHROME_PATH`).

```bash
npm install
cp .env.example .env
npm start
```

Open http://127.0.0.1:3000. The default provider is the local fake: it needs no key and costs nothing. It has handwritten posters for SQL, Spanish verbs and organic chemistry, and a labelled placeholder for any other topic.

To try a real model, set `PROVIDER=anthropic` and `ANTHROPIC_API_KEY` in `.env`. Keep `DAILY_CAP_CENTS` low for the first runs.

Other commands:

```bash
npm run poster -- "SQL" --theme midnight   # topic in, PDF and PNG out in ./out
npm run phase1                             # ten topics, writes docs/PHASE1-RESULTS.md
npm run typecheck
```

## Run the tests

```bash
npm test
```

79 tests, about 5 minutes, because some of them drive a real browser.

## Run it on a VM

```bash
sudo ./setup_service.sh                                   # first run installs, later runs update and restart
sudo CHEATWALL_DOMAIN=example.com -E ./setup_service.sh   # also sets up Caddy for HTTPS
journalctl -u cheatwall.service -f                        # live logs
```

A rotating log file (10 MB x 5) is kept in `/var/lib/cheatwall/logs/`. Secrets live in `/etc/cheatwall/cheatwall.env`, never in the repo. `.env.example` lists every setting. The script has not been run on a real VM yet, so read it before you use it.

## What is real and what is faked

| Part | State |
| --- | --- |
| Site, job queue, SQLite, limits, daily spend cap, expiry, logs | Real, tested |
| Poster templates, fit to page, A2 PDF and PNG, three themes | Real, tested with a real Chrome |
| Text provider | Fake by default (`PROVIDER=fake`) |
| Anthropic provider (`src/ai/anthropic.ts`) | Written, tested only against a mocked client |
| `setup_service.sh`, `.vscode` config | Written, not run on a VM or opened in VS Code |
| Privacy, terms, about pages | Templates with `[placeholders]`. Fill them in and have them reviewed before you run a public site |

## Docs

- [docs/DESIGN.md](docs/DESIGN.md): architecture and the reason for each decision
- [docs/LOGICAL-FLOW.md](docs/LOGICAL-FLOW.md): the main flows
- [docs/OPEN-WORK.md](docs/OPEN-WORK.md): known issues and what is left
- [docs/PHASE1-RESULTS.md](docs/PHASE1-RESULTS.md): the ten-topic layout test with the fake provider

Code layout: `src/` (server, jobs, store, limits, `ai/`, `render/`), `public/` (the site), `scripts/`, `tests/`. Node runs the TypeScript directly, so there is no build step. Don't use enums or `constructor(private x)` parameter properties, because type stripping doesn't support them.

## Contributing

Open an issue before a big change. Run `npm test` and `npm run typecheck` before sending anything, keep the AI provider behind its small module in `src/ai/`, and never commit real keys or a `.env` file. Docs are plain and short, with no marketing words.

## License

To be decided. Until a licence file is added, all rights are reserved.
