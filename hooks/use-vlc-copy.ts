"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { vlcLink } from "@/lib/vlc-link";

// Shared by every component: the LAN origin is fetched once per page load.
// A link built on localhost would be useless on a phone, so we swap in the
// Mac's Wi-Fi address as soon as /api/lan answers.
let lanOrigin: string | null = null;
let lanRequest: Promise<void> | null = null;

function loadLanOrigin() {
  lanRequest ??= fetch("/api/lan")
    .then((r) => r.json())
    .then((d: { origin?: string }) => {
      if (d.origin) lanOrigin = d.origin;
    })
    .catch(() => {
      lanRequest = null; // retry on next mount
    });
}

const OK = "VLC link copied — paste it in VLC → Open Network Stream";

// iOS/Android over plain http have no navigator.clipboard; execCommand("copy")
// works only on a focused, selected, editable field inside the tap gesture.
function copyViaTextarea(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  // 16px: smaller text makes iOS zoom the page on focus.
  ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px;";
  ta.readOnly = false;
  ta.contentEditable = "true";
  // Radix dialogs and dropdown menus trap focus: a field outside them is
  // un-focused instantly, so put it inside the topmost open one.
  const dialogs = document.querySelectorAll("[role=dialog],[role=menu]");
  (dialogs[dialogs.length - 1] ?? document.body).appendChild(ta);
  let ok = false;
  try {
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

function failed(link: string) {
  toast("Long-press to copy", { description: link, duration: 15000 });
}

/** Copy a VLC link. Must be called synchronously from the tap handler — no await before it. */
export function copyVlcLink(infoHash: string, fileIndex?: number, title?: string): void {
  const link = vlcLink(lanOrigin ?? window.location.origin, infoHash, fileIndex, title);
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(link).then(
      () => toast.success(OK),
      () => failed(link) // gesture already spent; show the link instead
    );
    return;
  }
  if (copyViaTextarea(link)) toast.success(OK);
  else failed(link);
}

export function useVlcCopy() {
  useEffect(loadLanOrigin, []);
  return copyVlcLink;
}

/** Copy any text from a tap handler (same phone-safe path as VLC links). */
export function copyText(text: string, okMessage: string): void {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => toast.success(okMessage),
      () => failed(text)
    );
    return;
  }
  if (copyViaTextarea(text)) toast.success(okMessage);
  else failed(text);
}

/** The app's Wi-Fi address (e.g. http://192.168.8.4:8181), or null until known. */
export function useLanOrigin(): string | null {
  const [origin, setOrigin] = useState<string | null>(lanOrigin);
  useEffect(() => {
    loadLanOrigin();
    let alive = true;
    lanRequest?.then(() => alive && setOrigin(lanOrigin));
    return () => {
      alive = false;
    };
  }, []);
  return origin;
}
