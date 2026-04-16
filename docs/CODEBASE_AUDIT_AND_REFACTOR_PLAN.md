# Inkline Codebase Audit And Refactor Plan

## Purpose

This document is for an agent continuing refactor work on Inkline. The goal is to harden the app without changing core behavior: writing, formatting, snapshots, comparison mode, project switching, import/export, and release builds must keep working after each phase.

## Current High-Risk Areas

1. `src/App.tsx` is too large.
   It currently owns application boot, project lifecycle, editor DOM manipulation, snapshot comparison, import/export, settings, and most UI rendering. This makes regressions likely because small editor or settings changes can accidentally affect unrelated panels.

2. The editor uses direct `contentEditable`, `innerHTML`, selections, and `document.execCommand`.
   This is the main source of cursor, Enter-key, formatting, and large-document instability. It can be made reliable, but the DOM write path needs clearer ownership and tests around selection preservation.

3. Frontend and backend command surfaces do not match cleanly.
   The backend exposes comment and merge commands that the frontend does not call. The frontend exposes `api.computeDiff`, but the UI computes comparison blocks locally. These may be unfinished features or orphaned code and should be classified before removal.

4. Dependencies include unused editor/diff packages.
   `@tiptap/*` and `diff-match-patch` are present in `package.json` but are not imported under `src/`. Either reintroduce them intentionally or remove them to reduce bundle and maintenance surface.

5. Release tooling needs strict reproducibility.
   The repository has `pnpm-lock.yaml`, so CI should install with pnpm and a frozen lockfile. Rust `Cargo.lock` should also be refreshed whenever Rust dependencies change.

6. Native app hardening is incomplete.
   Windows code signing guidance exists in `docs/RELEASE_SECURITY.md`, but automatic updater configuration is still a planned task rather than an implemented path.

## Changes Already Completed In This Pass

1. Export now uses the Tauri native save dialog for non-PDF exports instead of `window.prompt`.

2. Project opening no longer uses a stale React `project.id` when loading the latest snapshot preview. This addresses the misleading `object not found - no match for id` error after creating or switching projects.

3. Enter handling now clamps caret offsets, places the caret inside the new block rather than on the block element boundary, and restores the caret after editor DOM sync.

4. A dead `openProject` parameter was removed.

5. CI now uses pnpm with `--frozen-lockfile` so the checked-in lockfile controls release dependency resolution. The Tauri CLI is a project dev dependency instead of a global CI install.

6. Export helper logic has been extracted into `src/lib/export.ts` as the first Phase 1 cleanup.

## Refactor Phases

### Phase 1: Split The Frontend Into Owned Modules

Goal: reduce `src/App.tsx` from a 3,000-line mixed owner into testable units.

Suggested extraction order:

1. Move pure document helpers into `src/lib/document.ts`.
   Include frontmatter parsing, composing, HTML normalization, and word/paragraph counts.

2. Keep export helpers in `src/lib/export.ts`.
   Add tests around filename sanitizing and default path generation before changing export behavior again.

3. Move comparison helpers into `src/lib/comparison.ts`.
   Include tokenization, paragraph similarity, inline diff operation generation, and comparison action application.

4. Move settings defaults and normalization into `src/lib/settings.ts`.
   Keep `DEFAULT_SETTINGS`, setting option lists, and `normalizeSettings` together.

5. Move editor selection and formatting helpers into `src/lib/editorDom.ts`.
   Keep all direct DOM selection code behind named helpers so Enter, paste, toolbar formatting, and smart quotes use one path.

6. Split UI panels into components under `src/components/`.
   Start with Settings panel, Changes panel, Project sidebar, Toolbar, and Editor canvas.

Verification after each extraction:

1. Run `pnpm run build`.

2. Manually smoke test typing, bold/color continuation, Enter in empty and non-empty paragraphs, project switching, comparison mode, and export.

3. Do not change behavior in the same commit as a mechanical extraction unless the behavior fix is separately described.

### Phase 2: Stabilize The Editor Engine

Goal: make editing deterministic, especially for large documents and active formatting.

Tasks:

1. Replace scattered `document.execCommand` calls with a small editor command adapter.

2. Add selection round-trip helpers that can restore by logical position if React or normalization rewrites DOM nodes.

3. Add regression tests for:
   - Enter at start, middle, and end of a paragraph.
   - Enter while bold, underline, strike-through, text color, or highlight are active.
   - Pasting rich text and plain text.
   - Large document editing near the bottom of the page.

4. Decide whether to keep the custom editor or intentionally migrate to TipTap.
   If TipTap is not used, remove all unused TipTap dependencies.

### Phase 3: Clean Backend Commands

Goal: make Tauri command APIs intentional and documented.

Tasks:

1. Inventory every `#[tauri::command]` in `src-tauri/src/main.rs`.

2. Mark each command as one of: used, planned, or remove.

3. If comment and merge commands are planned, add frontend API wrappers and UI roadmap notes.

4. If they are not planned, remove the commands and related structs/functions in a separate cleanup commit.

5. Keep project, timeline, import/export, settings, and backup commands covered by manual smoke tests.

### Phase 4: Release And Update Hardening

Goal: make the distributed Windows app trusted and safely updateable.

Tasks:

1. Refresh `src-tauri/Cargo.lock` after any Rust dependency change.

2. Keep GitHub Actions signing secrets documented and required for release tags.

3. Add Tauri updater configuration only after the update endpoint and signing key lifecycle are decided.

4. Generate update metadata in CI, never on a developer laptop.

5. Document the release checklist in `docs/RELEASE_SECURITY.md`.

## Do Not Break

1. A newly created project should open without showing a Git object lookup error.

2. Switching projects should save the current document first, then load the selected project.

3. Export should ask for a destination with the native OS save dialog for file-based exports.

4. `.txt` exports should contain plain document text, not comparison arrows or UI diff markers.

5. Enter should create exactly one new paragraph and keep the caret in the new paragraph.

6. The writing surface and settings panel should remain centered and reachable at normal window sizes.

7. Large documents should not create large blank scroll regions before the bottom bar.

## Recommended Next Agent Prompt

Refactor Inkline by following `docs/CODEBASE_AUDIT_AND_REFACTOR_PLAN.md`. Start with Phase 1. Extract only pure helpers from `src/App.tsx` first, keep behavior unchanged, run `pnpm run build`, and report any behavior that cannot be preserved without a separate bug-fix commit.
