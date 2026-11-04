# Open work

Known issues and what is left on the technical side.

## Known issues

- Sections can't split across columns, so one column can end shorter than the others.
- Very thin content (under about 15 lines) leaves white space, because text size and gaps are capped.
- On a big poster, a 6-column table in one text column gets narrow and wraps a lot. Tables can't span two columns yet.
- A text cut by the repair step ends in an ellipsis. It's rare with the current limits, but it can cut a useful detail.
- The failed and expired pages have not been checked in a browser yet.
- The site screens are only checked for basics (labels, alt text, contrast on posters), not against a full accessibility audit.

## Not proven yet

- The Anthropic provider has never run against the real API. The writing and review prompts are untried on a real model.
- Big posters (A1 and A0) are tested with the fake provider and fixtures shaped like real answers, not yet with a real model. A big poster uses three long AI calls, so a 200k daily token budget allows only a handful of them a day.
- Real poster quality, time and cost per poster are unmeasured. `npm run phase1` should be re-run with a real provider.
- Refusal fallbacks in the Anthropic provider are not turned on. Decide whether to.
- `setup_service.sh` has not been run on a real VM, and the `.vscode` config has not been opened in VS Code.

## Ideas, in rough order

1. Edit the text on the poster before download.
2. Accounts, and a page that keeps your posters.
3. More sizes and layouts, including wide formats.
4. Other languages, including right-to-left scripts.
5. A poster made from your own notes or a PDF.
6. Diagrams and decorative images. Images must never contain text.
7. Code highlighting (Shiki) in code sections.

## Deploy checklist

- [ ] Run `setup_service.sh` on a fresh VM and check `journalctl -u cheatwall.service -f`
- [ ] Check HTTPS through Caddy
- [ ] Restore a database backup once
- [ ] Load test with several posters at once
- [ ] Fill in the placeholders in the privacy, terms and about pages
