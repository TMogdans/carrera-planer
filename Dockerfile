# syntax=docker/dockerfile:1
# Carrera-Planer als Container (Spec M4, .specify/specs/m4-deploy/spec.md).
#
# Mehrstufig (REQ-IMG-1): `build` installiert alles und baut Frontend (dist/) und Server
# (dist-server/), `deps` installiert nur Laufzeit-Abhängigkeiten, die Laufzeit-Stufe übernimmt
# genau dist/, dist-server/, node_modules/ und package.json. Basis node:22-bookworm-slim, per Digest
# gepinnt (Empfehlung 1); gebaut wird nativ auf arm64 (Empfehlung 2), ohne $BUILDPLATFORM.
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb

# pnpm in der Version aus package.json ("packageManager")
FROM ${NODE_IMAGE} AS pnpm
RUN npm install --global --no-fund --no-audit pnpm@12.21.0
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM pnpm AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm build:server

FROM pnpm AS deps
RUN pnpm install --frozen-lockfile --prod

FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    CARRERA_DB=/data/carrera-planer.sqlite \
    CARRERA_STATIC=/app/dist \
    CARRERA_PORT=8080
# /data gehört UID 1000; beim Bind-Mount bestimmt das Host-Verzeichnis (docs/raspi-deploy.md)
RUN mkdir /data && chown 1000:1000 /data
WORKDIR /app
COPY --from=deps /src/node_modules ./node_modules
COPY --from=build /src/dist ./dist
COPY --from=build /src/dist-server ./dist-server
COPY package.json ./
# UID 1000 ist im Basis-Image der Benutzer "node" (REQ-IMG-3)
USER 1000:1000
EXPOSE 8080
# REQ-IMG-5: über 127.0.0.1 (der Server lauscht bei 0.0.0.0 nur auf IPv4), mit dem Node des Images
HEALTHCHECK --start-period=30s --start-interval=2s --interval=60s --timeout=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.CARRERA_PORT || '8080') + '/api/status').then((r) => process.exit(r.status === 200 ? 0 : 1), () => process.exit(1))"]
# Node selbst als PID 1, ohne pnpm und ohne Shell: SIGTERM kommt direkt beim Server an (REQ-IMG-3)
CMD ["node", "dist-server/server/main.js"]
