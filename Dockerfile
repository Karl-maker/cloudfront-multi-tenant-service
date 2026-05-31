FROM node:24-bookworm-slim

LABEL org.opencontainers.image.title="syncpoly-openclaw"
LABEL org.opencontainers.image.description="OpenClaw runtime for Syncpoly website building"

ENV NODE_ENV=production
ENV OPENCLAW_CONFIG_DIR=/home/node/.openclaw
ENV OPENCLAW_BROWSER_HEADLESS=1
ENV OPENCLAW_DISABLE_BONJOUR=1
ENV PATH=/workspace/cli/bin:$PATH
ENV NODE_PATH=/opt/syncpoly-web-builder/node_modules

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        awscli \
        ca-certificates \
        chromium \
        curl \
        ffmpeg \
        git \
        tini \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g openclaw@latest

COPY package*.json /opt/syncpoly-web-builder/
RUN cd /opt/syncpoly-web-builder \
    && npm ci --omit=dev

RUN mkdir -p /workspace \
    && chown node:node /workspace \
    && ln -s /workspace/cli/bin/syncpoly-site /usr/local/bin/syncpoly-site

COPY bin/openclaw-entrypoint.sh /usr/local/bin/syncpoly-openclaw-entrypoint
RUN chmod +x /usr/local/bin/syncpoly-openclaw-entrypoint

USER node
WORKDIR /home/node

EXPOSE 18789

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS http://127.0.0.1:18789/healthz || exit 1

ENTRYPOINT ["tini", "--", "syncpoly-openclaw-entrypoint"]
CMD ["gateway", "--bind", "lan", "--port", "18789", "--verbose"]
