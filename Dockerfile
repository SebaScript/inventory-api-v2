FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

# The commit this image was built from. /health reports it, so a deployment can
# be verified rather than assumed: the pipeline checks that the running service
# reports the revision it just published.
ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3000}/health || exit 1

CMD ["node", "dist/main.js"]
