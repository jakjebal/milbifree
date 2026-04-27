# Milbi

Milbi is a local desktop vault for private images and videos. It uses Electron,
React, and a Node crypto backend so the same codebase can be packaged for
Windows and macOS.

## Current Scope

- Password-gated encrypted vault creation and unlock
- AES-256-GCM encrypted media blobs under the app data directory
- Encrypted library metadata
- Image and video import through the native file picker
- Folder filtering, tag filtering, sidebar search, thumbnail grid
- Per-item name, folder, and tag editing
- Fullscreen viewing with minimal chrome
- Keyboard controls in viewing mode:
  - `ArrowRight` or `D`: next item
  - `ArrowLeft` or `A`: previous item
  - `Space` or `K`: play/pause video
  - `Esc`: close viewer

## Security Model

Imported files are copied into the Milbi app data directory as encrypted
`.milbi` blobs. Original file names, folders, and tags are stored only inside the
encrypted metadata file. The app does not store original source paths.

Milbi also adds best-effort OS indexing hints: `.metadata_never_index` on macOS
and hidden/not-content-indexed attributes on Windows when available.

The renderer cannot read local files directly. It requests library operations
through Electron IPC, and media bytes are served only after the vault is unlocked
through the private `milbi://media/...` protocol with no-store cache headers.

Practical limits:

- The app cannot erase traces created before import, such as files already
  indexed by the OS, cloud sync history, backups, or media opened in other apps.
- Native file picker behavior is controlled by the operating system and may have
  its own recent-location behavior.
- Very large videos currently decrypt into memory for playback. Streaming
  decryption is a good next step before heavy video libraries.

## Development

```bash
npm install
npm run dev
```

`npm run dev` starts Vite on `http://127.0.0.1:5173` and opens the Electron app.

## Verification

```bash
npm run lint
npm run build
```

## Packaging

```bash
npm run package
```

The package output is written to `release/`. Windows packaging should be run on a
Windows machine or CI runner; macOS packaging should be run on macOS.

## Next Development Priorities

- Streaming decryption for large video files
- Encrypted thumbnail cache instead of full media preview loading
- Drag-and-drop import
- Folder rename/delete controls in the sidebar
- Optional decoy timeout and auto-lock on inactivity
- Export selected encrypted items back to normal files after password unlock
