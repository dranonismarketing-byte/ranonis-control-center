FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3080 \
    BASE_PATH=/control-centre \
    DATA_DIR=/app/data

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js hermesStatic.js ./
COPY public ./public
COPY scripts ./scripts

RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3080
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3080/control-centre/api/health || exit 1

CMD ["node", "server.js"]
