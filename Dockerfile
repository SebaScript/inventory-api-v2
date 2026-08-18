# Multi-stage build: the final image carries only compiled JavaScript and
# production dependencies — no compiler, no tests, no source.
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
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# Never run as root. The official image already ships an unprivileged user.
USER node
EXPOSE 3000

# Uses the same /health endpoint clients use, so a healthy container is one
# that can actually reach PostgreSQL. wget ships with Alpine's busybox.
#
# 127.0.0.1 rather than localhost: inside the container localhost resolves to
# ::1 first while Node listens on IPv4, so the check would be refused.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/main.js"]
