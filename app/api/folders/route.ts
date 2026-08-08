import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getFolders, getAllItems, addFolder } from "@/lib/library-store";
import { getUsageByItem, formatBytes } from "@/lib/storage-store";
import { resolveFolderCategory } from "@/lib/category";
import type { LibraryFolderWithUsage } from "@/types";

const CreateFolderSchema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.enum(["movie", "series"]).optional(),
});

// GET /api/folders - folders with item counts and on-disk usage
export async function GET() {
  try {
    const usage = getUsageByItem();
    const items = getAllItems();

    const folders: LibraryFolderWithUsage[] = getFolders().map((folder) => {
      const own = items.filter((i) => i.folderId === folder.id);
      const cachedBytes = own.reduce((sum, i) => sum + (usage.get(i.id) ?? 0), 0);
      return {
        ...folder,
        itemCount: own.length,
        cachedBytes,
        cachedFormatted: formatBytes(cachedBytes),
        category: resolveFolderCategory(folder, own),
      };
    });

    return NextResponse.json({ folders });
  } catch (error) {
    console.error("Failed to get folders:", error);
    return NextResponse.json({ error: "Failed to get folders" }, { status: 500 });
  }
}

// POST /api/folders - create a folder
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, category } = CreateFolderSchema.parse(body);
    return NextResponse.json(addFolder(name, category), { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Failed to create folder:", error);
    return NextResponse.json({ error: "Failed to create folder" }, { status: 500 });
  }
}
