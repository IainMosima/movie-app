import { NextRequest, NextResponse } from "next/server";
import {
  getFolderById,
  reorderFolderItems,
  clearFolderItemOrder,
} from "@/lib/library-store";

/** PUT { orderedIds } — pin this folder's items to an explicit arrangement. */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!getFolderById(id)) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const orderedIds = body?.orderedIds;
  if (!Array.isArray(orderedIds) || orderedIds.some((v) => typeof v !== "string")) {
    return NextResponse.json(
      { error: "orderedIds must be an array of item ids" },
      { status: 400 }
    );
  }

  return NextResponse.json({ items: reorderFolderItems(id, orderedIds) });
}

/** DELETE — drop the manual arrangement and fall back to episode order. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!getFolderById(id)) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  return NextResponse.json({ items: clearFolderItemOrder(id) });
}
