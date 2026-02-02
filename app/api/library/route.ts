import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAllItems, addItem } from "@/lib/library-store";

const AddItemSchema = z.object({
  name: z.string().min(1, "Name is required"),
  magnet: z.string().startsWith("magnet:", "Invalid magnet link"),
  quality: z.string().optional(),
  size: z.string().optional(),
});

// GET /api/library - List all saved magnets
export async function GET() {
  try {
    const items = getAllItems();
    return NextResponse.json({ items });
  } catch (error) {
    console.error("Failed to get library:", error);
    return NextResponse.json(
      { error: "Failed to get library" },
      { status: 500 }
    );
  }
}

// POST /api/library - Add magnet to library
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = AddItemSchema.parse(body);

    const item = addItem({
      name: validated.name,
      magnet: validated.magnet,
      quality: validated.quality,
      size: validated.size,
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
