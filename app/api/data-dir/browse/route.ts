import { NextRequest, NextResponse } from "next/server";
import { readdirSync, statSync } from "fs";
import { dirname, resolve } from "path";
import { getMediaRoot, toHostPath, toLocalPath } from "@/lib/data-dir";
import type { BrowseResponse } from "@/types";

// GET /api/data-dir/browse?path=<abs> - list immediate subdirectories of a path.
// No artificial sandbox: in Docker the container's mount namespace is the
// natural boundary; locally the app already runs with the user's own
// filesystem access, so restricting browsing further wouldn't add safety.
export async function GET(request: NextRequest) {
  // The picker shows computer paths; in Docker they're translated to what the
  // container can open, and back again in the answer.
  const requested = request.nextUrl.searchParams.get("path");
  const local = resolve(requested ? toLocalPath(requested) : getMediaRoot());
  const target = toHostPath(local);

  const parent = (() => {
    const p = dirname(local);
    if (p === local || (getMediaRoot() !== "/" && !p.startsWith(getMediaRoot()) && local === getMediaRoot())) return null;
    return toHostPath(p);
  })();

  try {
    const stat = statSync(local);
    if (!stat.isDirectory()) {
      const response: BrowseResponse = {
        path: target,
        parent,
        entries: [],
        error: "Not a directory",
      };
      return NextResponse.json(response);
    }

    const entries = readdirSync(local, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => ({ name: d.name, path: toHostPath(resolve(local, d.name)) }))
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
