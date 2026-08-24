"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A scrolling list with big up/down buttons beside it.
 *
 * A TV remote has no cursor and cannot drag a scrollbar, so a long folder or
 * episode list is unreachable past the first screenful without something to
 * press. These are real buttons, so a D-pad can focus them like anything else.
 *
 * Hidden below `sm`, where they would eat a third of the width and swiping
 * already works.
 */
export function ScrollPager({
  children,
  className,
  /** Pixels per press. A bit under a screenful keeps a row visible across it. */
  step = 250,
}: {
  children: React.ReactNode;
  className?: string;
  step?: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canUp, setCanUp] = useState(false);
  const [canDown, setCanDown] = useState(false);

  const sync = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanUp(el.scrollTop > 0);
    // Slack, or fractional heights leave the down button live at the bottom.
    setCanDown(el.scrollTop < el.scrollHeight - el.clientHeight - 5);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    sync();
    el.addEventListener("scroll", sync, { passive: true });

    // Rows arrive asynchronously — cache sizes land after the first paint — so
    // a list can become scrollable well after mount.
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);

    return () => {
      el.removeEventListener("scroll", sync);
      observer.disconnect();
    };
  }, [sync, children]);

  const scrollBy = (amount: number) => {
    scrollRef.current?.scrollBy({ top: amount, behavior: "smooth" });
  };

  const button = (direction: 1 | -1, enabled: boolean) => {
    const Icon = direction === -1 ? ChevronUp : ChevronDown;
    return (
      <button
        type="button"
        onClick={() => scrollBy(direction * step)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            scrollBy(direction * step);
          }
        }}
        disabled={!enabled}
        aria-label={direction === -1 ? "Scroll up" : "Scroll down"}
        className={cn(
          "h-14 w-14 rounded-xl flex items-center justify-center transition-all",
          "focus:outline-none focus:ring-2 focus:ring-purple-500",
          enabled
            ? "bg-zinc-800 hover:bg-purple-600 active:bg-purple-700 text-white cursor-pointer"
            : "bg-zinc-800/50 text-zinc-600 cursor-not-allowed"
        )}
      >
        <Icon className="h-7 w-7" />
      </button>
    );
  };

  return (
    <div className="flex-1 flex gap-2 min-h-0">
      <div className="hidden sm:flex flex-col justify-center gap-3 py-4">
        {button(-1, canUp)}
        {button(1, canDown)}
      </div>
      <div ref={scrollRef} className={cn("flex-1 overflow-y-auto", className)}>
        {children}
      </div>
    </div>
  );
}
