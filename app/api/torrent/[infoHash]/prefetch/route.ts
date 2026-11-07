import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/settings-store";
import { getDiskSpace, formatBytes } from "@/lib/storage-store";
import { getAllItems } from "@/lib/library-store";
import { extractInfoHashFromMagnet } from "@/lib/torrent-cache-actions";
import { addDownload, prefetchAccepted, workerPrefetch } from "@/lib/downloads-store";

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
  // A user-pressed Download button: kept alongside other downloads, and not
  // subject to the auto "prefetch next episode" setting.
  const pin = body?.pin === true;

  if (typeof fileIndex !== "number") {
    return NextResponse.json({ error: "Missing fileIndex" }, { status: 400 });
  }

  if (!pin && getSettings().prefetchNextEpisode === false) {
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
      message: `Not enough space (needs ${formatBytes(fileSize)} + ${formatBytes(FREE_SPACE_FLOOR_BYTES)} reserve, ${formatBytes(disk.freeBytes)} free)`,
      freeFormatted: formatBytes(disk.freeBytes),
    });
  }

  const result = await workerPrefetch(infoHash, fileIndex, pin);
  if (pin && prefetchAccepted(result)) rememberPin(infoHash, fileIndex, fileSize, result.file);
  // A prefetch is an optimisation — failures come back as a reason, never thrown.
  return NextResponse.json(result);
}

/** Keep a Download-button pin across restarts, same as POST /api/downloads. */
function rememberPin(infoHash: string, fileIndex: number, size: number, fileName?: string) {
  const hash = infoHash.toLowerCase();
  const item = getAllItems().find(
    (i) => (i.infoHash ?? extractInfoHashFromMagnet(i.magnet))?.toLowerCase() === hash
  );
  addDownload({
    infoHash: hash,
    fileIndex,
    magnet: item?.magnet ?? `magnet:?xt=urn:btih:${hash}`,
    title: item?.name ?? fileName ?? `File ${fileIndex}`,
    size,
  });
}
