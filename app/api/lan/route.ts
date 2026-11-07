import { NextRequest, NextResponse } from "next/server";
import { lanHost } from "@/lib/lan-host";

/** The app's address as other devices on the Wi-Fi see it (never localhost). */
export function GET(req: NextRequest) {
  return NextResponse.json({ origin: `http://${lanHost(req)}:${req.nextUrl.port || "8181"}` });
}
