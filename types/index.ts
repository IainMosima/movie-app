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
}

export interface LibraryData {
  items: LibraryItem[];
}
