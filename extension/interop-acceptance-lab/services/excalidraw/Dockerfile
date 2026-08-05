FROM node:22.18.0-bookworm-slim
WORKDIR /app
COPY services/excalidraw/proxy.mjs /app/proxy.mjs
COPY .runtime/vendor/excalidraw/dist /app/official/dist
COPY .runtime/vendor/excalidraw/package.json /app/official/package.json
COPY .runtime/vendor/excalidraw/openchamber-provenance.json /app/official/openchamber-provenance.json
RUN node -e "const fs=require('node:fs');const c=require('node:crypto');const p=JSON.parse(fs.readFileSync('/app/official/openchamber-provenance.json','utf8'));const d=x=>c.createHash('sha256').update(fs.readFileSync(x)).digest('hex');if(p.repository!=='https://github.com/excalidraw/excalidraw-mcp'||p.release!=='v0.3.2'||p.commit!=='a617657e56337bf195a27612b9d595e539e35c55'||p.sha256!=='2b494012b5fee5937f9f7b86f04a76cc4a91ec843ee3339b93e4e15e415274ff'||p.packageVersion!=='0.3.2'||p.distIndexSha256!==d('/app/official/dist/index.js')||p.appHtmlSha256!==d('/app/official/dist/mcp-app.html'))throw new Error('unverified Excalidraw artifact')"
USER node
EXPOSE 3000
CMD ["node", "/app/proxy.mjs"]
