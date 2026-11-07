FROM node:22-alpine
WORKDIR /app
# .dockerignore keeps .env (your API key) out of the image; pass it at run time instead.
COPY --chown=node:node . .
ENV PORT=8787
EXPOSE 8787
USER node
CMD ["node", "server.js"]
