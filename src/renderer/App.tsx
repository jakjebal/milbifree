import {
  ChevronLeft,
  ChevronRight,
  Eye,
  FileInput,
  Folder,
  FolderPlus,
  HardDrive,
  Heart,
  Image as ImageIcon,
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
  Trash2,
  Video,
  X
} from "lucide-react";
import { CSSProperties, DragEvent, FormEvent, MouseEvent, WheelEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ImportResult, LibraryState, MediaRecord, VaultStatus } from "../shared/types";

const ALL_SCOPE = "all";
const ROOT_FOLDER_ID = "root";

type Scope = typeof ALL_SCOPE | string;

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

function App() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [library, setLibrary] = useState<LibraryState | null>(null);
  const [scope, setScope] = useState<Scope>(ALL_SCOPE);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.milbi.getStatus().then(setStatus).catch((err: Error) => setError(err.message));
  }, []);

  const tags = useMemo(() => uniqueTags(library?.items ?? []), [library]);
  const selectedItem = useMemo(
    () => library?.items.find((item) => item.id === selectedId) ?? null,
    [library, selectedId]
  );

  const filteredItems = useMemo(() => {
    const lowerQuery = query.trim().toLowerCase();
    return (library?.items ?? []).filter((item) => {
      const inFolder = scope === ALL_SCOPE || item.folderId === scope;
      const inTag = !tagFilter || item.tags.includes(tagFilter);
      const inSearch =
        !lowerQuery ||
        item.displayName.toLowerCase().includes(lowerQuery) ||
        item.originalName.toLowerCase().includes(lowerQuery) ||
        item.tags.some((tag) => tag.toLowerCase().includes(lowerQuery));
      return inFolder && inTag && inSearch;
    });
  }, [library, query, scope, tagFilter]);

  const activeFolderName = useMemo(() => {
    if (!library || scope === ALL_SCOPE) return "전체";
    return library.folders.find((folder) => folder.id === scope)?.name ?? "폴더";
  }, [library, scope]);

  async function run<T>(task: () => Promise<T>, onSuccess?: (value: T) => void): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const value = await task();
      onSuccess?.(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
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
    return scope === ALL_SCOPE ? ROOT_FOLDER_ID : scope;
  }

  function handleImportResult(result: ImportResult): void {
    if (result.imported.length > 0) {
      void window.milbi.getLibrary().then(setLibrary);
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
      setSelectedId(null);
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
              setSelectedId(null);
            }}
          >
            <Folder size={16} />
            전체
          </button>
          {library.folders
            .filter((folder) => folder.id !== ROOT_FOLDER_ID)
            .map((folder) => (
              <div className={`folder-row ${scope === folder.id ? "active" : ""}`} key={folder.id}>
                <button
                  className="side-item"
                  onClick={() => {
                    setScope(folder.id);
                    setSelectedId(null);
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
            {tagFilter && (
              <button className="text-button" onClick={() => setTagFilter(null)}>
                해제
              </button>
            )}
          </div>
          {tags.length === 0 ? (
            <div className="muted-line">태그 없음</div>
          ) : (
            tags.map((tag) => (
              <button
                className={`side-item ${tagFilter === tag ? "active" : ""}`}
                key={tag}
                onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
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
              {tagFilter ? ` · #${tagFilter}` : ""}
            </div>
          </div>
          {error && (
            <button className="error-pill" onClick={() => setError(null)}>
              {error}
            </button>
          )}
        </header>

        <section className="content-row">
          <div className="grid-wrap">
            {filteredItems.length === 0 ? (
              <EmptyState onImport={handleImport} disabled={busy} />
            ) : (
              <div className="media-grid">
                {filteredItems.map((item) => (
                  <MediaTile
                    item={item}
                    key={item.id}
                    selected={item.id === selectedId}
                    onSelect={() => setSelectedId(item.id)}
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
              onClose={() => setSelectedId(null)}
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
          onSelect={(itemId) => setSelectedId(itemId)}
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
  run: <T>(task: () => Promise<T>, onSuccess?: (value: T) => void) => Promise<void>;
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
  onSelect: () => void;
  onOpen: () => void;
}

function MediaTile({ item, selected, onSelect, onOpen }: MediaTileProps) {
  function click(event: MouseEvent): void {
    if (event.detail === 2) {
      onOpen();
      return;
    }
    onSelect();
  }

  return (
    <article className={`media-tile ${selected ? "selected" : ""}`} onClick={click}>
      <button className="thumb" title="열기" onClick={onOpen}>
        {item.kind === "video" ? (
          <>
            <video src={mediaSrc(item.id)} preload="metadata" muted />
            <span className="kind-badge">
              <Video size={13} />
            </span>
          </>
        ) : (
          <img src={mediaSrc(item.id)} alt="" loading="lazy" />
        )}
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

interface InspectorProps {
  item: MediaRecord;
  library: LibraryState;
  busy: boolean;
  onClose: () => void;
  onOpen: () => void;
  onLibrary: (library: LibraryState) => void;
  run: <T>(task: () => Promise<T>, onSuccess?: (value: T) => void) => Promise<void>;
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

type ImageFitMode = "fit-screen" | "fit-width" | "fit-height";

function Viewer({ items, startId, onClose, onSelect, onLibrary }: ViewerProps) {
  const [currentId, setCurrentId] = useState(startId);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [imageZoom, setImageZoom] = useState(1);
  const [imageFitMode, setImageFitMode] = useState<ImageFitMode>("fit-screen");
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

  const fittedImageSize = useMemo(() => {
    if (!naturalSize.width || !naturalSize.height || !stageSize.width || !stageSize.height) {
      return {
        canvasWidth: "100%",
        canvasHeight: "100%",
        imageWidth: "100%",
        imageHeight: "100%"
      };
    }

    const widthScale = stageSize.width / naturalSize.width;
    const heightScale = stageSize.height / naturalSize.height;
    const baseScale =
      imageFitMode === "fit-width" ? widthScale : imageFitMode === "fit-height" ? heightScale : Math.min(widthScale, heightScale);
    const imageWidth = Math.max(1, Math.round(naturalSize.width * baseScale * imageZoom));
    const imageHeight = Math.max(1, Math.round(naturalSize.height * baseScale * imageZoom));

    return {
      canvasWidth: `${Math.max(stageSize.width, imageWidth)}px`,
      canvasHeight: `${Math.max(stageSize.height, imageHeight)}px`,
      imageWidth: `${imageWidth}px`,
      imageHeight: `${imageHeight}px`
    };
  }, [imageFitMode, imageZoom, naturalSize, stageSize]);

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
  }, [current?.kind]);

  useEffect(() => {
    setImageZoom(1);
    setNaturalSize({ width: 0, height: 0 });
    stageRef.current?.scrollTo({ left: 0, top: 0 });
  }, [current?.id]);

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
        className={`viewer-stage ${current.kind === "image" ? "image-stage" : ""}`}
        onClick={current.kind === "video" ? toggleVideo : undefined}
        onWheel={handleViewerWheel}
      >
        {current.kind === "video" ? (
          <video
            key={current.id}
            ref={videoRef}
            src={mediaSrc(current.id)}
            autoPlay
            playsInline
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        ) : (
          <div
            className="viewer-image-canvas"
            style={{ width: fittedImageSize.canvasWidth, height: fittedImageSize.canvasHeight } as CSSProperties}
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
              style={{ width: fittedImageSize.imageWidth, height: fittedImageSize.imageHeight } as CSSProperties}
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
          {current.kind === "image" && (
            <div className="viewer-segment" aria-label="이미지 맞춤">
              <button
                className={imageFitMode === "fit-screen" ? "active" : ""}
                title="전체 이미지 맞춤"
                onClick={() => {
                  setImageFitMode("fit-screen");
                  revealChrome();
                }}
              >
                <Maximize2 size={15} />
                전체
              </button>
              <button
                className={imageFitMode === "fit-width" ? "active" : ""}
                title="가로 맞춤"
                onClick={() => {
                  setImageFitMode("fit-width");
                  revealChrome();
                }}
              >
                <MoveHorizontal size={15} />
                가로
              </button>
              <button
                className={imageFitMode === "fit-height" ? "active" : ""}
                title="세로 맞춤"
                onClick={() => {
                  setImageFitMode("fit-height");
                  revealChrome();
                }}
              >
                <MoveVertical size={15} />
                세로
              </button>
            </div>
          )}
          <button className="viewer-chip" title="좋아요" onClick={likeCurrent}>
            <Heart size={15} />
            {currentLikes}
          </button>
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
