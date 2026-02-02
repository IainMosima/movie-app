import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setActiveSource, getActiveSource } from "@/lib/sources-store";

const SetActiveSchema = z.object({
  id: z.string().min(1, "Source ID is required"),
});

// GET /api/sources/active - Get active source
export async function GET() {
  try {
    const source = getActiveSource();
    return NextResponse.json(source);
  } catch (error) {
    console.error("Failed to get active source:", error);
    return NextResponse.json(
      { error: "Failed to get active source" },
      { status: 500 }
    );
  }
}

// PUT /api/sources/active - Set active source
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id } = SetActiveSchema.parse(body);

    const success = setActiveSource(id);
    if (!success) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, activeSourceId: id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Failed to set active source:", error);
    return NextResponse.json(
      { error: "Failed to set active source" },
      { status: 500 }
    );
  }
}
