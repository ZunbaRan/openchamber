import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import AdmZip from "adm-zip";

const labRoot = resolve(process.env.INTEROP_LAB_ROOT || process.cwd());
const args = new Set(process.argv.slice(2));
const configuredBase =
  process.env.INTEROP_BASE_URL ||
  process.argv.find((value) => value.startsWith("--base-url="))?.slice(11) ||
  "http://127.0.0.1:9510";
const baseUrl = configuredBase.replace(/\/+$/, "");

function parseEnv(document) {
  return Object.fromEntries(
    document
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

const env = {
  ...parseEnv(await readFile(join(labRoot, ".env"), "utf8")),
  ...process.env,
};
const requiredSecretNames = [
  "LOCAL_CRM_API_KEY",
  "LOCAL_CRM_READ_ONLY_KEY",
  "HOSTED_OPS_API_KEY",
  "HOSTED_OPS_READ_ONLY_KEY",
];
for (const name of requiredSecretNames) {
  assert(env[name], `${name} is required in .env`);
}
const secretValues = requiredSecretNames.map((name) => env[name]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .flatMap((key) =>
        value[key] === undefined ? [] : [[key, canonicalize(value[key])]],
      ),
  );
}

function digestBuffer(buffer) {
  return `sha256-${crypto.createHash("sha256").update(buffer).digest("base64")}`;
}

function normalizedMediaType(value) {
  return String(value || "").split(";", 1)[0].trim().toLowerCase();
}

function decodeRpc(text, contentType) {
  if (!text.trim()) return null;
  if (!contentType.includes("text/event-stream")) return JSON.parse(text);
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (data) return JSON.parse(data);
  }
  throw new Error("MCP SSE response did not contain JSON data");
}

async function rawRpc(url, message, sessionId = "") {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  return {
    status: response.status,
    sessionId: response.headers.get("mcp-session-id") || sessionId,
    payload: decodeRpc(text, response.headers.get("content-type") || ""),
  };
}

async function probeHealth() {
  // Cloudflare Quick Tunnels can take several seconds to deliver the first
  // request after an idle period. Keep the local/default probe strict while
  // allowing the documented temporary-tunnel path enough time to warm up.
  const healthTimeoutMs = args.has("--quick-tunnel") ? 30_000 : 5_000;
  const routes = [
    "/health",
    "/health/hosted-ocix",
    "/health/local-crm",
    "/health/legacy",
    "/health/legacy-http",
    "/health/legacy-sse",
    "/health/excalidraw",
    "/health/tldraw",
  ];
  const results = [];
  for (const route of routes) {
    const response = await fetch(`${baseUrl}${route}`, {
      signal: AbortSignal.timeout(healthTimeoutMs),
    });
    const body = await response.json();
    assert.equal(response.status, 200, `${route} health failed`);
    if (route === "/health/excalidraw") {
      assert.equal(body.upstream?.provenanceVerified, true);
      assert.equal(body.upstream?.release, "v0.3.2");
    }
    if (route === "/health/tldraw") {
      assert.equal(body.tldraw?.officialUiVerified, true);
      assert.equal(body.tldraw?.uiImplementation, "official-source-build");
      assert.equal(body.canvasId, "interop-acceptance");
    }
    results.push({
      route,
      status: response.status,
      service: body.service,
      mode: body.mode,
      provenanceVerified:
        body.upstream?.provenanceVerified ??
        body.tldraw?.officialUiVerified,
    });
  }
  return results;
}

function createSseReader(response, controller) {
  assert(response.ok && response.body, "Legacy SSE connection failed");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    async next() {
      for (;;) {
        const boundary = buffer.search(/\r?\n\r?\n/);
        if (boundary >= 0) {
          const match = buffer.match(/\r?\n\r?\n/);
          const length = match?.[0].length || 2;
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + length);
          const event =
            block
              .split(/\r?\n/)
              .find((line) => line.startsWith("event:"))
              ?.slice(6)
              .trim() || "message";
          const data = block
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n");
          if (data) return { event, data };
        }
        const result = await reader.read();
        if (result.done) throw new Error("Legacy SSE stream closed");
        buffer += decoder.decode(result.value, { stream: true });
      }
    },
    close() {
      controller.abort();
      void reader.cancel().catch(() => {});
    },
  };
}

async function probeLegacySseSession() {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("Legacy SSE probe timed out after 20 seconds")),
    20_000,
  );
  const response = await fetch(`${baseUrl}/mcp/legacy/sse`, {
    headers: { accept: "text/event-stream" },
    signal: controller.signal,
  });
  const events = createSseReader(response, controller);
  const endpointEvent = await events.next();
  assert.equal(endpointEvent.event, "endpoint");
  const endpoint = new URL(endpointEvent.data, baseUrl);
  assert.equal(
    endpoint.pathname,
    `/${env.PUBLIC_GATE_PATH}/mcp/legacy/message`,
  );

  async function post(message, waitForId) {
    const accepted = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(10_000),
    });
    assert(accepted.ok, `Legacy SSE POST failed with ${accepted.status}`);
    if (waitForId === undefined) return null;
    for (;;) {
      const event = await events.next();
      if (event.event !== "message") continue;
      const payload = JSON.parse(event.data);
      if (payload.id === waitForId) return payload;
    }
  }

  try {
    const initialized = await post(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "openchamber-interop-probe", version: "1.0.0" },
        },
      },
      1,
    );
    assert(initialized.result?.serverInfo);
    await post(
      {
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      },
      undefined,
    );
    const listed = await post(
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      2,
    );
    const names = listed.result.tools.map((tool) => tool.name);
    assert(names.includes("echo"), "Official Everything server did not expose echo");
    const called = await post(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "echo", arguments: { message: "interop-acceptance" } },
      },
      3,
    );
    assert.match(called.result.content[0].text, /interop-acceptance/);
    return {
      release: "2025.9.12",
      transport: "legacy-http-sse",
      negotiatedProtocolVersion: initialized.result.protocolVersion,
      serverName: initialized.result.serverInfo.name,
      toolCount: names.length,
      echoVerified: true,
      sessionIdRecorded: false,
    };
  } finally {
    clearTimeout(timeout);
    events.close();
  }
}

async function probeLegacySse() {
  const first = await probeLegacySseSession();
  const second = await probeLegacySseSession();
  return {
    ...first,
    firstSessionDisconnected: true,
    secondFreshSessionVerified: second.echoVerified,
    reconnectSemantics: "fresh-session-after-disconnect",
  };
}

async function probeLegacyHttp() {
  const endpoint = `${baseUrl}/mcp/legacy`;
  const initialized = await rawRpc(endpoint, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "openchamber-interop-probe", version: "1.0.0" },
    },
  });
  assert.equal(initialized.status, 200);
  assert(initialized.sessionId);
  await rawRpc(
    endpoint,
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    initialized.sessionId,
  );
  const listed = await rawRpc(
    endpoint,
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    initialized.sessionId,
  );
  const called = await rawRpc(
    endpoint,
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "add", arguments: { a: 19, b: 23 } },
    },
    initialized.sessionId,
  );
  assert.match(called.payload.result.content[0].text, /42/);
  return {
    release: "2025.9.12",
    transport: "streamable-http",
    negotiatedProtocolVersion: initialized.payload.result.protocolVersion,
    serverName: initialized.payload.result.serverInfo.name,
    toolCount: listed.payload.result.tools.length,
    addVerified: true,
    sessionIdRecorded: false,
  };
}

function resourceUriFor(tool) {
  return (
    tool?._meta?.ui?.resourceUri ||
    tool?._meta?.["ui/resourceUri"] ||
    tool?._meta?.["openai/outputTemplate"]
  );
}

function excalidrawAcceptanceElements(label) {
  return JSON.stringify([
    {
      id: `box-${crypto.randomUUID().slice(0, 8)}`,
      type: "rectangle",
      x: 40,
      y: 40,
      width: 240,
      height: 100,
      strokeColor: "#1e1e1e",
      backgroundColor: "#a5d8ff",
      fillStyle: "solid",
      strokeWidth: 2,
      roughness: 1,
      opacity: 100,
    },
    {
      id: `text-${crypto.randomUUID().slice(0, 8)}`,
      type: "text",
      x: 72,
      y: 78,
      width: 176,
      height: 24,
      text: label,
      fontSize: 18,
      strokeColor: "#1e1e1e",
    },
  ]);
}

async function probeExcalidraw() {
  const endpoint = `${baseUrl}/mcp/excalidraw`;
  const initialized = await rawRpc(endpoint, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {
        extensions: {
          "io.modelcontextprotocol/ui": {
            mimeTypes: ["text/html;profile=mcp-app"],
          },
        },
      },
      clientInfo: { name: "openchamber-interop-probe", version: "1.0.0" },
    },
  });
  assert.equal(initialized.status, 200);
  await rawRpc(
    endpoint,
    {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    },
    initialized.sessionId,
  );
  const listed = await rawRpc(
    endpoint,
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    initialized.sessionId,
  );
  const tool = listed.payload.result.tools.find((candidate) =>
    resourceUriFor(candidate)?.startsWith("ui://"),
  );
  const createView = listed.payload.result.tools.find(
    (candidate) => candidate.name === "create_view",
  );
  assert(createView, "Official Excalidraw server did not expose create_view");
  assert(tool, "Official Excalidraw server did not expose an MCP App tool");
  const resourceUri = resourceUriFor(tool);
  assert.equal(resourceUri, "ui://excalidraw/mcp-app.html");
  const resource = await rawRpc(
    endpoint,
    {
      jsonrpc: "2.0",
      id: 3,
      method: "resources/read",
      params: { uri: resourceUri },
    },
    initialized.sessionId,
  );
  const content = resource.payload.result.contents[0];
  assert.equal(content.mimeType, "text/html;profile=mcp-app");
  assert.match(content.text, /excalidraw/i);
  const created = await rawRpc(
    endpoint,
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "create_view",
        arguments: {
          elements: excalidrawAcceptanceElements("Self-hosted v0.3.2"),
        },
      },
    },
    initialized.sessionId,
  );
  assert.equal(created.status, 200);
  assert.equal(created.payload.result?.isError, undefined);
  assert.match(created.payload.result?.structuredContent?.checkpointId || "", /^[a-f0-9]{18}$/);
  return {
    repository: "excalidraw/excalidraw-mcp",
    version: "v0.3.2",
    sessionMode: initialized.sessionId ? "stateful" : "stateless",
    sessionIdRecorded: false,
    serverName: initialized.payload.result.serverInfo.name,
    toolCount: listed.payload.result.tools.length,
    appTool: tool.name,
    createViewCalled: true,
    checkpointRecorded: Boolean(
      created.payload.result.structuredContent.checkpointId,
    ),
    resourceUri,
    mimeType: content.mimeType,
    htmlBytes: Buffer.byteLength(content.text),
    htmlSha256: digestBuffer(Buffer.from(content.text)),
  };
}

async function probeOfficialExcalidrawRemote() {
  const endpoint = "https://mcp.excalidraw.com/mcp";
  const client = new Client(
    { name: "openchamber-official-remote-probe", version: "1.0.0" },
    {
      capabilities: {
        extensions: {
          "io.modelcontextprotocol/ui": {
            mimeTypes: ["text/html;profile=mcp-app"],
          },
        },
      },
    },
  );
  const transport = new StreamableHTTPClientTransport(new URL(endpoint));
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    const createView = listed.tools.find((tool) => tool.name === "create_view");
    assert(createView, "Official Excalidraw remote omitted create_view");
    const created = await client.callTool({
      name: "create_view",
      arguments: {
        elements: excalidrawAcceptanceElements("Official remote"),
      },
    });
    assert.equal(created.isError, undefined);
    assert.match(created.structuredContent?.checkpointId || "", /^[a-f0-9]{18}$/);
    return {
      endpoint,
      negotiatedProtocolVersion: client.getNegotiatedProtocolVersion(),
      serverName: client.getServerVersion()?.name,
      createViewCalled: true,
      checkpointRecorded: true,
      toolCount: listed.tools.length,
    };
  } finally {
    await client.close();
  }
}

async function probeModern() {
  const canvasId = "interop-acceptance";
  const secondaryCanvasId = "interop-secondary";
  const diagramCanvasId = "interop-diagram-seed";
  const unknownCanvasId = "read-only-unknown";
  const initialDiagram = {
    title: "Interop service topology",
    nodes: [
      {
        id: "gateway",
        label: "API Gateway",
        shape: "rectangle",
        x: 120,
        y: 160,
        width: 220,
        height: 112,
        color: "blue",
      },
      {
        id: "orders",
        label: "Orders Service",
        shape: "rectangle",
        x: 480,
        y: 80,
        width: 220,
        height: 112,
        color: "green",
      },
      {
        id: "payments",
        label: "Payments Service",
        shape: "rectangle",
        x: 480,
        y: 280,
        width: 220,
        height: 112,
        color: "orange",
      },
    ],
    edges: [
      {
        id: "gateway-orders",
        from: "gateway",
        to: "orders",
        label: "checkout",
        color: "grey",
      },
      {
        id: "gateway-payments",
        from: "gateway",
        to: "payments",
        label: "authorize",
        color: "grey",
      },
    ],
  };
  const client = new Client(
    { name: "openchamber-interop-probe", version: "1.0.0" },
    {
      capabilities: {
        extensions: {
          "io.modelcontextprotocol/ui": {
            mimeTypes: ["text/html;profile=mcp-app"],
          },
        },
      },
      versionNegotiation: { mode: { pin: "2026-07-28" } },
    },
  );
  const transport = new StreamableHTTPClientTransport(
    new URL(`${baseUrl}/mcp/tldraw`),
  );
  await client.connect(transport);
  try {
    const discover = client.getDiscoverResult() || (await client.discover());
    assert(
      Array.isArray(discover.supportedVersions) &&
        discover.supportedVersions.includes("2026-07-28"),
      "Strict server discover response did not advertise 2026-07-28",
    );
    assert(
      Object.hasOwn(
        discover.capabilities?.extensions || {},
        "io.modelcontextprotocol/ui",
      ),
      "Strict server discover response omitted io.modelcontextprotocol/ui",
    );
    const listed = await client.listTools();
    const openTool = listed.tools.find(
      (tool) => tool.name === "tldraw_open_canvas",
    );
    const applyTool = listed.tools.find(
      (tool) => tool.name === "tldraw_apply_operations",
    );
    const saveTool = listed.tools.find(
      (tool) => tool.name === "tldraw_save_canvas",
    );
    const exportTool = listed.tools.find(
      (tool) => tool.name === "tldraw_export_snapshot",
    );
    assert(openTool && applyTool && saveTool && exportTool);
    assert.deepEqual(openTool?._meta?.ui?.visibility, ["model", "app"]);
    assert.equal(
      openTool?.inputSchema?.properties?.initialDiagram?.properties?.nodes
        ?.maxItems,
      100,
    );
    assert.equal(
      openTool?.inputSchema?.properties?.initialDiagram?.properties?.edges
        ?.maxItems,
      200,
    );
    for (const tool of [applyTool, saveTool, exportTool]) {
      assert.deepEqual(tool._meta?.ui?.visibility, ["app"]);
      assert.equal(openTool._meta?.ui?.resourceUri, tool._meta?.ui?.resourceUri);
    }

    const diagramOpened = await client.callTool({
      name: "tldraw_open_canvas",
      arguments: {
        canvasId: diagramCanvasId,
        createIfMissing: true,
        initialDiagram,
      },
    });
    assert.equal(diagramOpened.isError, undefined);
    assert.equal(diagramOpened.structuredContent.canvasId, diagramCanvasId);
    assert.deepEqual(diagramOpened.structuredContent.diagram, initialDiagram);
    const diagramRevision = diagramOpened.structuredContent.revision;

    const diagramReopened = await client.callTool({
      name: "tldraw_open_canvas",
      arguments: {
        canvasId: diagramCanvasId,
        createIfMissing: true,
        initialDiagram,
      },
    });
    assert.equal(diagramReopened.isError, undefined);
    assert.equal(diagramReopened.structuredContent.revision, diagramRevision);
    assert.deepEqual(diagramReopened.structuredContent.diagram, initialDiagram);

    const conflictingDiagram = structuredClone(initialDiagram);
    conflictingDiagram.nodes[0].label = "Unexpected overwrite";
    const diagramOverwrite = await client.callTool({
      name: "tldraw_open_canvas",
      arguments: {
        canvasId: diagramCanvasId,
        createIfMissing: true,
        initialDiagram: conflictingDiagram,
      },
    });
    assert.equal(diagramOverwrite.isError, true);
    assert.match(
      diagramOverwrite.content?.[0]?.text || "",
      /diagram_already_initialized/,
    );
    assert.equal(
      diagramOverwrite.structuredContent.revision,
      diagramRevision,
    );
    assert.deepEqual(
      diagramOverwrite.structuredContent.diagram,
      initialDiagram,
    );

    const opened = await client.callTool({
      name: "tldraw_open_canvas",
      arguments: { canvasId, createIfMissing: false },
    });
    assert.equal(opened.structuredContent.canvasId, canvasId);
    assert.equal(opened.structuredContent.created, false);
    const defaultRevisionBeforeIsolation = opened.structuredContent.revision;

    const secondaryOpened = await client.callTool({
      name: "tldraw_open_canvas",
      arguments: {
        canvasId: secondaryCanvasId,
        createIfMissing: true,
      },
    });
    assert.equal(secondaryOpened.isError, undefined);
    assert.equal(secondaryOpened.structuredContent.canvasId, secondaryCanvasId);
    const secondaryRevision = secondaryOpened.structuredContent.revision;
    const secondaryApplied = await client.callTool({
      name: "tldraw_apply_operations",
      arguments: {
        canvasId: secondaryCanvasId,
        expectedRevision: secondaryRevision,
        operations: [
          {
            type: "add",
            id: `secondary-note-${secondaryRevision}`,
            text: `Secondary canvas revision ${secondaryRevision + 1}`,
            x: 420,
            y: 180,
            color: "green",
          },
        ],
      },
    });
    assert.equal(secondaryApplied.isError, undefined);
    assert.equal(
      secondaryApplied.structuredContent.revision,
      secondaryRevision + 1,
    );

    const defaultAfterSecondaryMutation = await client.callTool({
      name: "tldraw_open_canvas",
      arguments: { canvasId, createIfMissing: false },
    });
    assert.equal(
      defaultAfterSecondaryMutation.structuredContent.revision,
      defaultRevisionBeforeIsolation,
    );
    assert.equal(
      defaultAfterSecondaryMutation.structuredContent.notes.some(
        (note) => note.id === `secondary-note-${secondaryRevision}`,
      ),
      false,
    );

    const unknownReadOnly = await client.callTool({
      name: "tldraw_open_canvas",
      arguments: {
        canvasId: unknownCanvasId,
        createIfMissing: false,
      },
    });
    assert.equal(unknownReadOnly.isError, true);
    assert.equal(unknownReadOnly.structuredContent, undefined);
    assert.match(unknownReadOnly.content?.[0]?.text || "", /canvas_not_found/);
    const unknownMutation = await client.callTool({
      name: "tldraw_apply_operations",
      arguments: {
        canvasId: unknownCanvasId,
        expectedRevision: 1,
        operations: [
          {
            type: "add",
            id: "must-not-exist",
            text: "Unknown canvases must never be created by mutation tools",
            x: 0,
            y: 0,
            color: "red",
          },
        ],
      },
    });
    assert.equal(unknownMutation.isError, true);
    assert.equal(unknownMutation.structuredContent, undefined);

    const healthAfterIsolation = await jsonRequest("/health/tldraw");
    assert.equal(healthAfterIsolation.status, 200);
    assert(
      healthAfterIsolation.payload.canvases.ids.includes(secondaryCanvasId),
    );
    assert.equal(
      healthAfterIsolation.payload.canvases.ids.includes(unknownCanvasId),
      false,
    );
    assert.equal(
      healthAfterIsolation.payload.canvases.unknownOpenPolicy,
      "not-found-unless-createIfMissing",
    );

    const revision = defaultAfterSecondaryMutation.structuredContent.revision;
    const applied = await client.callTool({
      name: "tldraw_apply_operations",
      arguments: {
        canvasId,
        expectedRevision: revision,
        operations: [
          {
            type: "add",
            id: `probe-note-${revision}`,
            text: `Probe revision ${revision + 1}`,
            x: 240,
            y: 220,
            color: "violet",
          },
          {
            type: "move",
            id: `probe-note-${revision}`,
            x: 180,
            y: 140,
          },
          {
            type: "updateText",
            id: `probe-note-${revision}`,
            text: "tldraw v5.0.2 operation probe",
          },
        ],
      },
    });
    assert.equal(applied.isError, undefined);
    assert.equal(applied.structuredContent.revision, revision + 1);
    const stale = await client.callTool({
      name: "tldraw_apply_operations",
      arguments: {
        canvasId,
        expectedRevision: revision,
        operations: [
          {
            type: "add",
            id: `stale-note-${revision}`,
            text: "This stale mutation must not commit",
            x: 320,
            y: 280,
            color: "red",
          },
        ],
      },
    });
    assert.equal(stale.isError, true);
    assert.equal(stale.structuredContent.revision, revision + 1);

    const snapshot = {
      document: {
        schema: { schemaVersion: 2 },
        store: Object.fromEntries(
          applied.structuredContent.notes.map((note) => [
            `shape:${note.id}`,
            {
              id: `shape:${note.id}`,
              typeName: "shape",
              type: "note",
              x: note.x,
              y: note.y,
              props: { color: note.color, acceptanceText: note.text },
            },
          ]),
        ),
      },
    };
    const saved = await client.callTool({
      name: "tldraw_save_canvas",
      arguments: {
        canvasId,
        expectedRevision: revision + 1,
        snapshot,
        operationSummary: {
          added: 1,
          movedOrEdited: 1,
          removed: 0,
        },
      },
    });
    assert.equal(saved.isError, undefined);
    assert.equal(saved.structuredContent.revision, revision + 2);
    assert.equal(saved.structuredContent.lastSaved.revision, revision + 2);
    assert(saved.structuredContent.lastSaved.bytes > 0);

    const svgBytes = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
    );
    const exported = await client.callTool({
      name: "tldraw_export_snapshot",
      arguments: {
        canvasId,
        expectedRevision: revision + 2,
        format: "svg",
        byteLength: svgBytes.length,
        sha256: crypto.createHash("sha256").update(svgBytes).digest("hex"),
        shapeCount: applied.structuredContent.notes.length,
      },
    });
    assert.equal(exported.isError, undefined);
    assert.equal(exported.structuredContent.format, "svg");
    assert.equal(exported.structuredContent.revision, revision + 2);

    const resource = await client.readResource({
      uri: openTool._meta.ui.resourceUri,
    });
    const appContent = resource.contents[0];
    assert.equal(appContent.mimeType, "text/html;profile=mcp-app");
    assert.match(appContent.text, /tldraw v5\.0\.2/i);

    const legacyAttempt = await rawRpc(`${baseUrl}/mcp/tldraw`, {
      jsonrpc: "2.0",
      id: 99,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "legacy-negative-probe", version: "1.0.0" },
      },
    });
    assert(legacyAttempt.status >= 400 || legacyAttempt.payload?.error);

    const textOnlyClient = new Client(
      { name: "openchamber-text-only-probe", version: "1.0.0" },
      {
        capabilities: {},
        versionNegotiation: { mode: { pin: "2026-07-28" } },
      },
    );
    const textOnlyTransport = new StreamableHTTPClientTransport(
      new URL(`${baseUrl}/mcp/tldraw`),
    );
    await textOnlyClient.connect(textOnlyTransport);
    let textOnly;
    try {
      textOnly = await textOnlyClient.callTool({
        name: "tldraw_open_canvas",
        arguments: { canvasId },
      });
      assert.equal(textOnly.structuredContent, undefined);
      assert.equal(textOnly.content?.[0]?.type, "text");
    } finally {
      await textOnlyClient.close();
    }

    return {
      protocolVersion: client.getNegotiatedProtocolVersion(),
      era: client.getProtocolEra(),
      serverDiscover: {
        supportedVersions: discover.supportedVersions,
        extensionKeys: Object.keys(discover.capabilities?.extensions || {}),
      },
      tldrawVersion: "5.0.2",
      canvasId,
      canvasPolicy: {
        unknownOpenRequiresExplicitCreate: true,
        unknownMutationRejected: true,
        existingOpenDoesNotChangeRevision: true,
        initialDiagramIsBounded: true,
        conflictingInitialDiagramRejected: true,
      },
      initialDiagram: {
        canvasId: diagramCanvasId,
        revision: diagramRevision,
        nodes: diagramOpened.structuredContent.diagram.nodes.length,
        edges: diagramOpened.structuredContent.diagram.edges.length,
        idempotentReopen: true,
        overwriteRejected: true,
      },
      secondaryCanvas: {
        canvasId: secondaryCanvasId,
        createdThisRun: secondaryOpened.structuredContent.created,
        revisionBefore: secondaryRevision,
        revisionAfterOperations: secondaryApplied.structuredContent.revision,
        isolatedFromDefault: true,
      },
      appResourceUri: openTool._meta.ui.resourceUri,
      appMimeType: appContent.mimeType,
      appHtmlBytes: Buffer.byteLength(appContent.text),
      modelAndAppTool: openTool.name,
      appOnlyTools: [applyTool.name, saveTool.name, exportTool.name],
      appOnlyDeclared: true,
      revisionBefore: revision,
      revisionAfterOperations: applied.structuredContent.revision,
      revisionAfterSave: saved.structuredContent.revision,
      saveReceipt: {
        bytes: saved.structuredContent.lastSaved.bytes,
        sha256Recorded: Boolean(saved.structuredContent.lastSaved.sha256),
      },
      exportReceipt: {
        format: exported.structuredContent.format,
        byteLength: exported.structuredContent.byteLength,
        sha256Recorded: Boolean(exported.structuredContent.sha256),
        shapeCount: exported.structuredContent.shapeCount,
      },
      staleRevisionRejected: true,
      legacyInitializeRejected: true,
      noAppsCapabilityTextOnly: Boolean(textOnly.content?.length),
    };
  } finally {
    await client.close();
  }
}

async function readTldrawCanvasState(canvasId) {
  const client = new Client(
    { name: "openchamber-persistence-probe", version: "1.0.0" },
    {
      capabilities: {
        extensions: {
          "io.modelcontextprotocol/ui": {
            mimeTypes: ["text/html;profile=mcp-app"],
          },
        },
      },
      versionNegotiation: { mode: { pin: "2026-07-28" } },
    },
  );
  const transport = new StreamableHTTPClientTransport(
    new URL(`${baseUrl}/mcp/tldraw`),
  );
  await client.connect(transport);
  try {
    const opened = await client.callTool({
      name: "tldraw_open_canvas",
      arguments: { canvasId, createIfMissing: false },
    });
    assert.equal(opened.isError, undefined);
    assert.equal(opened.structuredContent.canvasId, canvasId);
    return opened.structuredContent;
  } finally {
    await client.close();
  }
}

async function probeTldrawRestartPersistence() {
  if (!args.has("--restart-persistence")) {
    return {
      performed: false,
      optInFlag: "--restart-persistence",
    };
  }
  const canvasIds = [
    "interop-acceptance",
    "interop-secondary",
    "interop-diagram-seed",
  ];
  const before = {};
  for (const canvasId of canvasIds) {
    before[canvasId] = await readTldrawCanvasState(canvasId);
  }
  await commandOutput("docker", ["restart", "oc-tldraw-mcp-2026"]);
  let healthy = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health/tldraw`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        healthy = true;
        break;
      }
    } catch {
      // Container is still restarting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  assert(healthy, "tldraw did not become healthy after restart");
  const after = {};
  for (const canvasId of canvasIds) {
    after[canvasId] = await readTldrawCanvasState(canvasId);
  }
  for (const canvasId of canvasIds) {
    assert.equal(after[canvasId].canvasId, before[canvasId].canvasId);
    assert.equal(after[canvasId].revision, before[canvasId].revision);
    assert.deepEqual(after[canvasId].diagram, before[canvasId].diagram);
    assert.deepEqual(after[canvasId].snapshot, before[canvasId].snapshot);
    assert.deepEqual(after[canvasId].lastSaved, before[canvasId].lastSaved);
  }
  assert.notDeepEqual(
    after["interop-acceptance"].notes,
    after["interop-secondary"].notes,
  );
  return {
    performed: true,
    container: "oc-tldraw-mcp-2026",
    canvases: Object.fromEntries(
      canvasIds.map((canvasId) => [
        canvasId,
        {
          revisionBefore: before[canvasId].revision,
          revisionAfter: after[canvasId].revision,
          snapshotRecovered: true,
          saveReceiptRecovered: true,
        },
      ]),
    ),
    multiCanvasIsolationRecovered: true,
  };
}

async function jsonRequest(pathname, {
  method = "GET",
  key,
  body,
  rawBody,
  inject,
  timeoutMs = 5000,
} = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      accept: "application/json",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...(body !== undefined || rawBody !== undefined
        ? { "content-type": "application/json" }
        : {}),
      ...(inject ? { "x-acceptance-inject": inject } : {}),
    },
    body:
      rawBody !== undefined
        ? rawBody
        : body === undefined
          ? undefined
          : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  assert.equal(
    normalizedMediaType(contentType),
    "application/json",
    `${pathname} returned an unexpected Content-Type`,
  );
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { nonJsonResponse: true, bytes: Buffer.byteLength(text) };
  }
  return {
    status: response.status,
    payload,
    bytes: Buffer.byteLength(text),
    contentType,
  };
}

async function expectTimeout(operation) {
  try {
    await operation();
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") return true;
    throw error;
  }
  return false;
}

async function probeHostedRest() {
  const noAuth = await jsonRequest("/api/v1/incidents");
  assert.equal(noAuth.status, 401);
  const incidents = await jsonRequest("/api/v1/incidents", {
    key: env.HOSTED_OPS_API_KEY,
  });
  assert.equal(incidents.status, 200);
  const incident = incidents.payload.incidents[0];
  const detail = await jsonRequest(`/api/v1/incidents/${incident.id}`, {
    key: env.HOSTED_OPS_API_KEY,
  });
  assert.equal(detail.status, 200);
  const services = await jsonRequest("/api/v1/services", {
    key: env.HOSTED_OPS_API_KEY,
  });
  assert.equal(services.status, 200);
  const topology = await jsonRequest(
    `/api/v1/services/${services.payload.services[0].id}/topology`,
    { key: env.HOSTED_OPS_API_KEY },
  );
  assert.equal(topology.status, 200);
  const forbidden = await jsonRequest(
    `/api/v1/incidents/${incident.id}/acknowledge`,
    {
      method: "POST",
      key: env.HOSTED_OPS_READ_ONLY_KEY,
      body: { revision: incident.revision },
    },
  );
  assert.equal(forbidden.status, 403);
  const invalidJson = await jsonRequest(
    `/api/v1/incidents/${incident.id}/acknowledge`,
    {
      method: "POST",
      key: env.HOSTED_OPS_API_KEY,
      rawBody: "{invalid",
    },
  );
  assert.equal(invalidJson.status, 400);
  const oversize = await jsonRequest(
    `/api/v1/incidents/${incident.id}/acknowledge`,
    {
      method: "POST",
      key: env.HOSTED_OPS_API_KEY,
      rawBody: JSON.stringify({ padding: "x".repeat(70 * 1024) }),
      timeoutMs: 30_000,
    },
  );
  assert.equal(oversize.status, 413);
  const invalidJsonResponse = await jsonRequest("/api/v1/services", {
    key: env.HOSTED_OPS_API_KEY,
    inject: "invalid-json-response",
  });
  assert.equal(invalidJsonResponse.status, 200);
  assert.equal(invalidJsonResponse.payload.nonJsonResponse, true);
  const oversizeResponse = await jsonRequest("/api/v1/services", {
    key: env.HOSTED_OPS_API_KEY,
    inject: "oversize-response",
    timeoutMs: 30_000,
  });
  assert.equal(oversizeResponse.status, 200);
  assert(oversizeResponse.bytes > 2 * 1024 * 1024);
  const timeout = await expectTimeout(() =>
    jsonRequest("/api/v1/services", {
      key: env.HOSTED_OPS_API_KEY,
      inject: "timeout",
      timeoutMs: 100,
    }),
  );
  assert(timeout);
  const acknowledged = await jsonRequest(
    `/api/v1/incidents/${incident.id}/acknowledge`,
    {
      method: "POST",
      key: env.HOSTED_OPS_API_KEY,
      body: { revision: incident.revision },
    },
  );
  assert.equal(acknowledged.status, 200);
  return {
    endpoints: [
      "GET /api/v1/incidents",
      "GET /api/v1/incidents/:id",
      "POST /api/v1/incidents/:id/acknowledge",
      "GET /api/v1/services",
      "GET /api/v1/services/:id/topology",
    ],
    incidentCount: incidents.payload.incidents.length,
    serviceCount: services.payload.services.length,
    writeRevision: acknowledged.payload.incident.revision,
    injections: {
      unauthorized401: true,
      readOnly403: true,
      timeout: true,
      invalidRequestJson400: true,
      oversizeRequest413: true,
      invalidJsonResponse: true,
      oversizeResponse: true,
    },
    responseContentTypeVerified: true,
  };
}

async function probeLocalRest() {
  const noAuth = await jsonRequest("/api/v1/customers");
  assert.equal(noAuth.status, 401);
  const customers = await jsonRequest("/api/v1/customers", {
    key: env.LOCAL_CRM_API_KEY,
  });
  assert.equal(customers.status, 200);
  const customer = customers.payload.customers[0];
  const detail = await jsonRequest(`/api/v1/customers/${customer.id}`, {
    key: env.LOCAL_CRM_API_KEY,
  });
  assert.equal(detail.status, 200);
  const opportunities = await jsonRequest("/api/v1/opportunities", {
    key: env.LOCAL_CRM_API_KEY,
  });
  assert.equal(opportunities.status, 200);
  const opportunity = opportunities.payload.opportunities[0];
  const forbidden = await jsonRequest(
    `/api/v1/opportunities/${opportunity.id}/status`,
    {
      method: "PATCH",
      key: env.LOCAL_CRM_READ_ONLY_KEY,
      body: { status: opportunity.stage, revision: opportunity.revision },
    },
  );
  assert.equal(forbidden.status, 403);
  const invalidJson = await jsonRequest(
    `/api/v1/opportunities/${opportunity.id}/status`,
    {
      method: "PATCH",
      key: env.LOCAL_CRM_API_KEY,
      rawBody: "{invalid",
    },
  );
  assert.equal(invalidJson.status, 400);
  const oversize = await jsonRequest(
    `/api/v1/customers/${customer.id}/follow-ups`,
    {
      method: "POST",
      key: env.LOCAL_CRM_API_KEY,
      rawBody: JSON.stringify({ padding: "x".repeat(70 * 1024) }),
      timeoutMs: 30_000,
    },
  );
  assert.equal(oversize.status, 413);
  const invalidJsonResponse = await jsonRequest("/api/v1/customers", {
    key: env.LOCAL_CRM_API_KEY,
    inject: "invalid-json-response",
  });
  assert.equal(invalidJsonResponse.status, 200);
  assert.equal(invalidJsonResponse.payload.nonJsonResponse, true);
  const oversizeResponse = await jsonRequest("/api/v1/customers", {
    key: env.LOCAL_CRM_API_KEY,
    inject: "oversize-response",
    timeoutMs: 30_000,
  });
  assert.equal(oversizeResponse.status, 200);
  assert(oversizeResponse.bytes > 2 * 1024 * 1024);
  const timeout = await expectTimeout(() =>
    jsonRequest("/api/v1/customers", {
      key: env.LOCAL_CRM_API_KEY,
      inject: "timeout",
      timeoutMs: 100,
    }),
  );
  assert(timeout);
  const updated = await jsonRequest(
    `/api/v1/opportunities/${opportunity.id}/status`,
    {
      method: "PATCH",
      key: env.LOCAL_CRM_API_KEY,
      body: { status: opportunity.stage, revision: opportunity.revision },
    },
  );
  assert.equal(updated.status, 200);
  const followUp = await jsonRequest(
    `/api/v1/customers/${customer.id}/follow-ups`,
    {
      method: "POST",
      key: env.LOCAL_CRM_API_KEY,
      body: { note: "Interop acceptance follow-up" },
    },
  );
  assert.equal(followUp.status, 201);
  return {
    endpoints: [
      "GET /api/v1/customers",
      "GET /api/v1/customers/:id",
      "GET /api/v1/opportunities",
      "PATCH /api/v1/opportunities/:id/status",
      "POST /api/v1/customers/:id/follow-ups",
    ],
    customerCount: customers.payload.customers.length,
    opportunityCount: opportunities.payload.opportunities.length,
    writeRevision: updated.payload.opportunity.revision,
    followUpCreated: Boolean(followUp.payload.followUp.id),
    injections: {
      unauthorized401: true,
      readOnly403: true,
      timeout: true,
      invalidRequestJson400: true,
      oversizeRequest413: true,
      invalidJsonResponse: true,
      oversizeResponse: true,
    },
    responseContentTypeVerified: true,
  };
}

function verifyPackage(buffer) {
  const archive = new AdmZip(buffer);
  const indexEntry = archive.getEntry("openchamber.package.json");
  assert(indexEntry, "OCIX package index missing");
  const packageIndex = JSON.parse(indexEntry.getData().toString("utf8"));
  const { signature, ...unsigned } = packageIndex;
  const publicKey = crypto.createPublicKey(packageIndex.publisher.publicKey);
  assert(
    crypto.verify(
      null,
      Buffer.from(JSON.stringify(canonicalize(unsigned))),
      publicKey,
      Buffer.from(signature.value, "base64"),
    ),
    "OCIX package index signature invalid",
  );
  for (const file of packageIndex.files) {
    const entry = archive.getEntry(file.path);
    assert(entry, `OCIX file missing: ${file.path}`);
    assert.equal(entry.getData().length, file.size);
    assert.equal(digestBuffer(entry.getData()), file.sha256);
  }
  return {
    extension: packageIndex.extension,
    publisherId: packageIndex.publisher.id,
    keyId: packageIndex.publisher.keyId,
    fileCount: packageIndex.files.length,
    signatureVerified: true,
    fileIndexVerified: true,
    publicKeyDerSha256: crypto
      .createHash("sha256")
      .update(publicKey.export({ type: "spki", format: "der" }))
      .digest("hex"),
  };
}

async function probeHostedSignatures() {
  const packageResponse = await fetch(`${baseUrl}/hosted/ops/remote-ops.ocix`);
  assert.equal(packageResponse.status, 200);
  assert.equal(
    normalizedMediaType(packageResponse.headers.get("content-type")),
    "application/zip",
    "Hosted thin package returned an unexpected Content-Type",
  );
  const packageBuffer = Buffer.from(await packageResponse.arrayBuffer());
  const packageEvidence = verifyPackage(packageBuffer);

  const publisherPublicKey = await readFile(
    join(labRoot, ".runtime", "keys", "publisher.public.pem"),
  );
  const verificationKey = crypto.createPublicKey(publisherPublicKey);
  const verificationKeyDerSha256 = crypto
    .createHash("sha256")
    .update(verificationKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  assert.equal(
    packageEvidence.publicKeyDerSha256,
    verificationKeyDerSha256,
    "Hosted thin-package publisher key does not match the manifest signing key",
  );

  async function verifyManifest(url, expectTamper = false) {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, 200);
    assert.equal(
      normalizedMediaType(response.headers.get("content-type")),
      "application/json",
      `Hosted manifest returned an unexpected Content-Type at ${url}`,
    );
    const manifest = await response.json();
    const { signature, ...unsigned } = manifest;
    assert.equal(signature.keyId, packageEvidence.keyId);
    assert(
      crypto.verify(
        null,
        Buffer.from(JSON.stringify(canonicalize(unsigned))),
        verificationKey,
        Buffer.from(signature.value, "base64"),
      ),
      `Hosted remote-manifest signature invalid at ${url}`,
    );
    const resources = [];
    for (const resource of manifest.resources) {
      const resourceUrl = args.has("--loopback-hosted-resources")
        ? new URL(new URL(resource.url).pathname, `${baseUrl}/`).toString()
        : resource.url;
      const resourceResponse = await fetch(resourceUrl, {
        signal: AbortSignal.timeout(10_000),
      });
      assert.equal(
        resourceResponse.status,
        200,
        `Hosted resource unavailable: ${resource.path}`,
      );
      const actualMimeType = normalizedMediaType(
        resourceResponse.headers.get("content-type"),
      );
      assert.equal(
        actualMimeType,
        normalizedMediaType(resource.mimeType),
        `Hosted resource MIME mismatch: ${resource.path}`,
      );
      const body = Buffer.from(await resourceResponse.arrayBuffer());
      resources.push({
        path: resource.path,
        bytes: body.length,
        sha256Verified: digestBuffer(body) === resource.sha256,
        mimeTypeVerified: true,
      });
    }
    const mismatches = resources.filter((resource) => !resource.sha256Verified);
    if (expectTamper) {
      assert(mismatches.length > 0, "Tampered fixture unexpectedly matched all digests");
    } else {
      assert.equal(
        mismatches.length,
        0,
        `Hosted release ${manifest.app.version} has a resource digest mismatch`,
      );
    }
    return {
      manifest,
      evidence: {
        version: manifest.app.version,
        keyId: signature.keyId,
        signatureVerified: true,
        resourceCount: resources.length,
        resourceDigestsVerified: mismatches.length === 0,
        contentTypesVerified: true,
        mismatchPaths: mismatches.map((resource) => resource.path),
      },
      resources,
    };
  }

  const root = await verifyManifest(
    `${baseUrl}/hosted/ops/openchamber.hosted.json`,
  );
  assert.equal(root.manifest.app.version, "1.0.0");
  const releases = {};
  for (const slot of ["1.0.0", "1.0.1", "1.1.0", "tampered"]) {
    releases[slot] = await verifyManifest(
      `${baseUrl}/hosted/ops/releases/${slot}/openchamber.hosted.json`,
      slot === "tampered",
    );
  }
  const baselinePermissions = JSON.stringify(
    canonicalize(releases["1.0.0"].manifest.permissions),
  );
  const patchPermissions = JSON.stringify(
    canonicalize(releases["1.0.1"].manifest.permissions),
  );
  const expandedPermissions = JSON.stringify(
    canonicalize(releases["1.1.0"].manifest.permissions),
  );
  assert.equal(
    patchPermissions,
    baselinePermissions,
    "1.0.1 must remain permission-equivalent to 1.0.0",
  );
  assert.notEqual(
    expandedPermissions,
    baselinePermissions,
    "1.1.0 must expand permissions",
  );
  assert.equal(releases["1.1.0"].manifest.permissions.clipboard, true);

  return {
    thinPackage: packageEvidence,
    publisherKeyBindingVerified: true,
    rootManifest: {
      schema: root.manifest.$schema,
      extensionId: root.manifest.app.id,
      ...root.evidence,
    },
    rootResources: root.resources,
    releaseMatrix: {
      "1.0.0": releases["1.0.0"].evidence,
      "1.0.1": releases["1.0.1"].evidence,
      "1.1.0": releases["1.1.0"].evidence,
      tampered: releases.tampered.evidence,
      patchPermissionEquivalent: true,
      minorPermissionExpanded: true,
      tamperedSignatureValidResourceHashRejected: true,
    },
  };
}

function commandOutput(command, commandArgs) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, commandArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", rejectCommand);
    child.once("exit", (code) => {
      if (code !== 0) {
        rejectCommand(
          new Error(`${command} failed: ${Buffer.concat(stderr).toString("utf8")}`),
        );
        return;
      }
      resolveCommand(
        `${Buffer.concat(stdout).toString("utf8")}\n${Buffer.concat(stderr).toString("utf8")}`,
      );
    });
  });
}

async function probeTunnel() {
  if (!args.has("--tunnel")) return { enabled: false };
  const logs = await commandOutput("docker", ["logs", "oc-interop-tunnel"]);
  const matches = logs.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi) || [];
  assert(matches.length, "No quick-tunnel HTTPS URL found in oc-interop-tunnel logs");
  const url = matches.at(-1);
  const publicBaseUrl = `${url}/${env.PUBLIC_GATE_PATH}`;
  const response = await fetch(`${publicBaseUrl}/health`, {
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, 200);
  return {
    enabled: true,
    quickTunnelOrigin: url,
    publicBaseUrl,
    gatewayHealthVerified: true,
  };
}

const startedAt = new Date().toISOString();
async function runStage(label, operation) {
  console.error(`[interop-probe] ${label}`);
  return operation();
}
const evidence = {
  schema: "openchamber://interop-acceptance-evidence/v1",
  startedAt,
  baseUrl,
  health: await runStage("health", probeHealth),
  chains: {
    hostedOcix: {
      rest: await runStage("hosted-rest", probeHostedRest),
      signatures: await runStage("hosted-signatures", probeHostedSignatures),
    },
    localCrm: {
      rest: await runStage("local-rest", probeLocalRest),
    },
    legacyMcp: {
      http: await runStage("legacy-http", probeLegacyHttp),
      sse: args.has("--quick-tunnel")
        ? {
            performed: false,
            status: "blocked",
            reason: "Cloudflare Quick Tunnels do not support Server-Sent Events",
            loopbackEvidenceRequired: true,
            providerDocumentation:
              "https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/#limitations",
          }
        : await runStage("legacy-sse", probeLegacySse),
    },
    officialExcalidrawSelfHosted: await runStage(
      "excalidraw-self-hosted",
      probeExcalidraw,
    ),
    officialExcalidrawRemote: await runStage(
      "excalidraw-official-remote",
      probeOfficialExcalidrawRemote,
    ),
    strictModernTldraw: {
      ...(await runStage("tldraw-2026", probeModern)),
      restartPersistence: await runStage(
        "tldraw-restart-persistence",
        probeTldrawRestartPersistence,
      ),
    },
  },
  tunnel: await runStage("tunnel", probeTunnel),
  completedAt: new Date().toISOString(),
};
const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
for (const secret of secretValues) {
  assert(!serialized.includes(secret), "Evidence contains credential material");
}
const evidenceRoot = join(labRoot, "evidence");
await mkdir(evidenceRoot, { recursive: true });
const filename = `acceptance-${startedAt.replace(/[:.]/g, "-")}.json`;
const outputPath = join(evidenceRoot, filename);
await writeFile(outputPath, serialized, { mode: 0o600 });
console.log(outputPath);
