# AGENTS.md
**Project:** S3 Browser-lite (cross-platform)  
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

## Dark/Light Theme Guidelines

This app ships with a theme system powered by Tailwind v4 and CSS variables defined in `app/src/index.css`. Dark mode is toggled by a `.dark` class on a root element (we apply it to `<html>`). All components must be theme-safe.

Key points:
- Dark mode trigger: add/remove the `.dark` class on `<html>` or set `data-theme="dark"`. Our CSS has `@custom-variant dark (&:where(.dark, [data-theme="dark"]) &));`.
- Colors: use semantic utilities rather than hard-coded hex values. Prefer:
  - `bg-app`, `bg-panel`, `bg-header`
  - `text-app`, `text-muted`
  - `border-default`
  - `row-hover`, `selected-row`, `menu-bg`, `overlay-bg`
  - Inputs: `input-theme`
  - Buttons: `btn`, `btn-secondary`, `btn-primary`
  - Tabs: `tab-btn`, `tab-btn-active`

These utilities map to CSS variables and automatically adapt to dark/light.

### How to build a theme-safe component
1) Container background/text
   - Wrap the component root with `bg-panel text-app border-default` (add `border` if needed).
   - For header areas, use `bg-header`.

2) Interactive rows
   - Add `row-hover` to items that should highlight on hover.
   - Use `selected-row` for the active item state.

3) Buttons
   - Secondary actions: `btn btn-secondary`.
   - Primary actions: `btn btn-primary`.
   - Small icon/text buttons: reuse `btn` and adjust size with Tailwind (`text-xs`, `px-2 py-1`) if needed, but keep the color via `btn-secondary`.

4) Tabs (top/bottom bars)
   - Use `tab-btn` for all tabs and `tab-btn-active` for the selected tab.
   - Put tabs inside a header bar: `bg-header border-b border-default`.

5) Inputs and selects
   - Always use `input-theme` plus size classes, e.g. `input-theme h-8 px-2`.

6) Tables
   - Apply `table-zebra` to the table and `border-default` to wrappers/rows as needed.

7) Avoid raw color hex codes
   - Don’t hard-code colors. If something is missing, add a semantic utility or extend a CSS var in `index.css`.

### Minimal example

```tsx
export function ExamplePanel() {
  return (
    <div className="rounded border border-default bg-panel text-app">
      <div className="px-2 py-1 bg-header border-b border-default flex items-center gap-2">
        <button className="tab-btn tab-btn-active">Tab A</button>
        <button className="tab-btn">Tab B</button>
        <div className="ml-auto flex items-center gap-2">
          <input className="input-theme h-8 px-2" placeholder="Search" />
          <button className="btn btn-primary">Action</button>
        </div>
      </div>
      <div className="p-3">
        <div className="row-hover rounded px-2 py-1">Hover me</div>
      </div>
    </div>
  )
}
```

### Component checklist (PRs should verify):
- [ ] Uses `bg-*`, `text-*`, `border-default` semantic utilities (no hard-coded colors).
- [ ] Hover and selected states use `row-hover`/`selected-row` (or `tab-btn` for tabs).
- [ ] Buttons use `btn-*` classes; inputs use `input-theme`.
- [ ] Headers/footers use `bg-header` with appropriate borders.
- [ ] Works visually in both themes (quick manual toggle by toggling `.dark` on `<html>`).

