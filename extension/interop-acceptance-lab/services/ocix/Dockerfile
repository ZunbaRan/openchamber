FROM node:22.18.0-bookworm-slim
WORKDIR /app
COPY services/ocix/server.mjs /app/server.mjs
COPY services/ocix/release-state.mjs /app/release-state.mjs
COPY services/ocix/release-admin.mjs /app/release-admin.mjs
COPY services/ocix/entrypoint.sh /app/entrypoint.sh
COPY .runtime/generated/hosted-ops /app/hosted-ops
RUN chmod 0555 /app/entrypoint.sh /app/release-admin.mjs
EXPOSE 3000
ENTRYPOINT ["/app/entrypoint.sh"]
