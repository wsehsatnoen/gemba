# syntax=docker/dockerfile:1
# The gemba front end: Angular static files served by nginx, which also proxies /api/ to the
# backend. Build context is frontend/ (docker build -t gemba-frontend frontend).

# Stage 1: build the app on the build machine's own architecture. The output is plain static
# files, so there's no reason to run the Angular build under ARM64 emulation in CI.
# slim (glibc) matches the CI runner, so npm ci picks the same native packages as the lockfile.
FROM --platform=$BUILDPLATFORM node:24-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# src/app/api/schema.d.ts is committed, so the build doesn't need ../api/openapi.yaml.
# BUILD_SCRIPT=build:demo makes the demo image, which answers /api/* from the mock fixtures so
# the app can be shown without a backend. The default is the real production build.
ARG BUILD_SCRIPT=build
COPY . .
RUN npm run ${BUILD_SCRIPT}

# Stage 2: the runtime image, built for the target platform (linux/arm64 for the Pi). Only COPY
# steps run here, so it needs no emulation. The unprivileged image runs as a non-root user and
# listens on 8080.
FROM nginxinc/nginx-unprivileged:1.30-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/gemba-web/browser /usr/share/nginx/html

EXPOSE 8080
