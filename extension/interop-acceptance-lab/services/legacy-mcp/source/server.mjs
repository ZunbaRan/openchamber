import express from "express";
import { randomUUID } from "node:crypto";
import { createServer } from "@modelcontextprotocol/server-everything/dist/everything.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js";

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const TRANSPORT_MODE = process.env.TRANSPORT_MODE || "all";
const SSE_PUBLIC_ENDPOINT =
  process.env.SSE_PUBLIC_ENDPOINT || "/mcp/legacy/message";
if (!["all", "http", "sse"].includes(TRANSPORT_MODE)) {
  throw new Error(`Unsupported TRANSPORT_MODE ${TRANSPORT_MODE}`);
}
const app = express();
const sseTransports = new Map();
const httpTransports = new Map();

app.disable("x-powered-by");

app.use((request, response, next) => {
  if (
    TRANSPORT_MODE === "http" &&
    (request.path === "/sse" || request.path === "/message")
  ) {
    response.status(404).json({ error: "transport_disabled", transport: "sse" });
    return;
  }
  if (TRANSPORT_MODE === "sse" && request.path === "/mcp") {
    response.status(404).json({ error: "transport_disabled", transport: "http" });
    return;
  }
  next();
});

app.get("/health", (_request, response) => {
  response.status(200).json({
    status: "ok",
    service: "modelcontextprotocol-server-everything",
    release: "2025.9.12",
    commit: "5e84bac41739971c85aeb41d7e04c71fbaa9f16a",
    transportMode: TRANSPORT_MODE,
    transports:
      TRANSPORT_MODE === "all"
        ? ["legacy-http-sse", "streamable-http"]
        : [TRANSPORT_MODE === "sse" ? "legacy-http-sse" : "streamable-http"],
  });
});

app.get("/sse", async (request, response) => {
  const requestedSessionId =
    typeof request.query.sessionId === "string" ? request.query.sessionId : "";
  if (requestedSessionId) {
    response.status(400).json({
      error: "reconnect_not_supported_by_upstream_fixture",
    });
    return;
  }
  const { server, cleanup, startNotificationIntervals } = createServer();
  response.setHeader("X-Accel-Buffering", "no");
  const transport = new SSEServerTransport(SSE_PUBLIC_ENDPOINT, response);
  sseTransports.set(transport.sessionId, transport);
  await server.connect(transport);
  response.write(`: openchamber-sse-flush ${" ".repeat(4096)}\n\n`);
  startNotificationIntervals(transport.sessionId);
  server.onclose = async () => {
    sseTransports.delete(transport.sessionId);
    await cleanup();
  };
});

app.post("/message", async (request, response) => {
  const sessionId =
    typeof request.query.sessionId === "string" ? request.query.sessionId : "";
  const transport = sseTransports.get(sessionId);
  if (!transport) {
    response.status(404).json({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000, message: "Unknown SSE session" },
    });
    return;
  }
  await transport.handlePostMessage(request, response);
});

app.all("/mcp", async (request, response) => {
  try {
    const sessionId =
      typeof request.headers["mcp-session-id"] === "string"
        ? request.headers["mcp-session-id"]
        : "";
    let transport = sessionId ? httpTransports.get(sessionId) : undefined;
    if (!transport && request.method === "POST" && !sessionId) {
      const { server, cleanup, startNotificationIntervals } = createServer();
      const eventStore = new InMemoryEventStore();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        eventStore,
        onsessioninitialized: (newSessionId) => {
          httpTransports.set(newSessionId, transport);
        },
      });
      server.onclose = async () => {
        const closedSessionId = transport.sessionId;
        if (closedSessionId) httpTransports.delete(closedSessionId);
        await cleanup();
      };
      await server.connect(transport);
      await transport.handleRequest(request, response);
      startNotificationIntervals(transport.sessionId);
      return;
    }
    if (!transport) {
      response.status(400).json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: "No valid MCP session" },
      });
      return;
    }
    await transport.handleRequest(request, response);
  } catch {
    if (!response.headersSent) {
      response.status(500).json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32603, message: "Internal server error" },
      });
    }
  }
});

const listener = app.listen(PORT, "0.0.0.0", () => {
  console.error(`Legacy MCP 2025.9.12 listening on 0.0.0.0:${PORT}`);
});

async function shutdown() {
  for (const transport of [...sseTransports.values(), ...httpTransports.values()]) {
    try {
      await transport.close();
    } catch {
      // Best-effort cleanup during container shutdown.
    }
  }
  listener.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
