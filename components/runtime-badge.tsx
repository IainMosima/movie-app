"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Container, Laptop } from "lucide-react";

/** Top bar: how the app is running right now; tap for the commands. */
export function RuntimeBadge() {
  const [docker, setDocker] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/data-dir")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setDocker(Boolean(d.docker)))
      .catch(() => {});
  }, []);

  if (docker === null) return null;
  const Icon = docker ? Container : Laptop;
  const label = docker ? "Docker" : "On this Mac";

  return (
    <Link
      href="/settings#runtime"
      className="h-10 flex items-center gap-2 rounded-full px-3 text-xs text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
      aria-label={`Running ${docker ? "in Docker" : "on this Mac"} — see how to manage it`}
      title="How it's running"
    >
      <Icon className="h-4 w-4" />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}
