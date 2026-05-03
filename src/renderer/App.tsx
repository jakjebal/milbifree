import {
  ArrowDownUp,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileInput,
  Folder,
  FolderPlus,
  Grid2X2,
  GripVertical,
  HardDrive,
  Heart,
  Image as ImageIcon,
  List,
  Lock,
  Maximize2,
  Minus,
  MoveHorizontal,
  MoveVertical,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Shuffle,
  Tag,
  Timer,
  Trash2,
  Video,
  X
} from "lucide-react";
import { CSSProperties, DragEvent, FormEvent, MouseEvent, WheelEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ImportResult, LibraryState, MediaOrientation, MediaRecord, OrientationUpdate, ScenarioRecord, VaultStatus } from "../shared/types";

const ALL_SCOPE = "all";
const UNTAGGED_SCOPE = "untagged";
const LIKED_SCOPE = "liked";
const TIER_SCOPE_PREFIX = "tier:";
const ROOT_FOLDER_ID = "root";
const SYSTEM_TAG_LABELS = new Set(["가로", "세로", "정방형", "이미지", "동영상"]);
const MEDIA_DRAG_TYPE = "application/x-milbi-media-ids";
const SCENARIO_DRAG_TYPE = "application/x-milbi-scenario-index";

type Scope = typeof ALL_SCOPE | string;
type ViewMode = "grid" | "list";
type DateSortOrder = "newest" | "oldest";
type TierName = "S" | "A" | "B" | "C" | "D" | "E";
type ViewerState = { startId: string; scenarioId?: string };

const TIERS: Array<{ name: TierName; min: number; max: number | null; label: string }> = [
  { name: "S", min: 21, max: null, label: "21+" },
  { name: "A", min: 16, max: 20, label: "16-20" },
  { name: "B", min: 11, max: 15, label: "11-15" },
  { name: "C", min: 6, max: 10, label: "6-10" },
  { name: "D", min: 1, max: 5, label: "1-5" },
  { name: "E", min: 0, max: 0, label: "0" }
];

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

function tierScope(tier: TierName): string {
  return `${TIER_SCOPE_PREFIX}${tier}`;
}

function tierFromScope(scope: Scope): TierName | null {
  if (!scope.startsWith(TIER_SCOPE_PREFIX)) return null;
  const tier = scope.slice(TIER_SCOPE_PREFIX.length);
  return TIERS.some((entry) => entry.name === tier) ? (tier as TierName) : null;
}

function tierForLikes(likes: number): TierName {
  return TIERS.find((tier) => likes >= tier.min && (tier.max === null || likes <= tier.max))?.name ?? "E";
}

function tierMinimum(tierName: TierName): number {
  return TIERS.find((tier) => tier.name === tierName)?.min ?? 0;
}

function uniqueTags(items: MediaRecord[]): string[] {
  return [...new Set(items.flatMap((item) => item.tags))].sort((a, b) => a.localeCompare(b));
}

function userTags(item: MediaRecord): string[] {
  return item.tags.filter((tag) => !SYSTEM_TAG_LABELS.has(tag));
}

function isSelectionGesture(event: MouseEvent, showSelection = false): boolean {
  return showSelection || event.shiftKey || event.metaKey || event.ctrlKey;
}

function droppedMediaIds(event: DragEvent): string[] {
  const raw = event.dataTransfer.getData(MEDIA_DRAG_TYPE);
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function droppedFilePaths(event: DragEvent): string[] {
  return Array.from(event.dataTransfer.files)
    .map((file) => window.milbi.filePathFor(file))
    .filter(Boolean);
}

function hasDroppableMedia(event: DragEvent): boolean {
  const types = Array.from(event.dataTransfer.types);
  return types.includes(MEDIA_DRAG_TYPE) || types.includes("Files");
}

function scenarioItems(scenario: ScenarioRecord | null, items: MediaRecord[]): MediaRecord[] {
  if (!scenario) return [];
  const byId = new Map(items.map((item) => [item.id, item]));
  return scenario.itemIds.map((itemId) => byId.get(itemId)).filter((item): item is MediaRecord => Boolean(item));
}

function App() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [library, setLibrary] = useState<LibraryState | null>(null);
  const [scope, setScope] = useState<Scope>(ALL_SCOPE);
  const [tagFilters, setTagFilters] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [dateSortOrder, setDateSortOrder] = useState<DateSortOrder>("newest");
  const [showDates, setShowDates] = useState(false);
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
    const activeTier = tierFromScope(scope);
    return (library?.items ?? [])
      .filter((item) => {
        const inScope =
          scope === ALL_SCOPE ||
          (scope === UNTAGGED_SCOPE && userTags(item).length === 0) ||
          (scope === LIKED_SCOPE && item.likes > 0) ||
          (activeTier !== null && tierForLikes(item.likes ?? 0) === activeTier) ||
          item.folderId === scope;
        const inTags = activeTagFilters.every((tag) => item.tags.includes(tag));
        const inLikes = minLikes <= 0 || item.likes >= minLikes;
        const inSearch =
          !lowerQuery ||
          item.displayName.toLowerCase().includes(lowerQuery) ||
          item.originalName.toLowerCase().includes(lowerQuery) ||
          item.tags.some((tag) => tag.toLowerCase().includes(lowerQuery));
        return inScope && inTags && inLikes && inSearch;
      })
      .sort((a, b) => {
        const byDate = dateSortOrder === "newest" ? b.importedAt - a.importedAt : a.importedAt - b.importedAt;
        return byDate || a.displayName.localeCompare(b.displayName);
      });
  }, [activeTagFilters, dateSortOrder, library, minLikes, query, scope]);

  const activeFolderName = useMemo(() => {
    if (!library || scope === ALL_SCOPE) return "전체";
    if (scope === UNTAGGED_SCOPE) return "태그 없음";
    if (scope === LIKED_SCOPE) return "좋아요";
    const tier = tierFromScope(scope);
    if (tier) return `${tier} 티어`;
    return library.folders.find((folder) => folder.id === scope)?.name ?? "폴더";
  }, [library, scope]);

  const activeScenario = useMemo(
    () => library?.scenarios.find((scenario) => scenario.id === activeScenarioId) ?? null,
    [activeScenarioId, library]
  );
  const activeScenarioItems = useMemo(() => scenarioItems(activeScenario, library?.items ?? []), [activeScenario, library]);
  const viewerItems = useMemo(() => {
    if (!viewer?.scenarioId) return filteredItems;
    const scenario = library?.scenarios.find((entry) => entry.id === viewer.scenarioId) ?? null;
    return scenarioItems(scenario, library?.items ?? []);
  }, [filteredItems, library, viewer]);
  const hasActiveFilters = scope !== ALL_SCOPE || activeTagFilters.length > 0 || minLikes > 0 || query.trim().length > 0;

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

  useEffect(() => {
    if (!activeScenarioId || library?.scenarios.some((scenario) => scenario.id === activeScenarioId)) return;
    setActiveScenarioId(null);
  }, [activeScenarioId, library]);

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

  function clearFilters(): void {
    setScope(ALL_SCOPE);
    setTagFilters(new Set());
    setMinLikes(0);
    setQuery("");
    clearSelection();
  }

  function openViewer(itemId: string, scenarioId?: string): void {
    setViewer(scenarioId ? { startId: itemId, scenarioId } : { startId: itemId });
  }

  function adjustLikes(itemIds: string[], delta: number): void {
    if (itemIds.length === 0) return;
    void run(() => window.milbi.adjustMediaLikes(itemIds, delta), setLibrary);
  }

  function handleRenameTag(tag: string): void {
    const nextTag = window.prompt("필터 이름", tag);
    if (!nextTag || nextTag === tag) return;
    void run(() => window.milbi.renameTag(tag, nextTag), (nextLibrary) => {
      setLibrary(nextLibrary);
      setTagFilters((current) => {
        if (!current.has(tag)) return current;
        const next = new Set(current);
        next.delete(tag);
        next.add(nextTag.trim().replace(/^#/, ""));
        return next;
      });
    });
  }

  function handleDeleteTag(tag: string): void {
    if (!window.confirm(`#${tag} 필터를 모든 항목에서 제거할까요?`)) return;
    void run(() => window.milbi.deleteTag(tag), (nextLibrary) => {
      setLibrary(nextLibrary);
      setTagFilters((current) => {
        const next = new Set(current);
        next.delete(tag);
        return next;
      });
    });
  }

  function handleMediaDragStart(itemId: string, event: DragEvent): void {
    const ids = selectedIds.has(itemId) && selectedIds.size > 0 ? [...selectedIds] : [itemId];
    event.dataTransfer.setData(MEDIA_DRAG_TYPE, JSON.stringify(ids));
    event.dataTransfer.effectAllowed = "copyMove";
  }

  function allowFilterDrop(event: DragEvent): void {
    if (!hasDroppableMedia(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }

  async function importDroppedForFilter(filePaths: string[], applyImported: (ids: string[]) => Promise<LibraryState>): Promise<LibraryState> {
    const result = await window.milbi.importDroppedMedia(filePaths, targetFolderId());
    let nextLibrary = await window.milbi.getLibrary();
    if (result.imported.length > 0) {
      nextLibrary = await applyImported(result.imported.map((item) => item.id));
      if (autoOrientationTagging) {
        nextLibrary = await tagOrientations(result.imported);
      }
    }
    if (result.skipped.length > 0) {
      setError(`가져오지 못한 파일: ${result.skipped.join(", ")}`);
    }
    return nextLibrary;
  }

  function handleDropOnTag(tag: string, event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    setDraggingFiles(false);
    const ids = droppedMediaIds(event);
    if (ids.length > 0) {
      void run(() => window.milbi.addTagsToMedia(ids, [tag]), setLibrary);
      return;
    }

    const filePaths = droppedFilePaths(event);
    if (filePaths.length > 0) {
      void run(() => importDroppedForFilter(filePaths, (importedIds) => window.milbi.addTagsToMedia(importedIds, [tag])), setLibrary);
    }
  }

  function handleDropOnTier(tier: TierName, event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    setDraggingFiles(false);
    const minimumLikes = tierMinimum(tier);
    const ids = droppedMediaIds(event);
    if (ids.length > 0) {
      void run(() => window.milbi.setMediaLikes(ids, minimumLikes), setLibrary);
      return;
    }

    const filePaths = droppedFilePaths(event);
    if (filePaths.length > 0) {
      void run(() => importDroppedForFilter(filePaths, (importedIds) => window.milbi.setMediaLikes(importedIds, minimumLikes)), setLibrary);
    }
  }

  function handleCreateScenario(): void {
    const name = window.prompt("시나리오 이름");
    if (!name) return;
    void run(() => window.milbi.createScenario(name), (nextLibrary) => {
      setLibrary(nextLibrary);
      const created = [...nextLibrary.scenarios].sort((a, b) => b.createdAt - a.createdAt)[0];
      setActiveScenarioId(created?.id ?? null);
    });
  }

  function handleRenameScenario(scenario: ScenarioRecord): void {
    const name = window.prompt("시나리오 이름", scenario.name);
    if (!name || name === scenario.name) return;
    void run(() => window.milbi.updateScenario(scenario.id, { name }), setLibrary);
  }

  function handleDeleteScenario(scenario: ScenarioRecord): void {
    if (!window.confirm(`${scenario.name} 시나리오를 삭제할까요?`)) return;
    void run(() => window.milbi.deleteScenario(scenario.id), (nextLibrary) => {
      setLibrary(nextLibrary);
      if (activeScenarioId === scenario.id) {
        setActiveScenarioId(null);
      }
    });
  }

  function updateScenarioItems(scenario: ScenarioRecord, itemIds: string[]): void {
    void run(() => window.milbi.updateScenario(scenario.id, { itemIds }), setLibrary);
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
    if (scope === ALL_SCOPE || scope === UNTAGGED_SCOPE || scope === LIKED_SCOPE || tierFromScope(scope)) return ROOT_FOLDER_ID;
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
      setViewer(null);
      setActiveScenarioId(null);
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

        <div className="side-section">
          <div className="side-heading">
            <span>티어</span>
            {tierFromScope(scope) && (
              <button className="text-button" onClick={clearFilters}>
                해제
              </button>
            )}
          </div>
          {TIERS.map((tier) => (
            <button
              className={`side-item tier-item ${scope === tierScope(tier.name) ? "active" : ""}`}
              key={tier.name}
              onClick={() => {
                setScope(tierScope(tier.name));
                clearSelection();
              }}
              onDragOver={allowFilterDrop}
              onDrop={(event) => handleDropOnTier(tier.name, event)}
            >
              <span className={`tier-mark tier-${tier.name.toLowerCase()}`}>{tier.name}</span>
              <span>{tier.label}</span>
            </button>
          ))}
        </div>

        <div className="side-section">
          <div className="side-heading">
            <span>시나리오</span>
            <button className="icon-button small" title="시나리오 추가" onClick={handleCreateScenario} disabled={busy}>
              <Plus size={15} />
            </button>
          </div>
          {library.scenarios.length === 0 ? (
            <div className="muted-line">시나리오 없음</div>
          ) : (
            library.scenarios.map((scenario) => (
              <div className={`filter-row ${activeScenarioId === scenario.id ? "active" : ""}`} key={scenario.id}>
                <button
                  className="side-item"
                  onClick={() => {
                    setActiveScenarioId(scenario.id);
                    clearSelection();
                  }}
                >
                  <List size={15} />
                  <span>{scenario.name}</span>
                </button>
                <button className="icon-button tiny" title="이름 변경" onClick={() => handleRenameScenario(scenario)}>
                  <Pencil size={14} />
                </button>
                <button className="icon-button tiny danger" title="삭제" onClick={() => handleDeleteScenario(scenario)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
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
              <div
                className={`filter-row ${tagFilters.has(tag) ? "active" : ""}`}
                key={tag}
                onDragOver={allowFilterDrop}
                onDrop={(event) => handleDropOnTag(tag, event)}
              >
                <button className="side-item" onClick={() => toggleTagFilter(tag)}>
                  <Tag size={15} />
                  <span>{tag}</span>
                </button>
                <button className="icon-button tiny" title="필터 이름 수정" onClick={() => handleRenameTag(tag)}>
                  <Pencil size={14} />
                </button>
                <button className="icon-button tiny danger" title="필터 제거" onClick={() => handleDeleteTag(tag)}>
                  <Trash2 size={14} />
                </button>
              </div>
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
              {` · ${dateSortOrder === "newest" ? "최신순" : "오래된순"}`}
              {activeTagFilters.length > 0 ? ` · ${activeTagFilters.map((tag) => `#${tag}`).join(" + ")}` : ""}
              {minLikes > 0 ? ` · 좋아요 ${minLikes}+` : ""}
            </div>
          </div>
          <div className="library-controls">
            {hasActiveFilters && (
              <button className="secondary-button compact" onClick={clearFilters}>
                필터 초기화
              </button>
            )}
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
            <button
              className="secondary-button compact"
              title="추가 날짜 정렬"
              onClick={() => setDateSortOrder((order) => (order === "newest" ? "oldest" : "newest"))}
            >
              <ArrowDownUp size={15} />
              {dateSortOrder === "newest" ? "최신순" : "오래된순"}
            </button>
            <button
              className={`secondary-button compact ${showDates ? "active" : ""}`}
              title="추가 날짜 표시"
              onClick={() => setShowDates((visible) => !visible)}
            >
              <CalendarDays size={15} />
              날짜
            </button>
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
                    showDate={showDates}
                    onSelect={(event) => selectItem(item.id, event)}
                    onToggle={(event) => selectItem(item.id, event, true)}
                    onDragStart={(event) => handleMediaDragStart(item.id, event)}
                    onOpen={() => openViewer(item.id)}
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
                    showDate={showDates}
                    onSelect={(event) => selectItem(item.id, event)}
                    onToggle={(event) => selectItem(item.id, event, true)}
                    onDragStart={(event) => handleMediaDragStart(item.id, event)}
                    onOpen={() => openViewer(item.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {selectedItem && !activeScenario && (
            <Inspector
              item={selectedItem}
              library={library}
              busy={busy}
              onClose={clearSelection}
              onOpen={() => openViewer(selectedItem.id)}
              onLibrary={setLibrary}
              run={run}
              onAdjustLikes={(delta) => adjustLikes([selectedItem.id], delta)}
            />
          )}
          {activeScenario && (
            <ScenarioEditor
              scenario={activeScenario}
              items={library.items}
              scenarioItems={activeScenarioItems}
              busy={busy}
              onClose={() => setActiveScenarioId(null)}
              onRename={() => handleRenameScenario(activeScenario)}
              onDelete={() => handleDeleteScenario(activeScenario)}
              onUpdateItems={(itemIds) => updateScenarioItems(activeScenario, itemIds)}
              onOpenViewer={(itemId) => openViewer(itemId, activeScenario.id)}
            />
          )}
        </section>
      </main>

      {viewer && (
        <Viewer
          items={viewerItems}
          startId={viewer.startId}
          onClose={() => setViewer(null)}
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
  showDate: boolean;
  onSelect: (event: MouseEvent) => void;
  onToggle: (event: MouseEvent) => void;
  onDragStart: (event: DragEvent) => void;
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
          <video src={mediaSrc(item.id)} preload="metadata" muted draggable={false} />
        ) : (
          <img src={mediaSrc(item.id)} alt="" loading="lazy" draggable={false} />
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

function MediaTile({ item, selected, showSelection, showDate, onSelect, onToggle, onDragStart, onOpen }: MediaTileProps) {
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
    <article
      className={`media-tile ${selected ? "selected" : ""} ${showSelection ? "show-selection" : ""}`}
      draggable
      onClick={click}
      onDragStart={onDragStart}
    >
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
        <div className="tile-meta">
          <span>{formatBytes(item.size)}</span>
          {showDate && <span>{formatDate(item.importedAt)}</span>}
        </div>
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
  showDate: boolean;
  onSelect: (event: MouseEvent) => void;
  onToggle: (event: MouseEvent) => void;
  onDragStart: (event: DragEvent) => void;
  onOpen: () => void;
}

function MediaListRow({ item, selected, showSelection, showDate, onSelect, onToggle, onDragStart, onOpen }: MediaListRowProps) {
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
    <article
      className={`media-row ${selected ? "selected" : ""} ${showSelection ? "show-selection" : ""}`}
      draggable
      onClick={click}
      onDragStart={onDragStart}
    >
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
          {item.kind === "video" ? "영상" : "이미지"} · {formatBytes(item.size)}
          {showDate ? ` · ${formatDate(item.importedAt)}` : ""}
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
  onAdjustLikes: (delta: number) => void;
}

function Inspector({ item, library, busy, onClose, onOpen, onLibrary, run, onAdjustLikes }: InspectorProps) {
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
          <dd>
            <span className="like-stepper">
              <button className="icon-button tiny" title="좋아요 낮추기" onClick={() => onAdjustLikes(-1)} disabled={busy || item.likes <= 0}>
                <Minus size={13} />
              </button>
              <span>{item.likes}</span>
              <button className="icon-button tiny" title="좋아요 올리기" onClick={() => onAdjustLikes(1)} disabled={busy}>
                <Plus size={13} />
              </button>
            </span>
          </dd>
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

interface ScenarioEditorProps {
  scenario: ScenarioRecord;
  items: MediaRecord[];
  scenarioItems: MediaRecord[];
  busy: boolean;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
  onUpdateItems: (itemIds: string[]) => void;
  onOpenViewer: (itemId: string) => void;
}

function ScenarioEditor({
  scenario,
  items,
  scenarioItems,
  busy,
  onClose,
  onRename,
  onDelete,
  onUpdateItems,
  onOpenViewer
}: ScenarioEditorProps) {
  const itemIds = scenarioItems.map((item) => item.id);
  const availableIds = useMemo(() => new Set(items.map((item) => item.id)), [items]);

  function insertMediaIds(incomingIds: string[], index = itemIds.length): void {
    const existingIds = new Set(itemIds);
    const cleanIds = incomingIds.filter((itemId) => availableIds.has(itemId) && !existingIds.has(itemId));
    if (cleanIds.length === 0) return;
    const nextIds = [...itemIds];
    nextIds.splice(index, 0, ...cleanIds);
    onUpdateItems(nextIds);
  }

  function reorderItem(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= itemIds.length || toIndex > itemIds.length) return;
    const nextIds = [...itemIds];
    const [moved] = nextIds.splice(fromIndex, 1);
    nextIds.splice(fromIndex < toIndex ? toIndex - 1 : toIndex, 0, moved);
    onUpdateItems(nextIds);
  }

  function allowDrop(event: DragEvent): void {
    const types = Array.from(event.dataTransfer.types);
    if (!types.includes(MEDIA_DRAG_TYPE) && !types.includes(SCENARIO_DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
  }

  function dropAt(event: DragEvent, index = itemIds.length): void {
    event.preventDefault();
    event.stopPropagation();
    const rawSourceIndex = event.dataTransfer.getData(SCENARIO_DRAG_TYPE);
    const sourceIndex = rawSourceIndex === "" ? Number.NaN : Number(rawSourceIndex);
    if (Number.isInteger(sourceIndex)) {
      reorderItem(sourceIndex, index);
      return;
    }
    insertMediaIds(droppedMediaIds(event), index);
  }

  function removeAt(index: number): void {
    onUpdateItems(itemIds.filter((_itemId, itemIndex) => itemIndex !== index));
  }

  return (
    <aside className="scenario-editor">
      <div className="scenario-head">
        <div>
          <span className="eyebrow">Scenario</span>
          <h2>{scenario.name}</h2>
        </div>
        <button className="icon-button" title="닫기" onClick={onClose}>
          <X size={17} />
        </button>
      </div>

      <div className="scenario-actions">
        <button className="primary-button compact" onClick={() => scenarioItems[0] && onOpenViewer(scenarioItems[0].id)} disabled={scenarioItems.length === 0}>
          <Play size={15} />
          보기
        </button>
        <button className="secondary-button compact" onClick={onRename} disabled={busy}>
          <Pencil size={14} />
          이름
        </button>
        <button className="secondary-button compact danger" onClick={onDelete} disabled={busy}>
          <Trash2 size={14} />
          삭제
        </button>
      </div>

      <div className="scenario-list" onDragOver={allowDrop} onDrop={(event) => dropAt(event)}>
        {scenarioItems.length === 0 ? (
          <div className="scenario-empty">왼쪽 항목을 드래그해서 추가</div>
        ) : (
          scenarioItems.map((item, index) => (
            <div
              className="scenario-row"
              draggable
              key={item.id}
              onDragStart={(event) => {
                event.dataTransfer.setData(SCENARIO_DRAG_TYPE, String(index));
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={allowDrop}
              onDrop={(event) => dropAt(event, index)}
              onDoubleClick={() => onOpenViewer(item.id)}
            >
              <GripVertical size={15} />
              <span className="scenario-index">{index + 1}</span>
              <button className="scenario-thumb" title="이 지점부터 보기" onClick={() => onOpenViewer(item.id)}>
                <LazyMediaPreview item={item} />
              </button>
              <div className="scenario-row-main">
                <span title={item.displayName}>{item.displayName}</span>
                <small>{item.kind === "video" ? "영상" : "이미지"}</small>
              </div>
              <button className="icon-button tiny danger" title="시나리오에서 제거" onClick={() => removeAt(index)}>
                <X size={14} />
              </button>
            </div>
          ))
        )}
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

  function dislikeCurrent(): void {
    if (!current) return;
    void window.milbi.adjustMediaLikes([current.id], -1).then(onLibrary).catch(() => undefined);
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
      } else if (event.key.toLowerCase() === "j") {
        event.preventDefault();
        dislikeCurrent();
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
          <button className="viewer-chip" title="좋아요 낮추기" onClick={dislikeCurrent} disabled={currentLikes <= 0}>
            <Minus size={15} />
            감소
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
