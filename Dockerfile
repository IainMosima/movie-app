# ─── Stage 1: install all deps (needs build toolchain for native modules) ────
FROM node:22-bookworm-slim AS deps

WORKDIR /app

# Build toolchain needed for WebTorrent's optional native deps (node-datachannel, etc.)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

# ─── Stage 2: build Next.js, then prune devDependencies ──────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build && \
    npm prune --omit=dev

# ─── Stage 3: minimal runtime image ──────────────────────────────────────────
FROM node:22-bookworm-slim AS runner

# ffmpeg (+ ffprobe) for transcoding; dumb-init as PID 1 for clean signal propagation
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg dumb-init && \
    rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd -r app && \
    useradd -r -g app -u 10001 -m -d /home/app app

WORKDIR /app

# Copy only what the runtime needs
COPY --from=builder --chown=app:app /app/.next          ./.next
COPY --from=builder --chown=app:app /app/public         ./public
COPY --from=builder --chown=app:app /app/node_modules   ./node_modules
COPY --from=builder --chown=app:app /app/package.json   /app/package-lock.json ./
COPY --from=builder --chown=app:app /app/next.config.ts ./
# lib/ ships the torrent worker .mjs (spawned by path, not bundled by Webpack)
COPY --from=builder --chown=app:app /app/lib            ./lib

# Pre-create /app/data so the non-root user owns it before the volume mounts
RUN mkdir -p /app/data && chown -R app:app /app/data

USER app

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=8181

# Documentation only — host networking ignores EXPOSE, but keeps intent visible
EXPOSE 8181 9191

VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8181').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "start"]
