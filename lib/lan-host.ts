import type { NextRequest } from "next/server";
import { networkInterfaces } from "os";

/** An address other devices on the Wi-Fi can reach — never "localhost". */
export function lanHost(req: NextRequest): string {
  const host = (req.headers.get("host") ?? "").split(":")[0];
  if (host && !/^(localhost|127\.|\[?::1)/.test(host)) return host;
  for (const addrs of Object.values(networkInterfaces())) {
    const v4 = addrs?.find((a) => a.family === "IPv4" && !a.internal);
    if (v4) return v4.address;
  }
  return host || "localhost";
}
