import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAllSources, addSource, getSources } from "@/lib/sources-store";

const CreateSourceSchema = z.object({
  name: z.string().min(1, "Name is required"),
  url: z.string().url("Invalid URL"),
  queryParam: z.string().default("q"),
});

// GET /api/sources - List all sources
export async function GET() {
  try {
    const data = getSources();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to get sources:", error);
    return NextResponse.json(
      { error: "Failed to get sources" },
      { status: 500 }
    );
  }
}

// POST /api/sources - Add new source
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = CreateSourceSchema.parse(body);

    const source = addSource({
      name: validated.name,
      url: validated.url,
      queryParam: validated.queryParam,
    });

    return NextResponse.json(source, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Failed to add source:", error);
    return NextResponse.json(
      { error: "Failed to add source" },
      { status: 500 }
    );
  }
}
