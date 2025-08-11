# ---------- Builder ----------
FROM node:20-bookworm-slim AS builder
ENV NODE_ENV=development \
    HUSKY=0 \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    npm_config_ignore_scripts=true

WORKDIR /app

# Tools some packages need at install time
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

# Copy only manifests first for better caching
COPY package.json package-lock.json* ./
COPY packages/cli/package.json       packages/cli/
COPY packages/renderer/package.json  packages/renderer/

# Install deps for all workspaces (no lifecycle scripts)
RUN npm ci --workspaces

# Bring in the rest of the source and build
COPY . .
RUN npm run build


# ---------- Runtime ----------
FROM node:20-bookworm-slim AS runner
ENV NODE_ENV=production \
    HUSKY=0 \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    # Tell Puppeteer / mermaid-cli to use system Chromium
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    # Safety: never run lifecycle scripts in runtime stage
    npm_config_ignore_scripts=true \
    npm_config_loglevel=warn \
    npm_config_update_notifier=false \
    npm_config_fund=false

WORKDIR /app

# Headless Chrome + fonts required by Puppeteer/Mermaid
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      libx11-6 libx11-xcb1 libxcomposite1 libxcursor1 libxdamage1 libxi6 \
      libxtst6 libnss3 libxss1 libglib2.0-0 libgdk-pixbuf-2.0-0 libgtk-3-0 \
      libdbus-1-3 libdrm2 libgbm1 libxcb1 libasound2 libatk1.0-0 \
      libatk-bridge2.0-0 libpango-1.0-0 libcairo2 \
      fonts-noto fonts-noto-color-emoji fonts-liberation \
 && rm -rf /var/lib/apt/lists/*

# Copy manifests (needed for prune) and built artifacts + node_modules
COPY package.json package-lock.json* ./
COPY packages/cli/package.json       packages/cli/
COPY packages/renderer/package.json  packages/renderer/
COPY --from=builder /app/packages    /app/packages
COPY --from=builder /app/node_modules /app/node_modules

# Prune dev dependencies in-place (no scripts executed)
RUN npm prune --omit=dev && npm cache clean --force

# If you render PlantUML at RUNTIME inside the container, uncomment this:
# RUN apt-get update && apt-get install -y --no-install-recommends openjdk-17-jre-headless && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN chown -R node:node /app
USER node

# Adjust if your CLI entry differs
CMD ["node", "packages/cli/dist/index.js", "--help"]
