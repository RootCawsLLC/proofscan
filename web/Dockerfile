# syntax=docker/dockerfile:1
#
# Build context is the proofscan repo ROOT (so both the tool at / and the web
# app at /web are available). Referenced from CodeBuild as:
#   docker build -f web/Dockerfile -t <repo>:<tag> .

# ---- build: compile the tool, then the web app ----
FROM public.ecr.aws/docker/library/node:26-bookworm-slim AS build
WORKDIR /repo
# python3/make/g++ so the demo sandbox's native deps (better-sqlite3) can build
# from source if no prebuilt binary matches the runtime's Node ABI.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*

# The tool first — its built dist/ and rules/ are what the web app runs.
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY rules ./rules
RUN npm run build

# The web app. Install with the tool already present so the file:.. dependency
# resolves, then build.
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY web ./web
RUN cd web && npm run build

# ---- runner: run `next start` with the full tree in place ----
FROM public.ecr.aws/docker/library/node:26-bookworm-slim AS runner
WORKDIR /repo
ENV NODE_ENV=production
ENV PORT=3200
ENV SANDBOX_TARGETS_DIR=/repo/web/sandbox-targets
# npm + a toolchain are needed at RUNTIME: each scan boots a throwaway sandbox
# that runs `npm install` for the target's dependencies.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*

# Bring the whole built tree (tool dist + node_modules, web .next + node_modules,
# scripts, sandbox-targets). The web/node_modules/proofscan symlink points at
# /repo, which exists at the same path here, so it resolves.
COPY --from=build /repo /repo

WORKDIR /repo/web
EXPOSE 3200
CMD ["npx", "next", "start", "-p", "3200", "-H", "0.0.0.0"]
