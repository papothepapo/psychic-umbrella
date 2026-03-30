# Diff

Diff is a lightweight writing application that feels like a minimal word processor while storing version history in Git transparently.

## What is currently implemented

- Cross-platform scaffold using Tauri v2 + React + TypeScript.
- Project creation/listing/renaming/deletion backed by SQLite index (`rusqlite`).
- Project folder creation in `~/Diff/<project-id>` with `document.md`, `document.comments.json`, and a hidden Git repo.
- Autosave to `document.md` after inactivity.
- Save Point creation through the Rust backend with `git2` commit creation.
- Timeline loading from Git history with change-size metadata.
- Document-at-save-point loading from commit tree.
- Paragraph-level diff command with word-level refinement.
- Comment thread persistence in `document.comments.json`.
- Basic merge import + conflict block generation.
- Settings persistence in `~/.Diff/.diff-config.json`.

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

The app now has working end-to-end local flows for core project/document/save point lifecycle, but rich TipTap editor UX and full production polish are still iterative improvements.
