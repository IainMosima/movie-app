import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getSourceById,
  updateSource,
  deleteSource,
} from "@/lib/sources-store";

const UpdateSourceSchema = z.object({
  name: z.string().min(1).optional(),
  url: z.string().url().optional(),
  queryParam: z.string().optional(),
});

// GET /api/sources/[id] - Get single source
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const source = getSourceById(id);
    if (!source) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }
    return NextResponse.json(source);
  } catch (error) {
    console.error("Failed to get source:", error);
    return NextResponse.json(
      { error: "Failed to get source" },
      { status: 500 }
    );
  }
}

// PUT /api/sources/[id] - Update source
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const validated = UpdateSourceSchema.parse(body);

    const source = updateSource(id, validated);
    if (!source) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    return NextResponse.json(source);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Failed to update source:", error);
    return NextResponse.json(
      { error: "Failed to update source" },
      { status: 500 }
    );
  }
}

// DELETE /api/sources/[id] - Delete source
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const deleted = deleteSource(id);
    if (!deleted) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete source:", error);
    return NextResponse.json(
      { error: "Failed to delete source" },
      { status: 500 }
    );
  }
}
