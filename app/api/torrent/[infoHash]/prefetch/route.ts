import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/settings-store";
import { getDiskSpace, formatBytes } from "@/lib/storage-store";

/** Never let a pull-ahead take the disk below this. Matches the storage floor. */
const FREE_SPACE_FLOOR_BYTES = 8 * 1024 * 1024 * 1024;

/**
 * Start pulling the next episode while the current one plays.
 *
 * Bandwidth safety is handled in the worker by selection priority, so the only
 * thing that needs deciding here is whether there is room on disk — a 4K
 * episode is ~5 GB, and holding two at once is what fills a drive overnight.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ infoHash: string }> }
) {
  const { infoHash } = await params;
  const body = await req.json().catch(() => null);
  const fileIndex = body?.fileIndex;
  const fileSize: number = Number(body?.fileSize) || 0;

  if (typeof fileIndex !== "number") {
    return NextResponse.json({ error: "Missing fileIndex" }, { status: 400 });
  }

  if (getSettings().prefetchNextEpisode === false) {
    return NextResponse.json({ prefetching: false, reason: "disabled" });
  }

  const disk = getDiskSpace();
  if (disk.freeBytes - fileSize < FREE_SPACE_FLOOR_BYTES) {
    // Refusing is the right outcome, not an error — say so plainly so it shows
    // up in the log rather than looking like the prefetch silently never ran.
    const msg =
      `Prefetch declined: ${formatBytes(fileSize)} would leave ` +
      `${formatBytes(Math.max(0, disk.freeBytes - fileSize))} free, ` +
      `under the ${formatBytes(FREE_SPACE_FLOOR_BYTES)} floor`;
    console.log(msg);
    return NextResponse.json({
      prefetching: false,
      reason: "low-disk",
      message: msg,
      freeFormatted: formatBytes(disk.freeBytes),
    });
  }

  try {
    const portRes = await fetch("http://localhost:8181/api/worker-port", {
      signal: AbortSignal.timeout(4000),
    });
    if (!portRes.ok) {
      return NextResponse.json({ prefetching: false, reason: "no-worker" });
    }
    const { port } = await portRes.json();

    const res = await fetch(
      `http://localhost:${port}/prefetch/${infoHash}?file=${fileIndex}`,
      { method: "POST", signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) {
      return NextResponse.json({ prefetching: false, reason: "worker-error" });
    }
    return NextResponse.json(await res.json());
  } catch {
    // A prefetch is an optimisation — never surface a failure to the player.
    return NextResponse.json({ prefetching: false, reason: "unreachable" });
  }
}
