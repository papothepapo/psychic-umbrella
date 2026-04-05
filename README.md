# Inkline

Inkline is a writing studio that keeps the drafting surface calm while making snapshot comparison a first-class part of the workflow.

## What is currently implemented

- Cross-platform scaffold using Tauri v2 + React + TypeScript.
- Project creation/listing/renaming/deletion backed by SQLite index (`rusqlite`).
- Project folder creation in `~/Inkline/<project-id>` with `document.md`, `document.comments.json`, and a hidden Git repo.
- Autosave to `document.md` after inactivity.
- Save Point creation through the Rust backend with `git2` commit creation.
- Dual snapshot timelines for left/right comparison selection.
- Timeline loading from Git history with change-size metadata.
- Document-at-save-point loading from commit tree.
- Side-by-side and unified Changes views with paragraph and line-based comparison modes.
- Writer-facing ribbon controls for fonts, spacing, page width, and inline formatting helpers.
- Comment thread persistence in `document.comments.json`.
- Basic merge import + conflict block generation.
- Settings persistence in `~/Inkline/.inkline-config.json` with legacy Diff paths migrated forward when present.

## Development

```bash
pnpm install
pnpm dev
```

## Build desktop app

```bash
pnpm tauri:build
```

## CI/CD

GitHub Actions workflow is included to build artifacts for:
- Windows (`.exe`/MSI bundles via Tauri bundler)
- Linux
- macOS

The workflow uploads build artifacts for each OS run.

## Notes

The app now supports the core project/document/snapshot lifecycle plus a more complete writer-facing interface. Rich text rendering is still markdown-style rather than true WYSIWYG, but the editor, comparison, onboarding, and preferences flows are in place.
