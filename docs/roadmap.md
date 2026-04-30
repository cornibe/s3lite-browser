# Roadmap

This roadmap focuses on the highest-leverage product work for S3 Browser-lite based on the current codebase and shipped features.

## Current focus

### 1. In-S3 object operations

Why:
- The app already handles browse, upload, download, create, delete, and preview well.
- Copy, move, and rename are the biggest day-to-day workflow gaps for S3 users.
- Move and rename can build on the same copy primitive.

Planned slices:
- Copy object to another key
- Copy object to another bucket
- Move object (copy plus delete)
- Rename object in place
- Recursive folder copy/move

Status:
- Implementation started in this branch with the first slice: copy object.

### 2. Rich object metadata and tags

Why:
- The Properties panel currently exposes only shallow fields.
- Metadata and tag inspection are explicitly incomplete in the current UI.

Planned slices:
- Read object metadata from S3
- Read object tags
- Show content headers and storage details
- Edit metadata and tags on copy or replace

Status:
- In progress: object Properties now load head metadata and tags for the selected object.

### 3. Presigned URL generation

Why:
- This is a common, high-value workflow for desktop S3 tools.
- It fits naturally beside existing copy path actions.

Planned slices:
- Generate download URL
- Generate upload URL
- TTL presets and custom expiration
- Copy link and show expiration details

## Next tier

### 4. Version history and recovery

Planned slices:
- List object versions and delete markers
- Restore or download a prior version
- Surface version-aware delete behavior

### 5. Recursive search across prefixes

Planned slices:
- Search by key name under a bucket or prefix
- Filter by extension, size, and last modified
- Reuse recursive listing infrastructure

## Supporting engineering work

### Testing and reliability

Planned slices:
- Add focused tests around the Electron S3 service layer
- Add tests for new object-operation helpers
- Keep renderer features thin and typed over IPC

### UX polish

Planned slices:
- Better progress and completion feedback for object operations
- Consistent action affordances between context menu and bottom toolbar
- Theme-safe modals and empty states for new workflows