// Source configuration
export interface Source {
  id: string;
  name: string;
  url: string;
  queryParam: string;
}

export interface SourcesData {
  activeSourceId: string | null;
  sources: Source[];
}

// Engine settings
export interface EngineSettings {
  downloadLimit: number;
  uploadLimit: number;
  maxConnections: number;
  cleanupDelaySeconds: number;
  prebufferSeconds: number;
  bufferSizeMB: number;
  prebufferMode: "strict" | "timeout";
}

// Search result types
export interface SearchResult {
  title: string;
  magnet: string;
  seeds: number;
  size: string;
  quality: string;
  type: "movie" | "episode";
  series?: string;
  season?: number;
  episode?: number;
}

export interface SearchResponse {
  results: SearchResult[];
}

// Session tracking
export interface StreamSession {
  infoHash: string;
  sessionId: string;
  startedAt: number;
}

// Torrent info for streaming
export interface TorrentInfo {
  infoHash: string;
  name: string;
  files: TorrentFileInfo[];
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  numPeers: number;
  ready: boolean;
}

export interface TorrentFileInfo {
  name: string;
  path: string;
  length: number;
  index: number;
}

// API response types
export interface SessionStartResponse {
  infoHash: string;
  sessionId: string;
  torrent: TorrentInfo;
}

export interface ErrorResponse {
  error: string;
}

// Library - saved magnet links
export type LibraryCategory = "movie" | "series";

export interface LibraryItem {
  id: string;
  name: string;
  magnet: string;
  addedAt: number;
  quality?: string;
  size?: string;
  fileIndex?: number;
  // Grouping: null/undefined means the item sits loose at the top level.
  folderId?: string | null;
  // Explicit category override. When absent it's detected from the name/magnet
  // (see lib/category.ts), so existing items sort themselves without migration.
  category?: LibraryCategory;
  // Learned once the torrent resolves — the real on-disk cache folder name and
  // infoHash, so cache reconciliation is exact instead of guessing from `dn=`.
  cacheFolder?: string;
  infoHash?: string;
}

// A folder holds a series (episode per magnet) or a movie set. Grouping only —
// cached bytes still live under cache/<torrent-name>/ as before.
export interface LibraryFolder {
  id: string;
  name: string;
  createdAt: number;
  category?: LibraryCategory;
}

export interface LibraryData {
  items: LibraryItem[];
  folders: LibraryFolder[];
}

// GET /api/library — persisted shape joined with on-disk usage
export interface LibraryItemWithUsage extends LibraryItem {
  cachedBytes: number;
  cachedFormatted: string;
  // Always present in API responses — explicit choice or detected.
  category: LibraryCategory;
}

export interface LibraryFolderWithUsage extends LibraryFolder {
  itemCount: number;
  cachedBytes: number;
  cachedFormatted: string;
  category: LibraryCategory;
}

export interface LibraryListResponse {
  items: LibraryItemWithUsage[];
  folders: LibraryFolderWithUsage[];
}

// Storage management - on-disk cache reconciliation
export type StorageEntryKind = "matched" | "orphan" | "subtitles" | "transcode";

export interface StorageEntry {
  name: string;
  sizeBytes: number;
  sizeFormatted: string;
  kind: StorageEntryKind;
  libraryItemId?: string;
}

export interface DiskSpace {
  freeBytes: number;
  totalBytes: number;
  floorBytes: number;
  belowFloor: boolean;
}

export interface StorageReport {
  disk: DiskSpace;
  cacheTotalBytes: number;
  cacheTotalFormatted: string;
  entries: StorageEntry[];
}

// Watch progress - "where was I?" across every device on the LAN.
// Keyed by infoHash + fileIndex so each episode inside a season pack keeps its
// own position, and Quick Play titles that were never saved are tracked too.
export interface WatchRecord {
  infoHash: string;
  fileIndex: number;
  title: string;
  magnet: string;
  libraryItemId?: string;
  positionSec: number;
  durationSec: number;
  finished: boolean;
  updatedAt: number;
}

export interface WatchProgressData {
  records: WatchRecord[];
}

// Runtime-switchable data directory
export interface DataDirReport {
  activeDir: string;
  mediaRoot: string;
  freeBytes: number;
  totalBytes: number;
}

export interface BrowseEntry {
  name: string;
  path: string;
}

export interface BrowseResponse {
  path: string;
  parent: string | null;
  entries: BrowseEntry[];
  error?: string;
}
