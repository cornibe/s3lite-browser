# S3 Browser

Cross-platform desktop application (Windows + macOS) for browsing S3 buckets and objects.

## Current Layout

## Keyboard

## Security

## Setup
```bash
cd app
npm install
npm run dev
```

## Logs

The app writes human-readable text logs to an OS-native location. One line per event, with time, level, process, pid, sessionId, scope, and key-value meta.

Locations:

- Windows: %LOCALAPPDATA%\S3Browser\Logs\
- macOS: ~/Library/Logs/S3Browser/
- Linux: $XDG_STATE_HOME/s3-browser/logs/ or ~/.local/state/s3-browser/logs/, fallback ~/.cache/s3-browser/logs/

File naming: s3-browser-YYYYMMDD.log (with .1/.2/.3 rotated at 10 MB).

Levels: TRACE, DEBUG, INFO, WARN, ERROR, FATAL.

Defaults: DEBUG in dev; INFO in production. Override with env S3B_LOG_LEVEL or CLI --log-level=LEVEL. CLI wins over env.

At runtime, open the View -> Logging menu to change the level and to open the logs folder.

To collect logs for support:

1. Set S3B_LOG_LEVEL=trace and restart the app, or change via menu.
2. Reproduce the issue.
3. Use View -> Open Logs Folder and attach the latest s3-browser-YYYYMMDD.log files.


## Build
```bash
npm run make
```

## Release (Windows)

Tagged releases build Windows installers automatically via GitHub Actions.

- Trigger: push a semver tag like `v0.1.0` to the repository.
- Outputs: NSIS `.exe`, MSI `.msi`, and `latest.yml` update manifest.
- Where: attached to the GitHub Release created by the workflow; also uploaded as workflow artifacts for download from the run page.

Local build to reproduce release outputs:

```bash
cd app
npm install
npm run build:win
```

Notes:

- Binaries are unsigned, so Windows SmartScreen may warn on first run. Code signing will remove this in a future update.
- The build outputs are written to `app/dist/` locally.

## Project Structure
See [AGENTS.md](./AGENTS.md) for structure and best practices.
