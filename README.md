# Economics Study Hub

An installable web app (PWA) for revising **Edexcel A Level Economics A (9EC0)**.

- Track confidence (Not started / Shaky / Getting there / Confident) and "covered in class" for all 87 subtopics
- Progress overview by theme, plus a **Next up** list of what to revise
- **Ask Claude** buttons open claude.ai with a Teach me / Quiz me / Mark my answer request filled in (or copy it)
- Log quiz scores, marked answers and lessons
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

## Install on a phone

Open the site, then:
- **iPhone (Safari):** Share → Add to Home Screen
- **Android (Chrome):** tap **Install app** in the header, or menu → Install app

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure |
| `styles.css` | Styles (light and dark) |
| `app.js` | App logic and local storage |
| `data.js` | Syllabus: themes, topics, subtopics |
| `sw.js` | Service worker for offline use |
| `manifest.webmanifest`, `icons/` | Install metadata and icons |
