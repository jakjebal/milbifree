# Milbi

Milbi is a local desktop vault for private images and videos. It uses Electron,
React, and a Node crypto backend so the same codebase can be packaged for
Windows and macOS.

## Current Scope

- Password-gated encrypted vault creation and unlock
- User-selectable vault folder
- AES-256-GCM encrypted media blobs under the selected vault folder
- Encrypted library metadata
- Image and video import through the native file picker
- Drag-and-drop image and video import
- Folder filtering, multi-tag filtering, sidebar search, thumbnail grid, and list view
- Adjustable thumbnail size
- Multi-select, select all visible items, and bulk tag assignment
- Per-item name, folder, and tag editing
- Cumulative per-item likes
- Fullscreen viewing with minimal chrome
- Keyboard controls in viewing mode:
  - `ArrowRight` or `D`: next item
  - `ArrowLeft` or `A`: previous item
  - `Space` or `K`: play/pause video
  - `Esc`: close viewer
- Random viewing mode with an optional no-repeat toggle and remaining count
- Image viewing controls:
  - `Fit screen`, `fit width`, and `fit height` modes
  - `Ctrl` + mouse wheel: zoom image from 100% to 600%
  - Mouse wheel / trackpad scroll: pan around a zoomed image

## Security Model

Imported files are copied into the selected Milbi vault folder as encrypted
`.milbi` blobs. Original file names, folders, and tags are stored only inside the
encrypted metadata file. The app does not store original source paths.

The default vault location is Electron's app data directory:

- macOS: `~/Library/Application Support/Milbi/vault`
- Windows: `%APPDATA%\Milbi\vault`

The lock screen shows the active vault folder and lets you choose another folder.
Selecting a folder that already contains a Milbi vault opens that vault after the
correct password is entered. Selecting an empty folder creates the vault there.

Milbi also adds best-effort OS indexing hints: `.metadata_never_index` on macOS
and hidden/not-content-indexed attributes on Windows when available.

The renderer cannot read local files directly. It requests library operations
through Electron IPC, and media bytes are served only after the vault is unlocked
through the private `milbi://media/...` protocol with no-store cache headers.

Milbi avoids app media caching and OS indexing hints, but it does not clear the
operating system's global recent documents list.

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
- Optional decoy timeout and auto-lock on inactivity
- Export selected encrypted items back to normal files after password unlock
