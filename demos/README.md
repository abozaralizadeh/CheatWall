# Demo recording

`tour.json` is the storyboard for the demo video and GIF (made with the demo-recorder tool). The recording uses the real app with the local fake AI provider.

The site sends a strict Content Security Policy, which blocks the recorder's on-screen cursor and captions. So the recording goes through a tiny helper that forwards to the app and drops that one header. The app itself is unchanged.

```bash
PORT=3100 PROVIDER=fake npm start &
node demos/csp-proxy.mjs &      # listens on 3101, forwards to 3100
# then record demos/tour.json with the demo-recorder tool
```

Outputs go to `demos/out/` (not committed). The README GIF is `docs/demo.gif` and the site video is `site/img/demo.mp4`.
