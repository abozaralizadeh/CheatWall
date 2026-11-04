# CheatWall

CheatWall uses AI to make big, print-ready cheat sheet posters for any topic you study. You type a topic, and you get a poster as a PDF and a PNG. Most topics fit on A2. Big ones (a whole language, library or field) grow to A1 or A0.

![Demo: type a topic, get a poster, switch colours, download](docs/demo.gif)

*Demo of the real app. The poster text comes from the local fake AI provider, not a real model.*

Intro page and install guide: https://abozaralizadeh.github.io/CheatWall/

Source available, free for non-commercial use (PolyForm Noncommercial 1.0.0). See [License](#license).

"CheatWall" is a working name.

## Status

Early. The site, job queue, limits, poster layout and PDF export all work and are tested. The poster text comes from a local fake provider with sample data, so real AI quality and cost are not measured yet. The Azure OpenAI and Anthropic providers are written but have only run against mocks.

## How it works

1. You send a topic, and optionally a level.
2. The server checks your limit and the daily caps (money, tokens and AI requests).
3. A background job checks the topic, writes the poster as structured data, and reviews it in a second pass.
4. Our templates draw the poster. A headless Chrome fits it to one page and exports a PDF and a PNG.

The AI only writes data. An image model never draws words. Topics and AI output are untrusted, so everything is escaped and the poster is rendered in a browser with no network.

## Quick install

You need Node 24 or newer and a Chrome or Chromium (found automatically, or set `CHROME_PATH`).

```bash
git clone https://github.com/abozaralizadeh/CheatWall.git
cd CheatWall
npm install
cp .env.example .env
npm start
```

Open http://127.0.0.1:3000. The default provider is the local fake: it needs no key and costs nothing. It has handwritten posters for SQL, Spanish verbs and organic chemistry, and a labelled placeholder for any other topic.

To try a real model, set `PROVIDER=azure` and the `AZURE_OPENAI_*` values in `.env` (a fallback deployment is optional), or `PROVIDER=anthropic` and `ANTHROPIC_API_KEY`. Keep the daily caps low for the first runs. They're checked before every AI call.

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

109 tests, about 5 minutes, because some of them drive a real browser. `node scripts/prefix-check.ts` also makes a poster in a real browser with the site served under `/cheatwall/`, the way a shared nginx serves it.

## Run it on a VM

On a VM of its own:

```bash
sudo ./setup_service.sh                                   # first run installs, later runs update and restart
sudo CHEATWALL_DOMAIN=example.com -E ./setup_service.sh   # also sets up Caddy for HTTPS
journalctl -u cheatwall.service -f                        # live logs
```

A rotating log file (10 MB x 5) is kept in `/var/lib/cheatwall/logs/`. Secrets live in `/etc/cheatwall/cheatwall.env`, never in the repo. `.env.example` lists every setting.

On a VM you share with other sites, behind an nginx you already run, under a path:

```bash
sudo SERVICE_NAME=cheatwall PORT=8603 BASE_PATH=/cheatwall/ NGINX_SNIPPET=/etc/nginx/snippets.d/cheatwall.conf ./setup_service.sh
journalctl -u cheatwall -f
```

This mode installs nothing: no apt, no Caddy, no firewall rules. It stops with a clear message if Node 24, nginx or a working Chromium is missing. It runs the app in place as the folder's owner, keeps `./.env`, and writes only two nginx files: the snippet (a location block for the path) and a rate limit zone in `/etc/nginx/conf.d/`. If `nginx -t` fails, both go back to how they were. Your nginx server block has to include the snippet folder.

Neither mode has been run on a real VM yet, so read the script before you use it.

## What is real and what is faked

| Part | State |
| --- | --- |
| Site, job queue, SQLite, limits, daily caps, expiry, logs | Real, tested |
| Serving under a path like `/cheatwall/` | Real, tested, and checked in a real browser behind a local proxy |
| Poster templates, fit to page, A2 PDF and PNG growing to A1 or A0 for big topics, three themes | Real, tested with a real Chrome |
| Repairing AI answers that go over a limit (long cells, wide tables, long lists) | Real, tested with fixtures shaped like real failed answers |
| Text provider | Fake by default (`PROVIDER=fake`) |
| Azure OpenAI provider with fallback (`src/ai/azure.ts`) | Written, tested only against a mocked API |
| Anthropic provider (`src/ai/anthropic.ts`) | Written, tested only against a mocked client |
| `setup_service.sh`, `.vscode` config | Written, not run on a VM or opened in VS Code |
| Privacy, terms, about pages | Templates with `[placeholders]`. Fill them in and have them reviewed before you run a public site |

## Docs

- [docs/DESIGN.md](docs/DESIGN.md): architecture and the reason for each decision
- [docs/LOGICAL-FLOW.md](docs/LOGICAL-FLOW.md): the main flows
- [docs/OPEN-WORK.md](docs/OPEN-WORK.md): known issues and what is left
- [demos/README.md](demos/README.md): how the demo was recorded
- [docs/PHASE1-RESULTS.md](docs/PHASE1-RESULTS.md): the ten-topic layout test with the fake provider

Code layout: `src/` (server, jobs, store, limits, `ai/`, `render/`), `public/` (the site), `scripts/`, `tests/`. Node runs the TypeScript directly, so there is no build step. Don't use enums or `constructor(private x)` parameter properties, because type stripping doesn't support them.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Short version: open an issue before a big change, run `npm test` and `npm run typecheck`, never commit real keys, and know that contributions are accepted only if you agree that Abozar Alizadeh may relicense them, commercial use included.

## License

Source available, free for non-commercial use under the [PolyForm Noncommercial License 1.0.0](LICENSE). You can use, study and change it for non-commercial purposes. Commercial use needs written permission: ask by opening a GitHub issue. This is not an open source licence, because it does not allow commercial use.

Third-party packages keep their own licences, listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
