"use client";

import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { copyText } from "@/hooks/use-vlc-copy";
import type { DataDirReport } from "@/types";

const COMMANDS = {
  docker: [
    ["make c-restart", "Restart the container"],
    ["make c-logs", "See what it's doing"],
    ["make c-stop", "Stop it"],
    ["make run", "Run on the Mac instead (after c-stop)"],
  ],
  mac: [
    ["make stop", "Stop it"],
    ["make run", "Start (stays awake while plugged in)"],
    ["make run-go", "Start for the road (lid closed, on battery)"],
    ["make c-run", "Run in Docker instead (after stop)"],
  ],
} as const;

/** Settings: how the app is running right now, and the commands that manage it. */
export function RuntimeCard() {
  const [report, setReport] = useState<DataDirReport | null>(null);

  useEffect(() => {
    fetch("/api/data-dir")
      .then((r) => (r.ok ? r.json() : null))
      .then(setReport)
      .catch(() => {});
  }, []);

  if (!report) return null;
  const mode = report.docker ? "docker" : "mac";

  return (
    <Card id="runtime" className="scroll-mt-20 p-6 bg-zinc-900/50 border-zinc-800">
      <h2 className="font-semibold">How it&apos;s running</h2>
      <p className="mt-1 text-sm text-zinc-400">
        {report.docker ? "In a Docker container" : "Directly on this computer"} · movies in{" "}
        <span className="font-mono text-zinc-300 break-all">{report.hostDir}</span>
      </p>
      <p className="mt-1 text-xs text-zinc-600">
        Run these in the project folder. Both ways use the same movies folder.
      </p>

      <ul className="mt-4 divide-y divide-zinc-800/80">
        {COMMANDS[mode].map(([cmd, what]) => (
          <li key={cmd} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <code className="text-sm text-zinc-100">{cmd}</code>
              <p className="text-xs text-zinc-500">{what}</p>
            </div>
            <button
              onClick={() => copyText(cmd, `Copied ${cmd}`)}
              className="h-10 w-10 shrink-0 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
              aria-label={`Copy ${cmd}`}
              title="Copy"
            >
              <Copy className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
