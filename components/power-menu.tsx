"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Power, RotateCcw, X } from "lucide-react";

type Action = "restart" | "stop";
type Phase = "idle" | "working" | "back" | "stopped" | "slow";


/** ⏻ in the top bar: a phone-style power menu — turn the app off or restart it. */
export function PowerMenu() {
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [action, setAction] = useState<Action | null>(null);
  // In Docker the container brings the app straight back, so only Restart is offered.
  const [canTurnOff, setCanTurnOff] = useState(true);

  useEffect(() => {
    if (confirm === null) return;
    fetch("/api/system")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCanTurnOff(d.canTurnOff !== false))
      .catch(() => {});
  }, [confirm]);

  const run = async (a: Action) => {
    setConfirm(null);
    setAction(a);
    setPhase("working");
    try {
      await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: a }),
      });
    } catch {
      // the server may already be going down — that's the point
    }
    if (a === "stop") setPhase("stopped");
  };

  // After a restart, wait for the new server (and its torrent engine), then reload.
  useEffect(() => {
    if (phase !== "working" || action !== "restart") return;
    let cancelled = false;
    const started = Date.now();
    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await fetch("/api/worker-port", { cache: "no-store" });
        if (res.ok && Date.now() - started > 5000) {
          setPhase("back");
          setTimeout(() => location.reload(), 600);
          return;
        }
      } catch {
        // still down
      }
      if (Date.now() - started > 90_000) setPhase("slow");
      else setTimeout(poll, 1500);
    };
    const t = setTimeout(poll, 3000);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [phase, action]);

  return (
    <>
      <button
        onClick={() => setConfirm("restart")}
        className="h-10 w-10 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
        aria-label="Power: turn off or restart the app"
        title="Turn off or restart"
      >
        <Power className="h-4 w-4" />
      </button>

      {/* Like a phone's power menu: two big choices, tap one, or cancel.
          Portaled: the nav's backdrop-blur would trap a fixed overlay inside it. */}
      {confirm !== null && phase === "idle" && createPortal(
        <div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-10 bg-black/85 backdrop-blur-sm px-6"
          role="dialog"
          aria-modal="true"
          aria-label="Power options"
          onClick={() => setConfirm(null)}
          onKeyDown={(e) => e.key === "Escape" && setConfirm(null)}
        >
          <div className="flex gap-10 sm:gap-16" onClick={(e) => e.stopPropagation()}>
            {(canTurnOff ? (["stop", "restart"] as const) : (["restart"] as const)).map((a) => (
              <button
                key={a}
                onClick={() => run(a)}
                aria-label={a === "stop" ? "Turn off" : "Restart"}
                title={a === "stop" ? "Turn off" : "Restart"}
                className="group rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-4 focus-visible:ring-offset-black"
              >
                <span
                  className={`h-20 w-20 sm:h-24 sm:w-24 rounded-full flex items-center justify-center transition-transform group-active:scale-95 motion-reduce:transition-none ${
                    a === "stop" ? "bg-red-600 group-hover:bg-red-500" : "bg-zinc-100 group-hover:bg-white"
                  }`}
                >
                  {a === "stop" ? (
                    <Power className="h-9 w-9 text-white" />
                  ) : (
                    <RotateCcw className="h-9 w-9 text-zinc-900" />
                  )}
                </span>
              </button>
            ))}
          </div>
          <button
            onClick={() => setConfirm(null)}
            aria-label="Cancel"
            title="Cancel"
            className="h-12 w-12 rounded-full flex items-center justify-center text-zinc-400 bg-zinc-800/80 hover:bg-zinc-700 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>,
        document.body
      )}

      {phase !== "idle" && createPortal(
        <div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-black/90 px-6 text-center"
          role="status"
          aria-live="polite"
        >
          {phase === "working" && (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-zinc-300 motion-reduce:animate-none" aria-hidden />
              <span className="sr-only">{action === "restart" ? "Restarting" : "Turning off"}</span>
            </>
          )}
          {phase === "back" && <span className="sr-only">Back — reloading</span>}
          {phase === "stopped" && (
            <>
              <Power className="h-10 w-10 text-zinc-500" />
              <p className="text-lg text-zinc-100">Spaceflix is off</p>
            </>
          )}
          {phase === "slow" && (
            <>
              <p className="text-lg text-amber-300">Taking longer than usual</p>
              <button
                onClick={() => location.reload()}
                className="h-10 rounded-lg px-4 text-sm text-zinc-200 bg-zinc-800 hover:bg-zinc-700"
              >
                Reload
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
