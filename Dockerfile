# syntax=docker/dockerfile:1
FROM node:20-alpine

WORKDIR /app

# Copy manifests. Layer cache key includes their content — when
# package.json or package-lock.json change, the npm install layer rebuilds.
COPY package.json package-lock.json* ./

# `npm ci` is stricter than `npm install`: it requires a lockfile and
# installs exactly what's listed, failing the build if package.json and
# package-lock.json disagree. This catches "I added a dep but didn't
# regenerate the lockfile" mistakes at build time instead of at runtime
# with a confusing MODULE_NOT_FOUND.
RUN npm ci --omit=dev --no-audit --no-fund

# Print the installed top-level deps so the build log proves what's in
# the image. If helmet is missing here, the build is wrong — check the
# build log in Container Manager (Project → tsoypos → Build → Log tab).
RUN echo "=== installed top-level deps ===" \
 && npm ls --depth=0 --omit=dev || true

# App source.
COPY server.js ./
COPY public ./public

# Persist site data outside the image.
VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

RUN mkdir -p /app/data

# Runs as root inside the container so bind-mounted volumes on Synology /
# other NAS setups don't need manual UID alignment.
CMD ["node", "server.js"]
