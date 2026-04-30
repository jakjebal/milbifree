import {
  ChevronLeft,
  ChevronRight,
  Eye,
  FileInput,
  Folder,
  FolderPlus,
  Grid2X2,
  HardDrive,
  Heart,
  Image as ImageIcon,
  List,
  Lock,
  Maximize2,
  MoveHorizontal,
  MoveVertical,
  Pause,
  Pencil,
  Play,
  Search,
  Shuffle,
  Tag,
  Timer,
  Trash2,
  Video,
  X
} from "lucide-react";
import { CSSProperties, DragEvent, FormEvent, MouseEvent, WheelEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ImportResult, LibraryState, MediaOrientation, MediaRecord, OrientationUpdate, VaultStatus } from "../shared/types";

const ALL_SCOPE = "all";
const UNTAGGED_SCOPE = "untagged";
const LIKED_SCOPE = "liked";
const ROOT_FOLDER_ID = "root";
const ORIENTATION_TAG_LABELS = new Set(["가로", "세로", "정방형"]);

type Scope = typeof ALL_SCOPE | string;
type ViewMode = "grid" | "list";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

function formatDate(time: number): string {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(time);
}

function mediaSrc(itemId: string): string {
  return window.milbi.mediaSrc(itemId);
}

function uniqueTags(items: MediaRecord[]): string[] {
  return [...new Set(items.flatMap((item) => item.tags))].sort((a, b) => a.localeCompare(b));
}

function userTags(item: MediaRecord): string[] {
  return item.tags.filter((tag) => !ORIENTATION_TAG_LABELS.has(tag));
}

function isSelectionGesture(event: MouseEvent, showSelection = false): boolean {
  return showSelection || event.shiftKey || event.metaKey || event.ctrlKey;
}

function App() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [library, setLibrary] = useState<LibraryState | null>(null);
  const [scope, setScope] = useState<Scope>(ALL_SCOPE);
  const [tagFilters, setTagFilters] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [selectionMode, setSelectionMode] = useState(false);
  const [thumbSize, setThumbSize] = useState(168);
  const [minLikes, setMinLikes] = useState(0);
  const [bulkTags, setBulkTags] = useState("");
  const [autoOrientationTagging, setAutoOrientationTagging] = useState(true);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.milbi.getStatus().then(setStatus).catch((err: Error) => setError(err.message));
  }, []);

  const tags = useMemo(() => uniqueTags(library?.items ?? []), [library]);
  const activeTagFilters = useMemo(() => [...tagFilters].sort((a, b) => a.localeCompare(b)), [tagFilters]);
  const selectedItem = useMemo(
    () => (selectedIds.size === 1 ? (library?.items.find((item) => selectedIds.has(item.id)) ?? null) : null),
    [library, selectedIds]
  );
  const selectedItems = useMemo(
    () => (library?.items ?? []).filter((item) => selectedIds.has(item.id)),
    [library, selectedIds]
  );

  const filteredItems = useMemo(() => {
    const lowerQuery = query.trim().toLowerCase();
    return (library?.items ?? []).filter((item) => {
      const inScope =
        scope === ALL_SCOPE ||
        (scope === UNTAGGED_SCOPE && userTags(item).length === 0) ||
        (scope === LIKED_SCOPE && item.likes > 0) ||
        item.folderId === scope;
      const inTags = activeTagFilters.every((tag) => item.tags.includes(tag));
      const inLikes = minLikes <= 0 || item.likes >= minLikes;
      const inSearch =
        !lowerQuery ||
        item.displayName.toLowerCase().includes(lowerQuery) ||
        item.originalName.toLowerCase().includes(lowerQuery) ||
        item.tags.some((tag) => tag.toLowerCase().includes(lowerQuery));
      return inScope && inTags && inLikes && inSearch;
    });
  }, [activeTagFilters, library, minLikes, query, scope]);

  const activeFolderName = useMemo(() => {
    if (!library || scope === ALL_SCOPE) return "전체";
    if (scope === UNTAGGED_SCOPE) return "태그 없음";
    if (scope === LIKED_SCOPE) return "좋아요";
    return library.folders.find((folder) => folder.id === scope)?.name ?? "폴더";
  }, [library, scope]);

  useEffect(() => {
    const visibleIds = new Set(filteredItems.map((item) => item.id));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((itemId) => visibleIds.has(itemId)));
      if (next.size === current.size && [...next].every((itemId) => current.has(itemId))) {
        return current;
      }
      return next;
    });
  }, [filteredItems]);

  async function run<T>(task: () => Promise<T>, onSuccess?: (value: T) => void | Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const value = await task();
      await onSuccess?.(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function clearSelection(): void {
    setSelectedIds(new Set());
    setLastSelectedId(null);
  }

  function closeSelectionMode(): void {
    setSelectionMode(false);
    clearSelection();
  }

  function parseTagInput(value: string): string[] {
    return value
      .split(",")
      .map((tag) => tag.trim().replace(/^#/, ""))
      .filter(Boolean);
  }

  function selectItem(itemId: string, event?: MouseEvent, forceToggle = false): void {
    const enteringSelection = forceToggle || Boolean(event?.shiftKey || event?.metaKey || event?.ctrlKey);
    const additive = selectionMode || forceToggle || event?.metaKey || event?.ctrlKey;
    const range = event?.shiftKey && lastSelectedId;
    if (enteringSelection) {
      setSelectionMode(true);
    }

    if (range) {
      const start = filteredItems.findIndex((item) => item.id === lastSelectedId);
      const end = filteredItems.findIndex((item) => item.id === itemId);
      if (start >= 0 && end >= 0) {
        const [from, to] = start < end ? [start, end] : [end, start];
        const rangeIds = filteredItems.slice(from, to + 1).map((item) => item.id);
        setSelectedIds((current) => new Set([...current, ...rangeIds]));
        setLastSelectedId(itemId);
        return;
      }
    }

    if (additive) {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(itemId)) {
          next.delete(itemId);
        } else {
          next.add(itemId);
        }
        return next;
      });
    } else {
      setSelectedIds(new Set([itemId]));
    }
    setLastSelectedId(itemId);
  }

  function toggleTagFilter(tag: string): void {
    setTagFilters((current) => {
      const next = new Set(current);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
    clearSelection();
  }

  function selectAllVisible(): void {
    setSelectionMode(true);
    setSelectedIds(new Set(filteredItems.map((item) => item.id)));
    setLastSelectedId(filteredItems.at(-1)?.id ?? null);
  }

  function applyBulkTags(): void {
    const tagsToApply = parseTagInput(bulkTags);
    if (selectedItems.length === 0 || tagsToApply.length === 0) return;

    void run(
      () => window.milbi.addTagsToMedia(selectedItems.map((item) => item.id), tagsToApply),
      (nextLibrary) => {
        setLibrary(nextLibrary);
        setBulkTags("");
      }
    );
  }

  function orientationForSize(width: number, height: number): MediaOrientation {
    const ratioGap = Math.abs(width - height) / Math.max(width, height);
    if (ratioGap < 0.05) return "square";
    return width > height ? "landscape" : "portrait";
  }

  function readMediaOrientation(item: MediaRecord): Promise<OrientationUpdate | null> {
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => resolve(null), 8000);
      const finish = (width: number, height: number) => {
        window.clearTimeout(timeout);
        resolve(width > 0 && height > 0 ? { id: item.id, orientation: orientationForSize(width, height) } : null);
      };

      if (item.kind === "image") {
        const image = new Image();
        image.onload = () => finish(image.naturalWidth, image.naturalHeight);
        image.onerror = () => {
          window.clearTimeout(timeout);
          resolve(null);
        };
        image.src = mediaSrc(item.id);
        return;
      }

      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.onloadedmetadata = () => finish(video.videoWidth, video.videoHeight);
      video.onerror = () => {
        window.clearTimeout(timeout);
        resolve(null);
      };
      video.src = mediaSrc(item.id);
    });
  }

  async function detectOrientations(items: MediaRecord[]): Promise<OrientationUpdate[]> {
    const updates: OrientationUpdate[] = [];
    for (const item of items) {
      const update = await readMediaOrientation(item);
      if (update) {
        updates.push(update);
      }
    }
    return updates;
  }

  async function tagOrientations(items: MediaRecord[]): Promise<LibraryState> {
    const updates = await detectOrientations(items);
    if (updates.length === 0) {
      return window.milbi.getLibrary();
    }
    return window.milbi.tagMediaOrientations(updates);
  }

  function refreshOrientationTags(items: MediaRecord[]): void {
    if (items.length === 0) return;
    void run(() => tagOrientations(items), setLibrary);
  }

  async function handleUnlock(nextLibrary: LibraryState): Promise<void> {
    setLibrary(nextLibrary);
    setStatus(await window.milbi.getStatus());
  }

  function handleCreateFolder(): void {
    const name = window.prompt("새 폴더 이름");
    if (!name) return;
    void run(() => window.milbi.createFolder(name), setLibrary);
  }

  function handleRenameFolder(folderId: string, currentName: string): void {
    const name = window.prompt("폴더 이름", currentName);
    if (!name || name === currentName) return;
    void run(() => window.milbi.updateFolder(folderId, { name }), setLibrary);
  }

  function handleDeleteFolder(folderId: string): void {
    if (!window.confirm("비어 있는 폴더만 삭제할 수 있습니다. 삭제할까요?")) return;
    void run(() => window.milbi.deleteFolder(folderId), (nextLibrary) => {
      setLibrary(nextLibrary);
      if (scope === folderId) {
        setScope(ALL_SCOPE);
      }
    });
  }

  function targetFolderId(): string {
    if (scope === ALL_SCOPE || scope === UNTAGGED_SCOPE || scope === LIKED_SCOPE) return ROOT_FOLDER_ID;
    return scope;
  }

  async function handleImportResult(result: ImportResult): Promise<void> {
    if (result.imported.length > 0) {
      if (autoOrientationTagging) {
        setLibrary(await tagOrientations(result.imported));
      } else {
        setLibrary(await window.milbi.getLibrary());
      }
    }
    if (result.skipped.length > 0) {
      setError(`가져오지 못한 파일: ${result.skipped.join(", ")}`);
    }
  }

  function handleImport(): void {
    void run(() => window.milbi.importMedia(targetFolderId()), handleImportResult);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>): void {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDraggingFiles(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>): void {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
      setDraggingFiles(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDraggingFiles(false);
    const filePaths = Array.from(event.dataTransfer.files)
      .map((file) => window.milbi.filePathFor(file))
      .filter(Boolean);

    if (filePaths.length === 0) {
      setError("드롭한 파일 경로를 읽을 수 없습니다.");
      return;
    }

    void run(() => window.milbi.importDroppedMedia(filePaths, targetFolderId()), handleImportResult);
  }

  function handleLock(): void {
    void run(async () => {
      const nextStatus = await window.milbi.lockVault();
      setStatus(nextStatus);
      setLibrary(null);
      clearSelection();
      setViewerId(null);
      return nextStatus;
    });
  }

  if (!status) {
    return <div className="boot-screen">Milbi</div>;
  }

  if (!library || !status.unlocked) {
    return <LockScreen status={status} busy={busy} error={error} run={run} onReady={handleUnlock} onStatus={setStatus} />;
  }

  return (
    <div
      className={`app-shell ${draggingFiles ? "dragging" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <aside className="sidebar">
        <div className="brand-row">
          <div>
            <div className="brand">Milbi</div>
            <div className="brand-sub">private vault</div>
          </div>
          <button className="icon-button" title="잠금" onClick={handleLock} disabled={busy}>
            <Lock size={17} />
          </button>
        </div>

        <label className="search-box">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="검색" />
        </label>

        <button className="primary-button" onClick={handleImport} disabled={busy}>
          <FileInput size={17} />
          가져오기
        </button>

        <div className="side-section">
          <div className="side-heading">
            <span>폴더</span>
            <button className="icon-button small" title="폴더 추가" onClick={handleCreateFolder} disabled={busy}>
              <FolderPlus size={15} />
            </button>
          </div>
          <button
            className={`side-item ${scope === ALL_SCOPE ? "active" : ""}`}
            onClick={() => {
              setScope(ALL_SCOPE);
              clearSelection();
            }}
          >
            <Folder size={16} />
            전체
          </button>
          <button
            className={`side-item ${scope === UNTAGGED_SCOPE ? "active" : ""}`}
            onClick={() => {
              setScope(UNTAGGED_SCOPE);
              clearSelection();
            }}
          >
            <Tag size={16} />
            태그 없음
          </button>
          <button
            className={`side-item ${scope === LIKED_SCOPE ? "active" : ""}`}
            onClick={() => {
              setScope(LIKED_SCOPE);
              clearSelection();
            }}
          >
            <Heart size={16} />
            좋아요
          </button>
          {library.folders
            .filter((folder) => folder.id !== ROOT_FOLDER_ID)
            .map((folder) => (
              <div className={`folder-row ${scope === folder.id ? "active" : ""}`} key={folder.id}>
                <button
                  className="side-item"
                  onClick={() => {
                    setScope(folder.id);
                    clearSelection();
                  }}
                >
                  <Folder size={16} />
                  {folder.name}
                </button>
                <button className="icon-button tiny" title="이름 변경" onClick={() => handleRenameFolder(folder.id, folder.name)}>
                  <Pencil size={14} />
                </button>
                <button className="icon-button tiny danger" title="삭제" onClick={() => handleDeleteFolder(folder.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
        </div>

        <div className="side-section grow">
          <div className="side-heading">
            <span>태그</span>
            {activeTagFilters.length > 0 && (
              <button
                className="text-button"
                onClick={() => {
                  setTagFilters(new Set());
                  clearSelection();
                }}
              >
                해제
              </button>
            )}
          </div>
          {tags.length === 0 ? (
            <div className="muted-line">태그 없음</div>
          ) : (
            tags.map((tag) => (
              <button
                className={`side-item ${tagFilters.has(tag) ? "active" : ""}`}
                key={tag}
                onClick={() => toggleTagFilter(tag)}
              >
                <Tag size={15} />
                {tag}
              </button>
            ))
          )}
        </div>
        <div className="vault-path" title={status.vaultPath}>
          <HardDrive size={14} />
          <span>{status.vaultPath}</span>
        </div>
      </aside>

      <main className="library">
        <header className="library-header">
          <div>
            <h1>{activeFolderName}</h1>
            <div className="header-meta">
              {filteredItems.length}개 항목
              {activeTagFilters.length > 0 ? ` · ${activeTagFilters.map((tag) => `#${tag}`).join(" + ")}` : ""}
              {minLikes > 0 ? ` · 좋아요 ${minLikes}+` : ""}
            </div>
          </div>
          <div className="library-controls">
            <button
              className={`secondary-button compact ${selectionMode ? "active" : ""}`}
              onClick={() => {
                if (selectionMode) {
                  closeSelectionMode();
                } else {
                  setSelectionMode(true);
                }
              }}
            >
              선택
            </button>
            <div className="view-toggle" aria-label="보기 모드">
              <button className={viewMode === "grid" ? "active" : ""} title="그리드 보기" onClick={() => setViewMode("grid")}>
                <Grid2X2 size={16} />
              </button>
              <button className={viewMode === "list" ? "active" : ""} title="리스트 보기" onClick={() => setViewMode("list")}>
                <List size={16} />
              </button>
            </div>
            {viewMode === "grid" && (
              <label className="thumb-size">
                <ImageIcon size={16} />
                <input
                  type="range"
                  min="124"
                  max="260"
                  step="12"
                  value={thumbSize}
                  onChange={(event) => setThumbSize(Number(event.target.value))}
                />
              </label>
            )}
            <label className="likes-filter" title="최소 좋아요 수">
              <Heart size={15} />
              <input
                type="number"
                min="0"
                value={minLikes}
                onChange={(event) => setMinLikes(Math.max(0, Number(event.target.value) || 0))}
              />
            </label>
            <label className="auto-tag-toggle">
              <input
                type="checkbox"
                checked={autoOrientationTagging}
                onChange={(event) => setAutoOrientationTagging(event.target.checked)}
              />
              방향 자동태그
            </label>
            <button
              className="secondary-button compact"
              onClick={() => refreshOrientationTags(library.items)}
              disabled={busy || library.items.length === 0}
            >
              방향 태그 갱신
            </button>
          </div>
          {error && (
            <button className="error-pill" onClick={() => setError(null)}>
              {error}
            </button>
          )}
        </header>

        <div className="selection-bar">
          <div className="selection-count">{selectedItems.length > 0 ? `${selectedItems.length}개 선택됨` : "선택 없음"}</div>
          <button className="secondary-button compact" onClick={selectAllVisible} disabled={filteredItems.length === 0}>
            전체 선택
          </button>
          <button className="secondary-button compact" onClick={closeSelectionMode} disabled={!selectionMode && selectedItems.length === 0}>
            선택 해제
          </button>
          <label className="bulk-tag-field">
            <Tag size={15} />
            <input
              value={bulkTags}
              onChange={(event) => setBulkTags(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyBulkTags();
                }
              }}
              placeholder="선택 항목에 태그 추가"
            />
          </label>
          <button className="primary-button compact" onClick={applyBulkTags} disabled={selectedItems.length === 0 || !bulkTags.trim() || busy}>
            태그 부여
          </button>
        </div>

        <section className="content-row">
          <div className="grid-wrap" style={{ "--thumb-min": `${thumbSize}px` } as CSSProperties}>
            {filteredItems.length === 0 ? (
              <EmptyState onImport={handleImport} disabled={busy} />
            ) : viewMode === "list" ? (
              <div className="media-list">
                {filteredItems.map((item) => (
                  <MediaListRow
                    item={item}
                    key={item.id}
                    selected={selectedIds.has(item.id)}
                    showSelection={selectionMode}
                    onSelect={(event) => selectItem(item.id, event)}
                    onToggle={(event) => selectItem(item.id, event, true)}
                    onOpen={() => setViewerId(item.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="media-grid">
                {filteredItems.map((item) => (
                  <MediaTile
                    item={item}
                    key={item.id}
                    selected={selectedIds.has(item.id)}
                    showSelection={selectionMode}
                    onSelect={(event) => selectItem(item.id, event)}
                    onToggle={(event) => selectItem(item.id, event, true)}
                    onOpen={() => setViewerId(item.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {selectedItem && (
            <Inspector
              item={selectedItem}
              library={library}
              busy={busy}
              onClose={clearSelection}
              onOpen={() => setViewerId(selectedItem.id)}
              onLibrary={setLibrary}
              run={run}
            />
          )}
        </section>
      </main>

      {viewerId && (
        <Viewer
          items={filteredItems}
          startId={viewerId}
          onClose={() => setViewerId(null)}
          onSelect={(itemId) => {
            setSelectedIds(new Set([itemId]));
            setLastSelectedId(itemId);
          }}
          onLibrary={setLibrary}
        />
      )}

      {draggingFiles && (
        <div className="drop-overlay">
          <div>
            <FileInput size={34} />
            <span>파일을 놓아 보관함에 저장</span>
          </div>
        </div>
      )}
    </div>
  );
}

interface LockScreenProps {
  status: VaultStatus;
  busy: boolean;
  error: string | null;
  run: <T>(task: () => Promise<T>, onSuccess?: (value: T) => void | Promise<void>) => Promise<void>;
  onReady: (library: LibraryState) => Promise<void>;
  onStatus: (status: VaultStatus) => void;
}

function LockScreen({ status, busy, error, run, onReady, onStatus }: LockScreenProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!status.exists && password !== confirm) {
      return;
    }
    void run(
      () => (status.exists ? window.milbi.unlockVault(password) : window.milbi.createVault(password)),
      (library) => void onReady(library)
    );
  }

  function chooseLocation(): void {
    void run(() => window.milbi.chooseVaultLocation(), onStatus);
  }

  return (
    <main className="lock-screen">
      <form className="lock-panel" onSubmit={submit}>
        <div className="lock-mark">
          <Lock size={24} />
        </div>
        <h1>{status.exists ? "보관함 열기" : "보관함 만들기"}</h1>
        <p>{status.exists ? "암호를 입력하세요." : "암호를 잃으면 보관함을 복구할 수 없습니다."}</p>
        <div className="location-box">
          <HardDrive size={16} />
          <span title={status.vaultPath}>{status.vaultPath}</span>
          <button type="button" className="secondary-button compact" onClick={chooseLocation} disabled={busy}>
            위치 선택
          </button>
        </div>
        <input
          autoFocus
          minLength={8}
          type="password"
          placeholder="암호"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {!status.exists && (
          <input
            minLength={8}
            type="password"
            placeholder="암호 확인"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        )}
        {!status.exists && password && confirm && password !== confirm && (
          <div className="form-error">암호가 일치하지 않습니다.</div>
        )}
        {error && <div className="form-error">{error}</div>}
        <button className="primary-button full" disabled={busy || password.length < 8 || (!status.exists && password !== confirm)}>
          {status.exists ? "열기" : "만들기"}
        </button>
      </form>
    </main>
  );
}

function EmptyState({ onImport, disabled }: { onImport: () => void; disabled: boolean }) {
  return (
    <div className="empty-state">
      <ImageIcon size={36} />
      <div>표시할 항목이 없습니다.</div>
      <button className="primary-button" onClick={onImport} disabled={disabled}>
        <FileInput size={17} />
        가져오기
      </button>
    </div>
  );
}

interface MediaTileProps {
  item: MediaRecord;
  selected: boolean;
  showSelection: boolean;
  onSelect: (event: MouseEvent) => void;
  onToggle: (event: MouseEvent) => void;
  onOpen: () => void;
}

function LazyMediaPreview({ item, showVideoBadge = false }: { item: MediaRecord; showVideoBadge?: boolean }) {
  const [shouldLoad, setShouldLoad] = useState(false);
  const previewRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const target = previewRef.current;
    if (!target || shouldLoad) return;
    if (!("IntersectionObserver" in window)) {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: "260px 0px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [shouldLoad]);

  return (
    <span className="thumb-media" ref={previewRef}>
      {shouldLoad ? (
        item.kind === "video" ? (
          <video src={mediaSrc(item.id)} preload="metadata" muted />
        ) : (
          <img src={mediaSrc(item.id)} alt="" loading="lazy" />
        )
      ) : (
        <span className="thumb-placeholder" aria-hidden="true">
          <ImageIcon size={18} />
        </span>
      )}
      {showVideoBadge && item.kind === "video" && (
        <span className="kind-badge">
          <Video size={13} />
        </span>
      )}
    </span>
  );
}

function MediaTile({ item, selected, showSelection, onSelect, onToggle, onOpen }: MediaTileProps) {
  function click(event: MouseEvent): void {
    if (event.detail === 2 && !isSelectionGesture(event, showSelection)) {
      onOpen();
      return;
    }
    onSelect(event);
  }

  function thumbnailClick(event: MouseEvent): void {
    event.stopPropagation();
    if (isSelectionGesture(event, showSelection)) {
      onToggle(event);
      return;
    }
    onOpen();
  }

  return (
    <article className={`media-tile ${selected ? "selected" : ""} ${showSelection ? "show-selection" : ""}`} onClick={click}>
      <button
        className={`select-dot ${selected ? "checked" : ""}`}
        title={selected ? "선택 해제" : "선택"}
        onClick={(event) => {
          event.stopPropagation();
          onToggle(event);
        }}
      >
        {selected ? "✓" : ""}
      </button>
      <button
        className="thumb"
        title="열기"
        onClick={thumbnailClick}
      >
        <LazyMediaPreview item={item} showVideoBadge />
      </button>
      <div className="tile-info">
        <div className="tile-name" title={item.displayName}>
          {item.displayName}
        </div>
        <div className="tile-meta">{formatBytes(item.size)}</div>
      </div>
      {item.tags.length > 0 && (
        <div className="tag-row">
          {item.tags.slice(0, 3).map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
      )}
    </article>
  );
}

interface MediaListRowProps {
  item: MediaRecord;
  selected: boolean;
  showSelection: boolean;
  onSelect: (event: MouseEvent) => void;
  onToggle: (event: MouseEvent) => void;
  onOpen: () => void;
}

function MediaListRow({ item, selected, showSelection, onSelect, onToggle, onOpen }: MediaListRowProps) {
  function click(event: MouseEvent): void {
    if (event.detail === 2 && !isSelectionGesture(event, showSelection)) {
      onOpen();
      return;
    }
    onSelect(event);
  }

  function thumbnailClick(event: MouseEvent): void {
    event.stopPropagation();
    if (isSelectionGesture(event, showSelection)) {
      onToggle(event);
      return;
    }
    onOpen();
  }

  return (
    <article className={`media-row ${selected ? "selected" : ""} ${showSelection ? "show-selection" : ""}`} onClick={click}>
      <button
        className={`select-dot ${selected ? "checked" : ""}`}
        title={selected ? "선택 해제" : "선택"}
        onClick={(event) => {
          event.stopPropagation();
          onToggle(event);
        }}
      >
        {selected ? "✓" : ""}
      </button>
      <button
        className="row-thumb"
        title="열기"
        onClick={thumbnailClick}
      >
        <LazyMediaPreview item={item} />
      </button>
      <div className="row-main">
        <div className="row-name" title={item.displayName}>
          {item.displayName}
        </div>
        <div className="row-sub">
          {item.kind === "video" ? "영상" : "이미지"} · {formatBytes(item.size)} · {formatDate(item.importedAt)}
        </div>
      </div>
      <div className="row-tags">
        {item.tags.length === 0 ? (
          <span className="row-muted">태그 없음</span>
        ) : (
          item.tags.slice(0, 5).map((tag) => <span key={tag}>#{tag}</span>)
        )}
      </div>
      <div className="row-likes">
        <Heart size={14} />
        {item.likes}
      </div>
    </article>
  );
}

interface InspectorProps {
  item: MediaRecord;
  library: LibraryState;
  busy: boolean;
  onClose: () => void;
  onOpen: () => void;
  onLibrary: (library: LibraryState) => void;
  run: <T>(task: () => Promise<T>, onSuccess?: (value: T) => void | Promise<void>) => Promise<void>;
}

function Inspector({ item, library, busy, onClose, onOpen, onLibrary, run }: InspectorProps) {
  const [name, setName] = useState(item.displayName);
  const [folderId, setFolderId] = useState(item.folderId);
  const [tags, setTags] = useState(item.tags.join(", "));

  useEffect(() => {
    setName(item.displayName);
    setFolderId(item.folderId);
    setTags(item.tags.join(", "));
  }, [item]);

  function save(): void {
    const nextTags = tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    void run(() => window.milbi.updateMedia(item.id, { displayName: name, folderId, tags: nextTags }), onLibrary);
  }

  function remove(): void {
    if (!window.confirm("이 항목을 보관함에서 삭제할까요?")) return;
    void run(() => window.milbi.deleteMedia(item.id), (nextLibrary) => {
      onLibrary(nextLibrary);
      onClose();
    });
  }

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <div>
          <span className="eyebrow">{item.kind === "video" ? "Video" : "Image"}</span>
          <h2>정보</h2>
        </div>
        <button className="icon-button" title="닫기" onClick={onClose}>
          <X size={17} />
        </button>
      </div>

      <div className="preview-strip">
        {item.kind === "video" ? <video src={mediaSrc(item.id)} muted preload="metadata" /> : <img src={mediaSrc(item.id)} alt="" />}
      </div>

      <label className="field">
        이름
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="field">
        폴더
        <select value={folderId} onChange={(event) => setFolderId(event.target.value)}>
          {library.folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        태그
        <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="쉼표로 구분" />
      </label>

      <dl className="meta-list">
        <div>
          <dt>원본명</dt>
          <dd>{item.originalName}</dd>
        </div>
        <div>
          <dt>크기</dt>
          <dd>{formatBytes(item.size)}</dd>
        </div>
        <div>
          <dt>가져온 날짜</dt>
          <dd>{formatDate(item.importedAt)}</dd>
        </div>
        <div>
          <dt>좋아요</dt>
          <dd>{item.likes}</dd>
        </div>
      </dl>

      <div className="inspector-actions">
        <button className="secondary-button" onClick={onOpen}>
          <Eye size={16} />
          보기
        </button>
        <button className="primary-button" onClick={save} disabled={busy}>
          저장
        </button>
        <button className="icon-button danger" title="삭제" onClick={remove} disabled={busy}>
          <Trash2 size={16} />
        </button>
      </div>
    </aside>
  );
}

interface ViewerProps {
  items: MediaRecord[];
  startId: string;
  onClose: () => void;
  onSelect: (itemId: string) => void;
  onLibrary: (library: LibraryState) => void;
}

type FitMode = "fit-screen" | "fit-width" | "fit-height";

function Viewer({ items, startId, onClose, onSelect, onLibrary }: ViewerProps) {
  const [currentId, setCurrentId] = useState(startId);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [imageZoom, setImageZoom] = useState(1);
  const [fitMode, setFitMode] = useState<FitMode>("fit-screen");
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [imageAdvanceSeconds, setImageAdvanceSeconds] = useState(5);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [randomMode, setRandomMode] = useState(false);
  const [excludeSeen, setExcludeSeen] = useState(false);
  const [seenIds, setSeenIds] = useState<Set<string>>(() => new Set([startId]));
  const [randomHistory, setRandomHistory] = useState<string[]>([startId]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hideTimer = useRef<number | null>(null);

  const foundIndex = items.findIndex((item) => item.id === currentId);
  const currentIndex = Math.max(0, foundIndex);
  const current = items[currentIndex] ?? items[0];
  const remainingRandomCount = Math.max(0, items.filter((item) => !seenIds.has(item.id)).length);
  const currentLikes = current?.likes ?? 0;

  const fittedMediaSize = useMemo(() => {
    if (!naturalSize.width || !naturalSize.height || !stageSize.width || !stageSize.height) {
      return {
        canvasWidth: "100%",
        canvasHeight: "100%",
        mediaWidth: "100%",
        mediaHeight: "100%"
      };
    }

    const widthScale = stageSize.width / naturalSize.width;
    const heightScale = stageSize.height / naturalSize.height;
    const baseScale = fitMode === "fit-width" ? widthScale : fitMode === "fit-height" ? heightScale : Math.min(widthScale, heightScale);
    const zoom = current?.kind === "image" ? imageZoom : 1;
    const mediaWidth = Math.max(1, Math.round(naturalSize.width * baseScale * zoom));
    const mediaHeight = Math.max(1, Math.round(naturalSize.height * baseScale * zoom));

    return {
      canvasWidth: `${Math.max(stageSize.width, mediaWidth)}px`,
      canvasHeight: `${Math.max(stageSize.height, mediaHeight)}px`,
      mediaWidth: `${mediaWidth}px`,
      mediaHeight: `${mediaHeight}px`
    };
  }, [current?.kind, fitMode, imageZoom, naturalSize, stageSize]);

  function selectItem(itemId: string): void {
    setCurrentId(itemId);
    setSeenIds((existing) => {
      if (existing.has(itemId)) return existing;
      const next = new Set(existing);
      next.add(itemId);
      return next;
    });
    onSelect(itemId);
    setPlaying(true);
    revealChrome();
  }

  function goSequential(delta: number): void {
    if (items.length === 0) return;
    const next = items[(currentIndex + delta + items.length) % items.length];
    selectItem(next.id);
  }

  function goRandom(delta: number): void {
    if (items.length === 0 || !current) return;

    if (delta < 0) {
      if (historyIndex > 0) {
        const previousId = randomHistory[historyIndex - 1];
        setHistoryIndex((index) => Math.max(0, index - 1));
        selectItem(previousId);
      }
      return;
    }

    if (historyIndex < randomHistory.length - 1) {
      const nextId = randomHistory[historyIndex + 1];
      setHistoryIndex((index) => Math.min(randomHistory.length - 1, index + 1));
      selectItem(nextId);
      return;
    }

    const candidates = items.filter((item) => {
      if (excludeSeen) return !seenIds.has(item.id);
      return items.length === 1 || item.id !== current.id;
    });
    if (candidates.length === 0) {
      revealChrome();
      return;
    }

    const next = candidates[Math.floor(Math.random() * candidates.length)];
    setRandomHistory((history) => [...history.slice(0, historyIndex + 1), next.id]);
    setHistoryIndex((index) => index + 1);
    selectItem(next.id);
  }

  function go(delta: number): void {
    if (randomMode) {
      goRandom(delta);
      return;
    }
    goSequential(delta);
  }

  function toggleRandomMode(): void {
    setRandomMode((enabled) => {
      const nextEnabled = !enabled;
      if (!nextEnabled) {
        setExcludeSeen(false);
      }
      setRandomHistory([current?.id ?? startId]);
      setHistoryIndex(0);
      revealChrome();
      return nextEnabled;
    });
  }

  function toggleExcludeSeen(): void {
    if (!randomMode) {
      setRandomMode(true);
      setRandomHistory([current?.id ?? startId]);
      setHistoryIndex(0);
    }
    setExcludeSeen((enabled) => !enabled);
    revealChrome();
  }

  function toggleVideo(): void {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  }

  function likeCurrent(): void {
    if (!current) return;
    void window.milbi.likeMedia(current.id).then(onLibrary).catch(() => undefined);
    revealChrome();
  }

  function deleteCurrent(): void {
    if (!current || !window.confirm("현재 항목을 보관함에서 삭제할까요?")) return;
    const deletedId = current.id;
    const remainingItems = items.filter((item) => item.id !== deletedId);
    const nextId = remainingItems.length > 0 ? remainingItems[Math.min(currentIndex, remainingItems.length - 1)].id : null;

    void window.milbi
      .deleteMedia(deletedId)
      .then((nextLibrary) => {
        onLibrary(nextLibrary);
        setSeenIds((existing) => new Set([...existing].filter((itemId) => itemId !== deletedId)));
        setRandomHistory((history) => history.filter((itemId) => itemId !== deletedId));
        if (!nextId) {
          onClose();
          return;
        }
        selectItem(nextId);
      })
      .catch(() => undefined);
    revealChrome();
  }

  function changeImageZoom(delta: number): void {
    setImageZoom((value) => Math.min(6, Math.max(1, Number((value + delta).toFixed(2)))));
  }

  function handleViewerWheel(event: WheelEvent<HTMLDivElement>): void {
    if (current.kind !== "image" || !event.ctrlKey) return;
    event.preventDefault();
    changeImageZoom(event.deltaY < 0 ? 0.15 : -0.15);
    revealChrome();
  }

  function revealChrome(): void {
    setChromeVisible(true);
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
    }
    hideTimer.current = window.setTimeout(() => setChromeVisible(false), 1600);
  }

  useEffect(() => {
    void window.milbi.setViewerFullscreen(true).catch(() => undefined);
    revealChrome();
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      void window.milbi.setViewerFullscreen(false).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const updateSize = () => {
      setStageSize({
        width: stage.clientWidth,
        height: stage.clientHeight
      });
    };
    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setImageZoom(1);
    setNaturalSize({ width: 0, height: 0 });
    stageRef.current?.scrollTo({ left: 0, top: 0 });
  }, [current?.id]);

  useEffect(() => {
    if (!autoAdvance || current?.kind !== "image") return;
    const timer = window.setTimeout(() => go(1), imageAdvanceSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [autoAdvance, current?.id, current?.kind, imageAdvanceSeconds, excludeSeen, historyIndex, items, randomHistory, randomMode, seenIds]);

  useEffect(() => {
    const validIds = new Set(items.map((item) => item.id));
    if (items.length === 0) {
      onClose();
      return;
    }
    if (!validIds.has(currentId)) {
      selectItem(items[0].id);
    }
    setSeenIds((existing) => {
      const next = new Set([...existing].filter((itemId) => validIds.has(itemId)));
      if (next.size === existing.size && [...next].every((itemId) => existing.has(itemId))) {
        return existing;
      }
      return next;
    });
    setRandomHistory((history) => {
      const nextHistory = history.filter((itemId) => validIds.has(itemId));
      const safeHistory = nextHistory.length > 0 ? nextHistory : [items[0].id];
      setHistoryIndex((index) => Math.min(index, Math.max(0, safeHistory.length - 1)));
      if (history.length === safeHistory.length && history.every((itemId, index) => itemId === safeHistory[index])) {
        return history;
      }
      return safeHistory;
    });
  }, [items, currentId]);

  useEffect(() => {
    function keydown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") {
        event.preventDefault();
        go(1);
      } else if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") {
        event.preventDefault();
        go(-1);
      } else if (event.key.toLowerCase() === "l") {
        event.preventDefault();
        likeCurrent();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteCurrent();
      } else if ((event.key === " " || event.key.toLowerCase() === "k") && current?.kind === "video") {
        event.preventDefault();
        toggleVideo();
      }
    }

    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [current, currentIndex, excludeSeen, historyIndex, items, randomHistory, randomMode, seenIds]);

  if (!current) {
    return null;
  }

  return (
    <div ref={shellRef} className={`viewer ${chromeVisible ? "chrome" : ""}`} onMouseMove={revealChrome}>
      <div
        ref={stageRef}
        className="viewer-stage media-stage"
        onClick={current.kind === "video" ? toggleVideo : undefined}
        onWheel={handleViewerWheel}
      >
        {current.kind === "video" ? (
          <div className="viewer-image-canvas" style={{ width: fittedMediaSize.canvasWidth, height: fittedMediaSize.canvasHeight } as CSSProperties}>
            <video
              key={current.id}
              ref={videoRef}
              src={mediaSrc(current.id)}
              autoPlay
              playsInline
              onLoadedMetadata={(event) => {
                setNaturalSize({
                  width: event.currentTarget.videoWidth,
                  height: event.currentTarget.videoHeight
                });
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => go(1)}
              style={{ width: fittedMediaSize.mediaWidth, height: fittedMediaSize.mediaHeight } as CSSProperties}
            />
          </div>
        ) : (
          <div
            className="viewer-image-canvas"
            style={{ width: fittedMediaSize.canvasWidth, height: fittedMediaSize.canvasHeight } as CSSProperties}
          >
            <img
              key={current.id}
              src={mediaSrc(current.id)}
              alt=""
              onLoad={(event) => {
                setNaturalSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight
                });
              }}
              style={{ width: fittedMediaSize.mediaWidth, height: fittedMediaSize.mediaHeight } as CSSProperties}
            />
          </div>
        )}
      </div>

      <div className="viewer-top">
        <div className="viewer-title">
          <span>{current.displayName}</span>
          <small>
            {currentIndex + 1} / {items.length}
          </small>
        </div>
        <div className="viewer-controls">
          <div className="viewer-segment" aria-label="미디어 맞춤">
            <button
              className={fitMode === "fit-screen" ? "active" : ""}
              title="전체 맞춤"
              onClick={() => {
                setFitMode("fit-screen");
                revealChrome();
              }}
            >
              <Maximize2 size={15} />
              전체
            </button>
            <button
              className={fitMode === "fit-width" ? "active" : ""}
              title="가로 맞춤"
              onClick={() => {
                setFitMode("fit-width");
                revealChrome();
              }}
            >
              <MoveHorizontal size={15} />
              가로
            </button>
            <button
              className={fitMode === "fit-height" ? "active" : ""}
              title="세로 맞춤"
              onClick={() => {
                setFitMode("fit-height");
                revealChrome();
              }}
            >
              <MoveVertical size={15} />
              세로
            </button>
          </div>
          <button className="viewer-chip" title="좋아요" onClick={likeCurrent}>
            <Heart size={15} />
            {currentLikes}
          </button>
          <button className="viewer-chip danger" title="삭제" onClick={deleteCurrent}>
            <Trash2 size={15} />
            삭제
          </button>
          <button className={`viewer-chip ${autoAdvance ? "active" : ""}`} title="이미지 자동 넘김" onClick={() => setAutoAdvance((enabled) => !enabled)}>
            {autoAdvance ? <Pause size={15} /> : <Play size={15} />}
            자동
          </button>
          {autoAdvance && (
            <label className="viewer-timer" title="이미지 자동 넘김 시간">
              <Timer size={15} />
              <input
                type="range"
                min="1"
                max="30"
                value={imageAdvanceSeconds}
                onChange={(event) => setImageAdvanceSeconds(Number(event.target.value))}
              />
              <input
                type="number"
                min="1"
                max="300"
                value={imageAdvanceSeconds}
                onChange={(event) => setImageAdvanceSeconds(Math.max(1, Number(event.target.value) || 1))}
              />
              <span>초</span>
            </label>
          )}
          <button className={`viewer-chip ${randomMode ? "active" : ""}`} title="랜덤 넘기기" onClick={toggleRandomMode}>
            <Shuffle size={15} />
            랜덤
          </button>
          <button
            className={`viewer-chip ${excludeSeen ? "active" : ""}`}
            title="이미 나온 항목 제외"
            onClick={toggleExcludeSeen}
          >
            <Eye size={15} />
            중복 제외
          </button>
          {randomMode && excludeSeen && <span className="viewer-remaining">남은 {remainingRandomCount}</span>}
        </div>
        <button className="viewer-button" title="닫기" onClick={onClose}>
          <X size={20} />
        </button>
      </div>

      <button className="viewer-button viewer-prev" title="이전" onClick={() => go(-1)}>
        <ChevronLeft size={30} />
      </button>
      <button className="viewer-button viewer-next" title="다음" onClick={() => go(1)}>
        <ChevronRight size={30} />
      </button>

      {current.kind === "video" && (
        <button className="viewer-button viewer-play" title={playing ? "일시정지" : "재생"} onClick={toggleVideo}>
          {playing ? <Pause size={22} /> : <Play size={22} />}
        </button>
      )}

      {current.kind === "image" && <div className="viewer-zoom">{Math.round(imageZoom * 100)}%</div>}
    </div>
  );
}

export default App;
