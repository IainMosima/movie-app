import { NextRequest, NextResponse } from "next/server";
import {
  getStorageReport,
  reconcile,
  deleteCacheFolderFs,
  formatBytes,
} from "@/lib/storage-store";

// GET /api/storage - disk space + on-disk cache reconciliation report
export async function GET() {
  try {
    return NextResponse.json(getStorageReport());
  } catch (error) {
    console.error("Failed to build storage report:", error);
    return NextResponse.json(
      { error: "Failed to build storage report" },
      { status: 500 }
    );
  }
}

// DELETE /api/storage - reclaim disk: { folder } for one, or { orphansOnly: true } for all orphans
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    let targets: string[];
    if (body?.orphansOnly) {
      targets = reconcile()
        .filter((e) => e.kind === "orphan")
        .map((e) => e.name);
    } else if (typeof body?.folder === "string" && body.folder.length > 0) {
      targets = [body.folder];
    } else {
      return NextResponse.json(
        { error: "Provide { folder } or { orphansOnly: true }" },
        { status: 400 }
      );
    }

    let reclaimedBytes = 0;
    const deleted: string[] = [];
    for (const name of targets) {
      reclaimedBytes += deleteCacheFolderFs(name);
      deleted.push(name);
    }

    return NextResponse.json({
      success: true,
      deleted,
      reclaimedBytes,
      reclaimedFormatted: formatBytes(reclaimedBytes),
    });
  } catch (error) {
    console.error("Failed to reclaim storage:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reclaim storage" },
      { status: 500 }
    );
  }
}
