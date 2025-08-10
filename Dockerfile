# ---- Base (deps + build) ----
FROM node:20-alpine AS build
WORKDIR /app

# Skip git hooks; keep dev deps for build
ENV HUSKY=0 NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
RUN corepack enable

# Copy only manifests first for better caching
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
COPY packages/*/package.json packages/*/package.json

# Install all workspaces (root + packages) without running scripts
RUN npm ci --ignore-scripts --workspaces --include-workspace-root

# Copy sources and build (renderer first, then cli)
COPY . .
# If you keep your current root "build": "tsc --build", replace next line with: RUN npm run build
RUN npm run -w @authord/renderer build && npm run -w @authord/cli build

# Prune dev deps across workspaces (keeps runtime slim)
RUN npm prune --omit=dev --workspaces


# ---- Runtime with Chromium (Debian slim) ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    CHROME_PATH=/usr/bin/chromium

# Install Chromium + basic fonts + dumb-init
RUN set -eux; \
  apt-get update; \
  apt-get install -y --no-install-recommends \
    chromium \
    dumb-init \
    fonts-dejavu fonts-liberation; \
  rm -rf /var/lib/apt/lists/*

# Non-root
RUN addgroup --system nodegrp && adduser --system --ingroup nodegrp nodeuser
USER nodeuser

# Runtime payload: prod deps + built output
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/cli/dist ./packages/cli/dist
# Only if you actually use this file in runtime:
# COPY --from=build /app/puppeteer.config.cjs ./puppeteer.config.cjs

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "process.exit(0)"
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "packages/cli/dist/index.js"]
