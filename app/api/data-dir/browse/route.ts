import { NextRequest, NextResponse } from "next/server";
import { readdirSync, statSync } from "fs";
import { dirname, resolve } from "path";
import { getMediaRoot } from "@/lib/data-dir";
import type { BrowseResponse } from "@/types";

// GET /api/data-dir/browse?path=<abs> - list immediate subdirectories of a path.
// No artificial sandbox: in Docker the container's mount namespace is the
// natural boundary; locally the app already runs with the user's own
// filesystem access, so restricting browsing further wouldn't add safety.
export async function GET(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get("path");
  const target = resolve(requested || getMediaRoot());

  const parent = (() => {
    const p = dirname(target);
    return p === target ? null : p;
  })();

  try {
    const stat = statSync(target);
    if (!stat.isDirectory()) {
      const response: BrowseResponse = {
        path: target,
        parent,
        entries: [],
        error: "Not a directory",
      };
      return NextResponse.json(response);
    }

    const entries = readdirSync(target, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => ({ name: d.name, path: resolve(target, d.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const response: BrowseResponse = { path: target, parent, entries };
    return NextResponse.json(response);
  } catch (error) {
    const response: BrowseResponse = {
      path: target,
      parent,
      entries: [],
      error: error instanceof Error ? error.message : "Failed to browse",
    };
    return NextResponse.json(response);
  }
}
