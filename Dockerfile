FROM denoland/deno:debian-2.4.4 AS builder

LABEL org.opencontainers.image.title="authord-cli" \
      org.opencontainers.image.description="Authord CLI" \
      org.opencontainers.image.source="https://github.com/nivoragit/authord" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

WORKDIR /app

COPY . .

RUN deno cache --node-modules-dir=auto lib/cli.ts

RUN deno compile \
  --allow-all \
  -o /build/authord \
  lib/cli.ts

FROM node:24.6-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium chromium-sandbox \
    libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxdamage1 libxext6 \
    libxfixes3 libxrandr2 libgbm1 libgtk-3-0 libnss3 libxss1 libasound2 \
    libdrm2 libxshmfence1 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libxkbcommon0 libpango-1.0-0 libpangocairo-1.0-0 ca-certificates \
    fonts-liberation fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

RUN  npm install -g @mermaid-js/mermaid-cli

RUN printf '%s\n' '#!/usr/bin/env bash' \
    'exec /usr/bin/chromium --no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage "$@"' \
    > /usr/local/bin/chromium-no-sandbox \
 && chmod +x /usr/local/bin/chromium-no-sandbox

ENV PUPPETEER_EXECUTABLE_PATH=/usr/local/bin/chromium-no-sandbox
ENV CHROME_PATH=/usr/local/bin/chromium-no-sandbox

RUN addgroup --gid 2000 authord \
    && adduser --uid 2000 --disabled-password authord --ingroup authord \
    && mkdir /data/ \
    && chown authord:authord /data/

COPY --from=builder /build/authord /usr/local/bin/authord
RUN chown authord:authord /usr/local/bin/authord

WORKDIR /data
USER authord
ENTRYPOINT ["authord"]
CMD ["--help"]
