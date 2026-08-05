#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const labRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const endpoint =
  process.env.INTEROP_TLDRAW_MCP_URL ||
  process.env.OPENCHAMBER_TLDRAW_MCP_URL ||
  "http://127.0.0.1:39512/mcp";
const healthEndpoint =
  process.env.INTEROP_TLDRAW_HEALTH_URL ||
  process.env.OPENCHAMBER_TLDRAW_HEALTH_URL ||
  new URL("/health", endpoint).href;
const clientEntry = join(
  labRoot,
  ".runtime",
  "build",
  "probes",
  "node_modules",
  "@modelcontextprotocol",
  "client",
  "dist",
  "index.mjs",
);

let clientModule;
try {
  clientModule = await import(pathToFileURL(clientEntry));
} catch (error) {
  throw new Error(
    `The pinned MCP 2026 probe client is missing; run \"node scripts/build-probes.mjs\": ${error.message}`,
  );
}

const { Client, StreamableHTTPClientTransport } = clientModule;
const client = new Client(
  { name: "openchamber-local-tldraw-probe", version: "1.0.0" },
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
const transport = new StreamableHTTPClientTransport(new URL(endpoint));

await client.connect(transport);
try {
  const discover = client.getDiscoverResult() || (await client.discover());
  assert(discover.supportedVersions.includes("2026-07-28"));
  assert(
    Object.hasOwn(
      discover.capabilities?.extensions || {},
      "io.modelcontextprotocol/ui",
    ),
  );

  const listed = await client.listTools();
  const byName = new Map(listed.tools.map((tool) => [tool.name, tool]));
  const openTool = byName.get("tldraw_open_canvas");
  const applyTool = byName.get("tldraw_apply_operations");
  const saveTool = byName.get("tldraw_save_canvas");
  const exportTool = byName.get("tldraw_export_snapshot");
  assert(openTool && applyTool && saveTool && exportTool);
  assert.deepEqual(openTool._meta?.ui?.visibility, ["model", "app"]);
  for (const tool of [applyTool, saveTool, exportTool]) {
    assert.deepEqual(tool._meta?.ui?.visibility, ["app"]);
    assert.equal(tool._meta?.ui?.resourceUri, openTool._meta?.ui?.resourceUri);
  }

  const resource = await client.readResource({
    uri: openTool._meta.ui.resourceUri,
  });
  const app = resource.contents[0];
  assert.equal(app.mimeType, "text/html;profile=mcp-app");
  assert.match(app.text, /tldraw v5\.0\.2/i);

  const canvasId = "local-loopback-probe";
  const opened = await client.callTool({
    name: "tldraw_open_canvas",
    arguments: { canvasId, createIfMissing: true },
  });
  assert.equal(opened.isError, undefined);
  assert.equal(opened.structuredContent.canvasId, canvasId);
  const revision = opened.structuredContent.revision;
  const noteId = `probe-note-${revision}`;
  const applied = await client.callTool({
    name: "tldraw_apply_operations",
    arguments: {
      canvasId,
      expectedRevision: revision,
      operations: [
        {
          type: "add",
          id: noteId,
          text: `Local loopback revision ${revision + 1}`,
          x: 160,
          y: 160,
          color: "blue",
        },
      ],
    },
  });
  assert.equal(applied.isError, undefined);
  assert.equal(applied.structuredContent.canvasId, canvasId);
  assert.equal(applied.structuredContent.revision, revision + 1);

  const snapshot = {
    document: {
      schema: { schemaVersion: 2 },
      store: {
        [`shape:${noteId}`]: {
          id: `shape:${noteId}`,
          typeName: "shape",
          type: "note",
          x: 160,
          y: 160,
          props: {
            color: "blue",
            acceptanceText: `Local loopback revision ${revision + 1}`,
          },
        },
      },
    },
  };
  const saved = await client.callTool({
    name: "tldraw_save_canvas",
    arguments: {
      canvasId,
      expectedRevision: revision + 1,
      snapshot,
      operationSummary: { added: 1, movedOrEdited: 0, removed: 0 },
    },
  });
  assert.equal(saved.isError, undefined);
  assert.equal(saved.structuredContent.canvasId, canvasId);
  assert.equal(saved.structuredContent.revision, revision + 2);

  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
  );
  const exported = await client.callTool({
    name: "tldraw_export_snapshot",
    arguments: {
      canvasId,
      expectedRevision: revision + 2,
      format: "svg",
      byteLength: svg.byteLength,
      sha256: crypto.createHash("sha256").update(svg).digest("hex"),
      shapeCount: 1,
    },
  });
  assert.equal(exported.isError, undefined);
  assert.equal(exported.structuredContent.revision, revision + 2);
  assert.equal(exported.structuredContent.format, "svg");

  const appSha256 = crypto.createHash("sha256").update(app.text).digest("hex");
  const healthResponse = await fetch(healthEndpoint, {
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(healthResponse.ok, true);
  const health = await healthResponse.json();
  assert.equal(health.status, "ok");
  assert.equal(health.protocolVersion, "2026-07-28");
  assert.equal(health.tldraw?.officialUiVerified, true);
  assert.equal(appSha256, health.tldraw?.appHtmlSha256);

  console.log(
    JSON.stringify(
      {
        ok: true,
        endpoint,
        distribution: "independent-tldraw-mcp-app",
        protocolVersion: client.getNegotiatedProtocolVersion(),
        era: client.getProtocolEra(),
        appResource: {
          uri: openTool._meta.ui.resourceUri,
          mimeType: app.mimeType,
          bytes: Buffer.byteLength(app.text),
          sha256: appSha256,
        },
        toolVisibility: {
          modelAndApp: [openTool.name],
          appOnly: [applyTool.name, saveTool.name, exportTool.name],
        },
        stateRoundTrip: {
          canvasId,
          revisionBefore: revision,
          revisionAfterSave: saved.structuredContent.revision,
          exportReceipt: exported.structuredContent,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
