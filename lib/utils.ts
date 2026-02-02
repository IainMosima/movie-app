import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function getQualityColor(quality: string): string {
  const q = quality.toLowerCase();
  if (q.includes("4k") || q.includes("2160")) return "bg-purple-600";
  if (q.includes("1080")) return "bg-blue-600";
  if (q.includes("720")) return "bg-green-600";
  if (q.includes("480") || q.includes("sd")) return "bg-yellow-600";
  return "bg-zinc-600";
}

export function parseRange(
  rangeHeader: string,
  fileSize: number
): [number, number] {
  const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
  if (!match) {
    return [0, fileSize - 1];
  }

  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

  return [start, Math.min(end, fileSize - 1)];
}
