FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.55.0-noble

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY config ./config
COPY brands ./brands

RUN mkdir -p /jobs && chown -R pwuser:pwuser /app /jobs
USER pwuser

# Cloud Run Jobs overrides args with the manifest inside its mounted job volume.
ENTRYPOINT ["node", "dist/src/cli.js"]
CMD ["/jobs/manifest.json"]
