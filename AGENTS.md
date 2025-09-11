# AGENTS.md
**Project:** Cross-Platform S3 Browser  
**Stack:** Electron + React + TypeScript + Tailwind + AWS SDK v3  

## Overview
This project is a cross-platform desktop application (Windows + macOS) that enables users to browse, upload, download, and manage S3 objects.

## Project Structure
app/
  electron/
    main.ts
    preload.ts
    ipc.ts
    s3.ts
    updater.ts
    types.ts
  src/
    main.tsx
    App.tsx
    lib/
      store.ts
      query.ts
    components/
      Topbar.tsx
      SidebarBuckets.tsx
      ObjectExplorer.tsx
      TransferQueue.tsx

## Guidelines
- Use TypeScript everywhere
- TailwindCSS for styling
- React functional components only
- AWS SDK only in main process
- Typed IPC contracts in types.ts

## Best Practices
- Never expose AWS credentials in renderer
- Use pagination for S3 listings
- Small, composable functions
- Unit test services
- Accessible, responsive UI
