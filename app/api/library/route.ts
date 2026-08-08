import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAllItems, getFolders, addItem } from "@/lib/library-store";
import { getUsageByItem, formatBytes } from "@/lib/storage-store";
import { resolveItemCategory, resolveFolderCategory } from "@/lib/category";
import { isValidTorrentInput } from "@/lib/torrent-utils";
import type { LibraryListResponse } from "@/types";

const AddItemSchema = z.object({
  name: z.string().min(1, "Name is required"),
  magnet: z.string().refine(isValidTorrentInput, "Invalid magnet link or .torrent URL"),
  quality: z.string().optional(),
  size: z.string().optional(),
  folderId: z.string().nullable().optional(),
  category: z.enum(["movie", "series"]).optional(),
});

// GET /api/library - List saved magnets and folders, joined with on-disk usage
export async function GET() {
  try {
    const usage = getUsageByItem();

    const items = getAllItems().map((item) => {
      const cachedBytes = usage.get(item.id) ?? 0;
      return {
        ...item,
        cachedBytes,
        cachedFormatted: formatBytes(cachedBytes),
        category: resolveItemCategory(item),
      };
    });

    const folders = getFolders().map((folder) => {
      const own = items.filter((i) => i.folderId === folder.id);
      const cachedBytes = own.reduce((sum, i) => sum + i.cachedBytes, 0);
      return {
        ...folder,
        itemCount: own.length,
        cachedBytes,
        cachedFormatted: formatBytes(cachedBytes),
        category: resolveFolderCategory(folder, own),
      };
    });

    const body: LibraryListResponse = { items, folders };
    return NextResponse.json(body);
  } catch (error) {
    console.error("Failed to get library:", error);
    return NextResponse.json(
      { error: "Failed to get library" },
      { status: 500 }
    );
  }
}

// POST /api/library - Add magnet to library (optionally straight into a folder)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = AddItemSchema.parse(body);

    const item = addItem({
      name: validated.name,
      magnet: validated.magnet,
      quality: validated.quality,
      size: validated.size,
      folderId: validated.folderId ?? null,
      category: validated.category,
    });

    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Failed to add to library:", error);
    return NextResponse.json(
      { error: "Failed to add to library" },
      { status: 500 }
    );
  }
}
