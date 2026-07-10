# Repository Guidelines

## Project Structure & Module Organization

This repository is a static open-campus site. The root `index.html`, `styles.css`, and `app.js` define the top page. Interactive demos live in feature folders: `dowsing/`, `monty/`, and `clustering/`, each with its own HTML, CSS, and JavaScript. Shared data is in `data/`; generated research-map output is `data/clustering-analysis.json`. Slides are stored in `slides/`, third-party browser libraries in `vendor/`, and utility scripts in `tools/`.

## Build, Test, and Development Commands

- `python3 -m http.server 8000`: serve the static site locally from the repository root. Open `http://localhost:8000`.
- `node tools/build-clustering-data.js`: regenerate `data/clustering-analysis.json` from `data/teachers.json`. This requires network access for the kuromoji dictionary.
- `git diff --check`: check for whitespace errors before committing.

There is no package manager setup or build step for normal page edits.

## Coding Style & Naming Conventions

Use plain HTML, CSS, and JavaScript without adding a framework unless the project explicitly needs it. Existing browser scripts use IIFEs with `"use strict"`, `const`/`let`, double-quoted strings, semicolons, and camelCase names. Keep DOM selectors and state close to the feature folder they support. CSS uses class-based selectors, custom properties in `:root`, and kebab-case class names such as `.hero-actions`.

Preserve Japanese interface text and terminology. Keep generated JSON compact unless the generator is intentionally changed.

## Testing Guidelines

No automated test suite is currently configured. Validate changes manually in a local browser through the static server. For UI work, check the top page and any affected feature page at desktop and mobile widths. For clustering-data changes, run `node tools/build-clustering-data.js` and review the resulting `data/clustering-analysis.json` diff.

## Commit & Pull Request Guidelines

Recent commits follow a Conventional Commit style, often in Japanese, such as `feat: 研究分野マップ...`, `fix: モバイル...`, and `chore: GitHub Actions...`. Use a concise type prefix (`feat:`, `fix:`, `chore:`, `docs:`) and describe the user-visible change.

Pull requests should include a short summary, affected pages or scripts, manual verification steps, and screenshots for visual changes. Link related issues when available. If `data/teachers.json` changes, mention whether `data/clustering-analysis.json` was regenerated.

## Security & Configuration Tips

Do not commit secrets or local environment files. Keep external dependencies explicit: browser libraries belong in `vendor/`, and remote dictionary usage should stay documented in `README.md` and relevant scripts.
