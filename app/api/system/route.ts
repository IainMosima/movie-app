import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { getTorrentEngine } from "@/lib/torrent-engine";

/** Docker (the image sets SPACEFLIX_DOCKER=1; /.dockerenv as a fallback). */
function inDocker(): boolean {
  return process.env.SPACEFLIX_DOCKER === "1" || existsSync("/.dockerenv");
}

// GET /api/system — what the power menu can offer here.
export function GET() {
  const docker = inDocker();
  return NextResponse.json({ docker, canTurnOff: !docker });
}

// POST /api/system {action: "stop" | "restart"}
//
// Mac / plain Node: shut the torrent worker down and exit. For restart, first
// launch a detached copy (`caffeinate -s npm run start` on macOS, like the
// usual manual start) that waits a few seconds so the ports are free; its
// output goes to data/server.log.
//
// Docker: the container's restart policy (unless-stopped) brings the app back
// whenever it exits, so restart = clean exit and nothing else (a second copy
// inside the container would fight over the ports), and "turn off" can't stick,
// so it's refused — stop the container instead.
//
// ponytail: no auth, like the rest of this LAN-only app; the UI asks first.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action !== "stop" && action !== "restart") {
    return NextResponse.json({ error: "action must be stop or restart" }, { status: 400 });
  }
  const docker = inDocker();
  if (docker && action === "stop") {
    return NextResponse.json(
      { error: "docker", message: "In Docker the app restarts itself; stop the container instead." },
      { status: 409 }
    );
  }

  // Answer first; shut down just after, so the browser gets its response.
  setTimeout(async () => {
    try {
      if (action === "restart" && !docker) {
        const root = process.cwd();
        const log = join(root, "data", "server.log");
        const start = process.platform === "darwin" ? "caffeinate -s npm run start" : "npm run start";
        const child = spawn("/bin/sh", ["-c", `sleep 4; cd "${root}" && exec ${start} >> "${log}" 2>&1`], {
          detached: true,
          stdio: "ignore",
          env: process.env,
        });
        child.unref();
      }
      await getTorrentEngine().shutdown();
    } catch (e) {
      console.error("Shutdown error:", e);
    } finally {
      console.log(action === "restart" ? "Restarting Spaceflix…" : "Spaceflix turned off from the app.");
      process.exit(0);
    }
  }, 300);

  return NextResponse.json({ ok: true, action, docker });
}
