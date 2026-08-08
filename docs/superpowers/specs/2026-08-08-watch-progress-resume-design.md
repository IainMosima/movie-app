# Watch progress & resume — design

**Date:** 2026-08-08
**Status:** design approved, not yet implemented

## Context

Closing the app loses your place. There is no record of what you were watching or how
far in you were, so an accidental tab close, a TV power-off, or just walking away means
scrubbing back through a film to find your spot. The only thing resembling state today
is `localStorage.lastShow` (`app/page.tsx:167`), which stores the last magnet purely so
returning to the home page re-opens the file picker — it holds no position and is
per-device.

**Goal:** a durable record of what is being watched and where, so playback can be picked
up exactly where it stopped, from any device on the LAN.

### Decisions taken during brainstorming

1. **Server-side record.** `watch-progress.json` in the app data directory, beside
   `library.json`. One shared truth: start on the laptop, the TV and phone already know
   the position. Survives clearing browser data and moves with the data-directory
   switcher.
2. **Resume automatically.** Playback jumps straight to the saved position with a
   "Start from beginning" chip that fades after 8 seconds. Fewest presses on a TV remote.
3. **Finished at ~92%.** Finished titles leave Continue Watching, and the existing exit
   prompt then leads with the storage reclaim, since finishing is exactly when those
   bytes stop being useful. Nothing is ever deleted without a tap.

## Data model

Progress is keyed by **`infoHash` + `fileIndex`**, not by library item id. That key works
for Quick Play titles that were never saved to the library, survives renaming or
re-adding a library entry, and — importantly given the folders work — keeps a **separate
position per episode inside a season pack**.

```ts
export interface WatchRecord {
  infoHash: string;
  fileIndex: number;
  title: string;
  magnet: string;          // needed to re-add the torrent when resuming later
  libraryItemId?: string;  // when it maps to a saved item
  positionSec: number;
  durationSec: number;
  finished: boolean;
  updatedAt: number;
}

export interface WatchProgressData {
  records: WatchRecord[];
}
```

**Resolving the magnet.** The watch page only knows `infoHash` — the magnet is resolved
server-side on write: first from a library item whose stored `infoHash` matches (items
already persist this, added in `943e095`), otherwise synthesised as
`magnet:?xt=urn:btih:<hash>`. The synthesised form is sufficient because the worker
attaches `PUBLIC_TRACKERS` to every add (`lib/torrent-worker.mjs`).

**Noise floor.** Nothing is recorded below 30 seconds in, so a five-second peek never
clutters Continue Watching. A record is `finished` when position/duration ≥ 0.92 or
fewer than 90 seconds remain.

## Components

### `lib/watch-store.ts` (new)

Server-only store following the existing `lib/library-store.ts` shape exactly:
`getWatchProgressPath()` built from `getDataDir()`, a `getWatchProgress()` that tolerates
a missing file, and `saveWatchProgress()`. Exposes `upsertRecord()`, `getRecord(infoHash,
fileIndex)`, `listUnfinished()` (sorted by `updatedAt` desc), and `deleteRecord()`.
Records are capped at the 50 most recent so the file cannot grow without bound.

### API routes

- `GET /api/progress` → unfinished records, newest first. Feeds Continue Watching.
- `POST /api/progress` `{ infoHash, fileIndex, positionSec, durationSec, title }` →
  resolves the magnet and library item, computes `finished`, upserts. Must tolerate
  `sendBeacon`'s `text/plain` content type.
- `GET /api/progress/[infoHash]?file=N` → the single record, for resume on load.
- `DELETE /api/progress/[infoHash]?file=N` → forget one title.

### `components/video-player.tsx`

Two new optional props, no behavioural change when they are absent:

- `resumeFrom?: number` — seeds the **existing** `pendingResumeTimeRef` (`:84`) when the
  source loads. The seek listeners already attached to `loadedmetadata` / `canplay` /
  `loadeddata` (`:387`) then do the work. This is the mechanism already used for
  stream-recovery re-seeks, so it inherits the MKV `Infinity`/`NaN` duration handling
  rather than duplicating it.
- `onProgress?: (positionSec: number, durationSec: number) => void` — called from the
  existing `timeupdate` handler (`:357`), throttled to once every 10 seconds.

Plus the resumed chip: shown when `resumeFrom > 0`, fading after 8 s, with a
"Start from beginning" button that sets `video.currentTime = 0`.

### `app/watch/[infoHash]/page.tsx`

- On mount, fetch the record and pass `positionSec` to the player as `resumeFrom`.
- Persist on the `onProgress` callback (10 s cadence — a hard close loses at most ten
  seconds), and flush on exit.
- **Flush on `visibilitychange` → hidden as well as `beforeunload`.** The page currently
  only listens for `beforeunload` (`:131`), which mobile Safari does not fire reliably —
  precisely the "accidentally closed it on my phone" case. Reuse the `navigator.sendBeacon`
  pattern already used for session cleanup.
- The exit prompt added in `943e095` becomes finished-aware: when the record is finished
  it leads with "Finished — this is holding X GB" and makes clearing the obvious action,
  otherwise it keeps today's neutral wording.

### `components/continue-watching.tsx` (new) + `hooks/use-watch-progress.ts` (new)

A row at the top of the home page, above Storage, rendering up to 6 unfinished records:
title, a progress bar, "34:07 — 58 min left", and an ✕ to forget it. Horizontally
scrollable on mobile using the same pattern as the category chips in
`components/library-toolbar.tsx`. Hidden entirely when there is nothing in progress.

Tapping an entry **must re-add the torrent before navigating** — the watch page waits on
`/api/torrents` and will hang on "Finding peers…" for a torrent the worker no longer
holds. It therefore routes through the home page's existing `handlePlayMagnet`, the same
path the library Play button uses, which is why the magnet is stored on the record.

`localStorage.lastShow` stays as-is; it serves a different job (re-opening the episode
picker on back-navigation) and is not worth disturbing here.

## Error handling

Progress is best-effort and must never interrupt playback: every write is fire-and-forget
with failures swallowed, and a missing or unreadable `watch-progress.json` yields an
empty list rather than an error. A record whose `durationSec` is 0 (MKV duration not yet
probed) stores the position anyway and computes `finished` only once a real duration
arrives.

## Verification

1. Play a title past 30 s, note the position, **kill the browser tab outright**. Reopen
   the home page: it appears under Continue Watching. Tap it — playback resumes within
   10 seconds of where it was cut off.
2. **Cross-device**, the point of storing this server-side: start on the laptop, open the
   same title on the phone, confirm it resumes at the laptop's position.
3. **Per-episode**, using the local 3-episode pack from the season-pack verification:
   watch part of E01, switch to E02, confirm each keeps its own independent position.
4. **Quick Play** a magnet that is not in the library, confirm it is tracked and
   resumable, and that its Continue Watching entry successfully re-adds the torrent after
   the worker has dropped it.
5. Watch past 92%: the entry leaves Continue Watching and the exit prompt switches to the
   finished wording with the correct byte figure.
6. Phone check: background the tab mid-playback (do not close it), reopen, confirm the
   position was flushed — this is the `visibilitychange` path that `beforeunload` misses.
7. Zero-config regression: with no `watch-progress.json` present, the home page renders
   without a Continue Watching row and playback behaves exactly as it does today.

## Out of scope

Auto-advance to the next episode ("Up next"), per-profile history, and syncing progress
to anything outside this machine.
