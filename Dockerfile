# Build the browser application once, then serve the static bundle with the
# isolation headers required by WebGPU workers and SharedArrayBuffer.
FROM node:24-bookworm-slim AS build

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV FREECUT_WEB_HOST=0.0.0.0
ENV FREECUT_WEB_PORT=8080
ENV FREECUT_RUNTIME=docker

WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node docker/deployment-api.mjs docker/web-server.mjs ./docker/

USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "docker/web-server.mjs"]
