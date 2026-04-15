Inkline is a writing app that makes snapshot comparison easy. no more v1.tx v1.2.txt v1.5.6FINAL.txt v2actualfinal.txt!

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

The workflow uploads build artifacts for each OS run. fork and build if you want an executable

Windows release artifacts are code-signed when the signing certificate secrets are configured. See `docs/RELEASE_SECURITY.md` for the signing and secure-update checklist.

## Notes

The app now supports the core project/document/snapshot lifecycle plus a more complete writer-facing interface. Rich text rendering is still markdown-style rather than true WYSIWYG, but the editor, comparison, onboarding, and preferences flows are in place.
