#!/bin/sh
# make clear — delete everything Spaceflix has downloaded (all movies and
# episodes, the downloads list, transcode leftovers). Keeps the library,
# folders and watch history. Stops the app first; asks before deleting.

set -eu
cd "$(dirname "$0")/.."

# Same data folder the app uses: the Settings picker's pointer, else ./data.
data=./data
[ -s .active-data-dir ] && data=$(cat .active-data-dir)
[ -s "$HOME/.spaceflix/data-dir" ] && data=$(cat "$HOME/.spaceflix/data-dir")
cache="$data/cache"

if [ ! -d "$cache" ] || [ -z "$(ls -A "$cache" 2>/dev/null)" ]; then
  echo "Nothing downloaded — $cache is already empty."
  exit 0
fi

size=$(du -sh "$cache" 2>/dev/null | cut -f1)
echo "This deletes everything downloaded: $size in $cache"
echo "Your library, folders and watch history stay."
printf "Type yes to delete: "
read -r answer
[ "$answer" = "yes" ] || { echo "Cancelled — nothing deleted."; exit 0; }

make --no-print-directory stop >/dev/null 2>&1 || true

# Contents only: the folder itself (and any Docker mount of it) stays.
find "$cache" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
rm -f "$data/downloads.json"
echo "Deleted $size. Start again with: make run (or make c-run)"
