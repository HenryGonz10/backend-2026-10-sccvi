FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
EXPOSE 8200
HEALTHCHECK --interval=20s --timeout=5s --start-period=45s --retries=3 CMD wget -qO- http://127.0.0.1:8200/api/v1/health >/dev/null || exit 1
CMD ["sh","-lc","npm run db:init && npm run migration:run && node dist/main.js"]
