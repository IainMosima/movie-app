import type { NextRequest } from "next/server";
import { networkInterfaces } from "os";

/** An address other devices on the Wi-Fi can reach — never "localhost". */
export function lanHost(req: NextRequest): string {
  const host = (req.headers.get("host") ?? "").split(":")[0];
  if (host && !/^(localhost|127\.|\[?::1)/.test(host)) return host;
  // In Docker the container only sees its own private address; the Makefile
  // passes the Mac's Wi-Fi IP in.
  if (process.env.HOST_LAN_IP) return process.env.HOST_LAN_IP;
  for (const addrs of Object.values(networkInterfaces())) {
    const v4 = addrs?.find((a) => a.family === "IPv4" && !a.internal);
    if (v4) return v4.address;
  }
  return host || "localhost";
}
