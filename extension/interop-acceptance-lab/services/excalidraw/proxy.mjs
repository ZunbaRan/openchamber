import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const UPSTREAM_PORT = Number.parseInt(process.env.UPSTREAM_PORT || "3001", 10);
const UPSTREAM_HOST = "127.0.0.1";
const provenance = JSON.parse(
  await readFile("/app/official/openchamber-provenance.json", "utf8"),
);
const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const distIndexSha256 = digest(
  await readFile("/app/official/dist/index.js"),
);
const appHtmlSha256 = digest(
  await readFile("/app/official/dist/mcp-app.html"),
);
const provenanceVerified =
  provenance.repository === "https://github.com/excalidraw/excalidraw-mcp" &&
  provenance.release === "v0.3.2" &&
  provenance.commit === "a617657e56337bf195a27612b9d595e539e35c55" &&
  provenance.asset === "excalidraw-mcp-app.mcpb" &&
  provenance.sha256 ===
    "2b494012b5fee5937f9f7b86f04a76cc4a91ec843ee3339b93e4e15e415274ff" &&
  provenance.packageVersion === "0.3.2" &&
  provenance.distIndexSha256 === distIndexSha256 &&
  provenance.appHtmlSha256 === appHtmlSha256;

let childExited = false;
let childExitCode = null;
let ready = false;

const child = spawn(process.execPath, ["/app/official/dist/index.js"], {
  cwd: "/app/official",
  env: {
    ...process.env,
    PORT: String(UPSTREAM_PORT),
  },
  stdio: ["ignore", "inherit", "inherit"],
});

child.once("exit", (code) => {
  childExited = true;
  childExitCode = code;
  ready = false;
  console.error(`Official Excalidraw MCP exited with code ${String(code)}`);
  setTimeout(() => process.exit(code || 1), 100).unref();
});

function upstreamAcceptingConnections() {
  return new Promise((resolve) => {
    const socket = net.createConnection(
      { host: UPSTREAM_HOST, port: UPSTREAM_PORT },
      () => {
        socket.destroy();
        resolve(true);
      },
    );
    socket.setTimeout(400);
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

async function waitForUpstream() {
  for (let attempt = 0; attempt < 80 && !childExited; attempt += 1) {
    if (await upstreamAcceptingConnections()) {
      ready = true;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

void waitForUpstream();

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", "http://localhost");
  if (request.method === "GET" && url.pathname === "/health") {
    const healthy = ready && !childExited && provenanceVerified;
    sendJson(response, healthy ? 200 : 503, {
      status: healthy ? "ok" : ready ? "error" : "starting",
      service: "official-excalidraw-mcp-wrapper",
      upstream: {
        project: provenance.repository,
        release: provenance.release,
        commit: provenance.commit,
        asset: provenance.asset,
        assetSha256: provenance.sha256,
        packageVersion: provenance.packageVersion,
        distIndexSha256,
        appHtmlSha256,
        provenanceVerified,
        ready,
        exited: childExited,
        exitCode: childExitCode,
      },
    });
    return;
  }
  if (url.pathname !== "/mcp") {
    sendJson(response, 404, { error: "not_found" });
    return;
  }
  if (!ready || childExited || !provenanceVerified) {
    sendJson(response, 503, { error: "official_excalidraw_mcp_not_ready" });
    return;
  }

  const headers = { ...request.headers, host: `${UPSTREAM_HOST}:${UPSTREAM_PORT}` };
  const upstream = http.request(
    {
      host: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: `/mcp${url.search}`,
      method: request.method,
      headers,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );
  upstream.setTimeout(60_000, () => upstream.destroy(new Error("upstream_timeout")));
  upstream.once("error", () => {
    if (!response.headersSent) {
      sendJson(response, 502, { error: "official_excalidraw_mcp_unavailable" });
    } else {
      response.destroy();
    }
  });
  request.pipe(upstream);
});

server.listen(PORT, "0.0.0.0", () => {
  console.error(`Excalidraw wrapper listening on 0.0.0.0:${PORT}`);
});

function shutdown(signal) {
  ready = false;
  child.kill(signal);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
