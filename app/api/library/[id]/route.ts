import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getItemById, updateItem, deleteItem } from "@/lib/library-store";

const UpdateItemSchema = z.object({
  name: z.string().min(1).optional(),
  quality: z.string().optional(),
  size: z.string().optional(),
  fileIndex: z.number().int().nonnegative().optional(),
});

function extractInfoHash(magnet: string): string | null {
  // Standard magnet URI
  const m = magnet.match(/[?&]xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
  if (m) return m[1].toLowerCase();
  return null;
}

async function deleteFromWorker(infoHash: string, itemName?: string): Promise<void> {
  try {
    const portRes = await fetch("http://localhost:8181/api/worker-port");
    if (!portRes.ok) return;
    const { port } = await portRes.json();
    const nameParam = itemName ? `?name=${encodeURIComponent(itemName)}` : "";
    await fetch(`http://localhost:${port}/torrent/${infoHash}${nameParam}`, { method: "DELETE" });
  } catch {
    // Worker may not be running — files already gone or will be cleaned up
  }
}

// GET /api/library/[id] - Get single item
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const item = getItemById(id);
    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    return NextResponse.json(item);
  } catch (error) {
    console.error("Failed to get item:", error);
    return NextResponse.json(
      { error: "Failed to get item" },
      { status: 500 }
    );
  }
}

// PUT /api/library/[id] - Update item
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const validated = UpdateItemSchema.parse(body);

    const item = updateItem(id, validated);
    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    return NextResponse.json(item);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Failed to update item:", error);
    return NextResponse.json(
      { error: "Failed to update item" },
      { status: 500 }
    );
  }
}

// DELETE /api/library/[id] - Delete item and wipe cached files
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const item = getItemById(id);
    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    // Extract infoHash and tell the worker to destroy cached files
    const infoHash = extractInfoHash(item.magnet);
    if (infoHash) {
      await deleteFromWorker(infoHash, item.name);
    }

    const deleted = deleteItem(id);
    if (!deleted) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete item:", error);
    return NextResponse.json(
      { error: "Failed to delete item" },
      { status: 500 }
    );
  }
}
