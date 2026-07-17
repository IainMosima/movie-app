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
export interface LibraryItem {
  id: string;
  name: string;
  magnet: string;
  addedAt: number;
  quality?: string;
  size?: string;
  fileIndex?: number;
}

export interface LibraryData {
  items: LibraryItem[];
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
