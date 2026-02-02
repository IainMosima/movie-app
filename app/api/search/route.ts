import { NextRequest, NextResponse } from "next/server";
import { getActiveSource } from "@/lib/sources-store";
import type { SearchResponse } from "@/types";

// GET /api/search?q=term - Proxy search to active source
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");

  if (!query) {
    return NextResponse.json(
      { error: "Search query is required" },
      { status: 400 }
    );
  }

  const source = getActiveSource();
  if (!source) {
    return NextResponse.json(
      { error: "No active source configured. Please add a source in Settings." },
      { status: 400 }
    );
  }

  try {
    // Build the search URL
    const searchUrl = new URL(source.url);
    searchUrl.searchParams.set(source.queryParam, query);

    console.log(`Searching: ${searchUrl.toString()}`);

    const response = await fetch(searchUrl.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "MovieApp/1.0",
      },
    });

    if (!response.ok) {
      console.error(`Source returned ${response.status}: ${response.statusText}`);
      return NextResponse.json(
        { error: `Source returned error: ${response.statusText}` },
        { status: response.status }
      );
    }

    const data: SearchResponse = await response.json();

    // Validate response format
    if (!data.results || !Array.isArray(data.results)) {
      return NextResponse.json(
        { error: "Invalid response format from source" },
        { status: 502 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Search failed:", error);
    return NextResponse.json(
      { error: "Failed to fetch results from source" },
      { status: 502 }
    );
  }
}
