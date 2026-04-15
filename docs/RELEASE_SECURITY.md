# Release Security

Inkline release builds are bundle-ready and the GitHub Actions workflow signs Windows installer artifacts when signing secrets are present.

## Windows code signing

Add these repository secrets before publishing Windows releases:

- `WINDOWS_CODESIGN_PFX_BASE64`: Base64-encoded `.pfx` code-signing certificate.
- `WINDOWS_CODESIGN_PFX_PASSWORD`: Password for that `.pfx`.

The workflow signs `.exe` and `.msi` files with SHA-256 and a trusted timestamp after `npm run tauri:build` finishes. Keep the certificate outside the repo and rotate it if a secret is exposed.

## Secure updates

Use Tauri updater signing for app updates. Generate an updater keypair on a trusted machine, keep the private key in GitHub Actions secrets, and commit only the public key into app configuration when the updater endpoint is ready.

Recommended secrets:

- `TAURI_SIGNING_PRIVATE_KEY`: Private updater signing key.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: Password for the updater signing key.

Recommended release flow:

- Publish only signed Windows bundles.
- Generate update metadata from CI, not from a developer laptop.
- Serve update metadata and artifacts over HTTPS.
- Pin the updater public key in the app before enabling automatic update checks.
- Treat every update artifact as immutable once it is attached to a release.

