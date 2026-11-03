# Third-party notices

CheatWall uses the packages below. Each keeps its own licence. They are installed with `npm install` and are not copied into this repository, except where noted.

| Package | Licence | Use |
| --- | --- | --- |
| [KaTeX](https://github.com/KaTeX/KaTeX) | MIT | Formulas on posters. Its fonts are inlined into poster pages |
| [@fontsource-variable/inter](https://github.com/fontsource/font-files) (Inter) | SIL Open Font License 1.1 | Poster and site font, inlined into poster pages and PDFs |
| [@fontsource-variable/jetbrains-mono](https://github.com/fontsource/font-files) (JetBrains Mono) | SIL Open Font License 1.1 | Code font, inlined into poster pages and PDFs |
| [playwright-core](https://github.com/microsoft/playwright) | Apache-2.0 | Drives a local Chrome or Chromium to export PDF and PNG |
| [zod](https://github.com/colinhacks/zod) | MIT | Poster content validation |
| [@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript) | Apache-2.0 | Optional text provider (`PROVIDER=anthropic`) |
| [TypeScript](https://github.com/microsoft/TypeScript) | Apache-2.0 | Type checking (dev only) |
| [@types/node](https://github.com/DefinitelyTyped/DefinitelyTyped), [@types/katex](https://github.com/DefinitelyTyped/DefinitelyTyped) | MIT | Type definitions (dev only) |

Chrome or Chromium is not bundled. You install it yourself.

The sample posters in `public/assets/samples/` and the text in `src/ai/fake-data.ts` were written for this project.

Package licence texts are in each package's folder under `node_modules/` after install.
