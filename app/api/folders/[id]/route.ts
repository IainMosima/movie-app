import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getFolderById,
  getItemsByFolder,
  updateFolder,
  deleteFolder,
} from "@/lib/library-store";
import { deleteCacheForLibraryItem, formatBytes } from "@/lib/storage-store";
import { extractInfoHashFromMagnet, deleteFromWorker } from "@/lib/torrent-cache-actions";

const UpdateFolderSchema = z
  .object({
    name: z.string().min(1).optional(),
    category: z.enum(["movie", "series"]).optional(),
  })
  .refine((v) => v.name !== undefined || v.category !== undefined, {
    message: "Provide name and/or category",
  });

// PATCH /api/folders/[id] - rename and/or recategorise
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const updates = UpdateFolderSchema.parse(body);

    const folder = updateFolder(id, updates);
    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    return NextResponse.json(folder);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Failed to update folder:", error);
    return NextResponse.json({ error: "Failed to update folder" }, { status: 500 });
  }
}

// DELETE /api/folders/[id] - remove the folder.
// By default its items survive as loose top-level items; ?deleteItems=1 also
// deletes the items and wipes their cached bytes.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const folder = getFolderById(id);
    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }

    const deleteItems = request.nextUrl.searchParams.get("deleteItems") === "1";
    let reclaimedBytes = 0;

    if (deleteItems) {
      // Clear cached bytes while the items still exist — reconcile needs them
      // to match folders on disk.
      for (const item of getItemsByFolder(id)) {
        const infoHash = extractInfoHashFromMagnet(item.magnet);
        if (infoHash) await deleteFromWorker(infoHash, item.name);
        try {
          reclaimedBytes += deleteCacheForLibraryItem(item.id);
        } catch (e) {
          console.error("Cache fs-fallback failed:", e);
        }
      }
    }

    deleteFolder(id, { deleteItems });

    return NextResponse.json({
      success: true,
      deletedItems: deleteItems,
      reclaimedBytes,
      reclaimedFormatted: formatBytes(reclaimedBytes),
    });
  } catch (error) {
    console.error("Failed to delete folder:", error);
    return NextResponse.json({ error: "Failed to delete folder" }, { status: 500 });
  }
}
