# Demo recording

`tour.json` is the storyboard for the demo video and GIF (made with the demo-recorder tool). The recording uses the real app with the local fake AI provider.

The site sends a strict Content Security Policy, which blocks the recorder's on-screen cursor and captions. So the recording goes through a tiny helper that forwards to the app and drops that one header. The app itself is unchanged.

```bash
PORT=3100 PROVIDER=fake npm start &
node demos/csp-proxy.mjs &      # listens on 3101, forwards to 3100
# then record demos/tour.json with the demo-recorder tool
```

Outputs go to `demos/out/` (not committed). The README GIF is `docs/demo.gif`. The site video `site/img/hero.mp4` is `tour.mp4` with the title cards trimmed off, scaled to 1280 wide, with no audio.

## Site images

The screenshots and posters on the Pages site come from `scripts/site-shots.ts`, which drives a running app with the fake provider and saves PNGs to `out/site/`. Those are then cropped and turned into WebP in `site/img/`. `scripts/site-check.ts` screenshots the site at 1440 and 375 px in both themes, and `--og` also redraws `site/img/og.png` from `scripts/site-og.html`.
