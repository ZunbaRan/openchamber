FROM node:22.18.0-bookworm-slim
WORKDIR /app
COPY .runtime/images/legacy-mcp/server.mjs /app/server.mjs
COPY .runtime/images/legacy-mcp/instructions.md /app/instructions.md
USER node
EXPOSE 3000
CMD ["node", "/app/server.mjs"]

