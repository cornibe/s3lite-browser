# S3 Browser

Cross-platform desktop application (Windows + macOS) for browsing S3 buckets and objects.

## Current Layout
- Topbar: Region + optional Profile and Connect.
- Split view: Buckets list (left), Objects explorer (right) with breadcrumb, Up action, and Load more.
- Details panel: Shows metadata for the selected object or folder.

## Keyboard
- Up/Down: Move selection in the objects list
- Enter: Open folder when a folder is selected

## Security
- AWS SDK v3 runs only in the main process. The renderer calls a narrow, typed IPC API via preload. No credentials or profiles are stored or logged in the renderer.

## Setup
```bash
cd app
npm install
npm run dev
```

## Build
```bash
npm run make
```

## Project Structure
See [AGENTS.md](./AGENTS.md) for structure and best practices.
