# Economics Study Hub

An installable web app (PWA) for revising **Edexcel A Level Economics A (9EC0)**.

- Track confidence (Not started / Shaky / Getting there / Confident) and "covered in class" for all 87 subtopics
- Progress overview by theme, plus a **Next up** list of what to revise
- **Built-in tutor chat** (Claude API): Teach me, Quiz me and Mark my answer, with diagrams, web-checked figures and photo uploads of handwritten answers
- The tutor updates confidence ratings, adds notes and logs lessons, quizzes and marked answers automatically
- Manual logging of results too
- Works offline, installs to your home screen, light/dark theme
- Progress is saved on the device; export/import a JSON backup to move it

## Run locally

No build step. Serve the folder over HTTP (service workers don't run from `file://`):

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy

`.github/workflows/pages.yml` publishes the app to GitHub Pages on every push to `main`.
In the repo's **Settings → Pages**, set **Source** to **GitHub Actions** once.

## Tutor setup

The tutor calls the Claude API directly from the browser using the student's own API key
(console.anthropic.com → API keys), entered under **Settings**. The key is stored only in the
device's local storage and sent only to `api.anthropic.com`. This suits a single user on their own
device; don't use this approach to share one key with other people.

- `tutor.js`: the tutor's instructions (adapted from the Teach me / Quiz me / Mark my answer skills) and the tracker tools
- `chat.js`: chat screen, streaming, tool loop, cost estimate
- Model (Opus 5.5 or Sonnet 5.5) and web search are set in **Settings** and apply to new chats

### Vendored libraries

`vendor/` holds browser bundles of `@anthropic-ai/sdk@1.3.0`, `marked@18.1.1` and `dompurify@3.4.17`, built with esbuild:

```sh
npm install @anthropic-ai/sdk@1.3.0 marked@18.1.1 dompurify@3.4.17 esbuild
echo 'export { default } from "@anthropic-ai/sdk"; export * from "@anthropic-ai/sdk";' > entry-sdk.mjs
echo 'export { marked, Marked } from "marked"; export { default as DOMPurify } from "dompurify";' > entry-md.mjs
npx esbuild entry-sdk.mjs --bundle --format=esm --platform=browser --minify --legal-comments=eof --outfile=vendor/anthropic-sdk.js
npx esbuild entry-md.mjs --bundle --format=esm --platform=browser --minify --legal-comments=eof --outfile=vendor/markdown.js
```

## Install on a phone

Open the site, then:
- **iPhone (Safari):** Share → Add to Home Screen
- **Android (Chrome):** tap **Install app** in the header, or menu → Install app

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure |
| `styles.css` | Styles (light and dark) |
| `app.js` | Hub screen logic |
| `store.js` | Progress, notes and activity, saved in local storage |
| `tutor.js` | Tutor instructions and tracker tools |
| `chat.js` | Tutor chat (Claude API) |
| `vendor/` | Bundled Claude SDK, Markdown renderer and sanitiser |
| `data.js` | Syllabus: themes, topics, subtopics |
| `sw.js` | Service worker for offline use |
| `manifest.webmanifest`, `icons/` | Install metadata and icons |
