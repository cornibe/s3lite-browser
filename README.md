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

## Project Structure
See [AGENTS.md](./AGENTS.md) for structure and best practices.
