#!/bin/sh
# On the road: keep the Mac awake on battery with the lid closed while
# Spaceflix runs, then put normal sleep back however it ends (Ctrl-C, Turn off
# in the app, or a crash).
#
#   scripts/run-go.sh          the app directly on the Mac  (make run-go)
#   scripts/run-go.sh docker   the Docker container         (make c-go)
#
# Uses `pmset disablesleep`, which needs your Mac password once (sudo).
# While it's on, the Mac won't sleep at all — keep it out of a closed bag.

set -u
mode=${1:-mac}
ip=$(ipconfig getifaddr en0 || ipconfig getifaddr en1)

restore() {
  if [ "$mode" = docker ]; then
    HOST_LAN_IP=$ip docker compose stop >/dev/null 2>&1 && echo "Container stopped."
  fi
  sudo pmset -a disablesleep 0 && echo "Sleep is back on."
}

echo "Turning sleep off so Spaceflix keeps running with the lid closed…"
sudo pmset -a disablesleep 1 || { echo "Couldn't change sleep settings."; exit 1; }
trap restore EXIT
trap 'exit 0' INT TERM

[ -n "$ip" ] && echo "Open on your phone: http://$ip:8181"

if [ "$mode" = docker ]; then
  mkdir -p "${DATA:-./data}"
  HOST_LAN_IP=$ip MEDIA_ROOT="${DATA:-./data}" HOST_DATA_DIR="${DATA:-./data}" HOST_HOME="$HOME" docker compose up -d || exit 1
  echo "Movies are stored on this computer in: ${DATA:-./data}"
  echo "Running in Docker. Ctrl-C to stop it and turn sleep back on."
  caffeinate -s docker compose logs -f --tail 20
else
  # Not `exec`: the trap must run after the app stops.
  caffeinate -s npm run start
  # "Restart" in the app ends this copy and starts a detached one; stay in
  # road mode until the app is really off, so the lid can't sleep it mid-trip.
  sleep 10
  while lsof -iTCP:8181 -sTCP:LISTEN >/dev/null 2>&1; do sleep 5; done
fi
