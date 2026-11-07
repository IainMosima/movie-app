# Spaceflix — everyday commands.
#
# On the Mac directly:
#   make run        start; stays awake while plugged in (lid closed too)
#   make run-go     on the road: stays awake on battery with the lid closed;
#                   sleep comes back on when you stop it (Ctrl-C)
#   make build      rebuild the app
#
# In Docker (c- = container):
#   make c-run      start the container in the background
#   make c-go       container + road mode (Ctrl-C stops it, sleep back on)
#   make c-restart  restart the container
#   make c-logs     follow the container's output
#   make c-build    rebuild the image
#   make c-stop     stop the container
#
#   make stop       stop everything: the Mac app and the container
#   make clear      delete everything downloaded (asks first; keeps library)
#   make ip         the address to open on your phone or TV
#
# Works on macOS, Linux and Windows (Git Bash / WSL with make installed).

UNAME := $(shell uname -s 2>/dev/null)
ifeq ($(UNAME),Darwin)
  LAN_IP := $(shell ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
  AWAKE := caffeinate -s
else ifneq (,$(findstring Linux,$(UNAME)))
  LAN_IP := $(shell hostname -I 2>/dev/null | awk '{print $$1}')
  AWAKE :=
else
  # Windows (Git Bash / MSYS): ask PowerShell for the Wi-Fi/Ethernet IPv4.
  LAN_IP := $(shell powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $$_.PrefixOrigin -eq 'Dhcp' } | Select-Object -First 1).IPAddress" 2>/dev/null)
  AWAKE :=
endif
# WSL reports its own internal address; ask Windows for the real one.
ifneq (,$(shell grep -qi microsoft /proc/version 2>/dev/null && echo wsl))
  LAN_IP := $(shell powershell.exe -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $$_.PrefixOrigin -eq 'Dhcp' } | Select-Object -First 1).IPAddress" 2>/dev/null | tr -d '\r')
endif

# Where movies live on THIS computer. Same folder for the Mac app and Docker:
# the one picked in Settings (.active-data-dir), else ./data. Override with
# `make c-run DATA=/Volumes/Movies`. Docker mounts it, so nothing is ever
# stored inside the container.
ifeq ($(UNAME),Darwin)
  DEFAULT_DATA := $(HOME)/Movies/Spaceflix
else ifneq (,$(findstring Linux,$(UNAME)))
  DEFAULT_DATA := $(HOME)/Videos/Spaceflix
else
  # Windows: D:\Movies\Spaceflix when there's a D: drive, else ~\Videos\Spaceflix.
  DEFAULT_DATA := $(if $(wildcard /d/),/d/Movies/Spaceflix,$(HOME)/Videos/Spaceflix)
endif
# The folder picked in Settings (saved in ~/.spaceflix/data-dir, shared by the
# Mac app and Docker), else an older per-project choice, else an existing
# ./data (installs from before the per-system default), else the system's
# movie folder.
DATA ?= $(or $(shell cat $(HOME)/.spaceflix/data-dir 2>/dev/null),$(shell cat .active-data-dir 2>/dev/null),$(if $(wildcard data/library.json),./data,$(DEFAULT_DATA)))
DATA_ABS := $(abspath $(DATA))
# The container also gets your home folder, so Settings can switch folders.
COMPOSE := HOST_LAN_IP=$(LAN_IP) MEDIA_ROOT=$(DATA_ABS) HOST_DATA_DIR=$(DATA_ABS) HOST_HOME=$(HOME) docker compose

.PHONY: run run-go build stop clear ip guard docker-up c-run c-go c-restart c-logs c-build c-stop

# --- Mac -------------------------------------------------------------------

run: .next/BUILD_ID guard
	$(AWAKE) npm run start

run-go: .next/BUILD_ID guard
	@./scripts/run-go.sh

build:
	npm run build

# Build only when there's no build yet; `make build` rebuilds on demand.
.next/BUILD_ID:
	npm run build

# --- Docker ----------------------------------------------------------------

c-run: guard docker-up
	@mkdir -p "$(DATA_ABS)"
	$(COMPOSE) up -d
	@echo "Spaceflix (Docker) is starting — open http://$(LAN_IP):8181"
	@echo "Movies are stored on this computer in: $(DATA_ABS)"

c-go: guard docker-up
	@DATA="$(DATA_ABS)" ./scripts/run-go.sh docker

c-restart: docker-up
	$(COMPOSE) restart

c-logs: docker-up
	$(COMPOSE) logs -f --tail 50

c-build: docker-up
	$(COMPOSE) build

c-stop:
	-@docker info >/dev/null 2>&1 && $(COMPOSE) stop || true

docker-up:
	@docker info >/dev/null 2>&1 || { \
		echo "Starting Docker Desktop…"; open -a Docker 2>/dev/null || true; \
		for i in $$(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 2; done; \
		docker info >/dev/null 2>&1 || { echo "Docker didn't start."; exit 1; }; }

# --- Both ------------------------------------------------------------------

stop: c-stop
	-@pkill -f "next start -H 0.0.0.0 -p 8181" ; pkill -f next-server ; pkill -f torrent-worker.mjs ; true
	@sleep 2
	-@pkill -9 -f torrent-worker.mjs ; pkill -9 -f next-server ; true
	@echo "Spaceflix stopped."

clear:
	@./scripts/clear.sh

ip:
	@echo "http://$(LAN_IP):8181"

# Two copies fight over ports 8181/9191 (Mac app vs container), so refuse.
guard:
	@if lsof -iTCP:8181 -sTCP:LISTEN >/dev/null 2>&1; then \
		echo "Spaceflix is already running (port 8181). Use 'make stop' first."; exit 1; \
	fi
