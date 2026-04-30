# Release Process

This repository uses a tag-driven GitHub Actions release flow for Windows and macOS artifacts.

## Workflows

- `.github/workflows/auto-tag-on-main.yml`
  - Trigger: push to `main`.
  - Behavior:
    - Skips runs triggered by `[skip ci]` commits.
    - Detects whether `HEAD` is already tagged.
    - If not tagged, increments patch version from latest `v*` tag.
    - Updates `app/package.json` version, commits with `[skip ci]`, and pushes.
    - Creates and pushes an annotated `vX.Y.Z` tag.

- `.github/workflows/release-win.yml`
  - Trigger: push of tags matching `v*`.
  - Manual trigger: `workflow_dispatch` with required `tag` input.
  - Behavior:
    - Checks out the specified tag/ref.
    - Validates release tag format (`vMAJOR.MINOR.PATCH[-PRERELEASE]`).
    - Sets app version from tag.
    - Runs `npm ci`, builds, packages Windows installers via electron-builder, and publishes.
    - Uploads stable alias assets so the README can link to the latest Windows `.exe` and `.msi` installers.

- `.github/workflows/release-mac.yml`
  - Trigger: push of tags matching `v*`.
  - Manual trigger: `workflow_dispatch` with required `tag` input.
  - Behavior:
    - Checks out the specified tag/ref.
    - Validates release tag format (`vMAJOR.MINOR.PATCH[-PRERELEASE]`).
    - Sets app version from tag.
    - Runs `npm ci`, builds, packages macOS artifacts via electron-builder, and publishes.
    - Uploads a stable alias asset so the README can link to the latest macOS `.dmg` installer.

- `.github/workflows/prune-releases.yml`
  - Trigger: `release.published` and manual `workflow_dispatch`.
  - Behavior:
    - Keeps the newest 3 published semver releases by default.
    - Deletes older GitHub releases and their matching Git tags to free storage.
    - Preserves the just-published release even if publish order is unusual.

## Normal Release Path (Automated)

1. Merge changes into `main`.
2. `auto-tag-on-main.yml` bumps patch version, pushes commit, and creates a `v*` tag.
3. `auto-tag-on-main.yml` explicitly dispatches the platform release workflows for the new tag.
4. `release-win.yml` and `release-mac.yml` publish installers to the GitHub release for that tag.
5. When GitHub marks the release as published, `prune-releases.yml` removes older published releases beyond the retention limit.

## Manual Rebuild Path (Existing Tag)

Use this when a release job fails and you need to rebuild artifacts for an existing tag.

1. Open Actions in GitHub.
2. Run `Release Windows` or `Release macOS` manually.
3. Provide `tag` input (for example `v0.2.3`).
4. Verify artifacts are uploaded and published for that tag.

## Best-Practice Guardrails Implemented

- Tag-driven releases (single source of truth).
- Auto-tag workflow dispatches platform builds so workflow-created tags cannot be dropped by GitHub token event restrictions.
- Automatic release retention keeps GitHub storage bounded after new releases are published.
- Explicit tag validation before packaging.
- `npm ci` for deterministic dependency install.
- Concurrency groups to prevent overlapping runs for the same release target.
- Job timeouts to avoid hung builds.
- Minimal workflow permissions (`contents: write`) for release publication.

## Operational Notes

- Keep `app/package-lock.json` committed and up to date.
- Adjust the retention limit in `.github/workflows/prune-releases.yml` if you want to keep more or fewer published releases.
- If the release versioning strategy changes (minor/major bumps), update `auto-tag-on-main.yml` logic.
- If code signing is introduced later, add signing secrets and signing steps in platform workflows.
