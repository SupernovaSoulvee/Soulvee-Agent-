FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir -p /app/data && chown node:node /app/data
# .dockerignore keeps .env (your API keys) out of the image; pass them at run time instead.
COPY --chown=node:node . .
ENV PORT=8787
EXPOSE 8787
# The webhook posting queue lives in /app/data: mount a volume there to keep it across restarts.
VOLUME ["/app/data"]
USER node
CMD ["node", "server.js"]
