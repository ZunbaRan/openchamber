#!/usr/bin/env node
import crypto from "node:crypto";
import {
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createExtensionPackage } from "../../../packages/web/server/lib/interactive-ui/package-format.js";

const labRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoot = join(labRoot, "hosted-ops", "source", "resources");
const outputRoot = join(labRoot, ".runtime", "generated", "hosted-ops");
const thinRoot = join(labRoot, ".runtime", "build", "hosted-ops-thin");
const privateKeyPath = join(labRoot, ".runtime", "keys", "publisher.private.pem");
const publicKeyPath = join(labRoot, ".runtime", "keys", "publisher.public.pem");
const publicBaseUrl = (
  process.env.PUBLIC_BASE_URL || "http://127.0.0.1:9510"
).replace(/\/+$/, "");
const publicUrl = new URL(publicBaseUrl);
if (
  !["http:", "https:"].includes(publicUrl.protocol) ||
  publicUrl.username ||
  publicUrl.password ||
  publicUrl.search ||
  publicUrl.hash ||
  publicUrl.pathname.includes("..")
) {
  throw new Error(
    "PUBLIC_BASE_URL must be an http(s) URL without credentials, query, fragment, or traversal",
  );
}
const remoteBaseUrl = `${publicBaseUrl}/hosted/ops`;
const publicOrigin = publicUrl.origin;
const publicGatePath = process.env.PUBLIC_GATE_PATH?.trim();
const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(
  publicUrl.hostname,
);
if (
  !loopback &&
  (!publicGatePath ||
    !/^interop-[a-f0-9]{24}$/.test(publicGatePath) ||
    publicUrl.pathname !== `/${publicGatePath}`)
) {
  throw new Error(
    "Remote PUBLIC_BASE_URL must end with the generated /<PUBLIC_GATE_PATH>",
  );
}
const extensionId = "com.openchamber.interop.hosted-ops";
const keyId = "interop-lab-2026";
const publisherId = "com.openchamber.interop.publisher";
const publisherName = "OpenChamber Interop Lab";

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

function sha256(value) {
  return `sha256-${crypto.createHash("sha256").update(value).digest("base64")}`;
}

function prepareResourceBody(definition, body, version) {
  if (definition.output !== "overview.view.json" || version === "1.0.0") {
    return body;
  }
  const view = JSON.parse(body.toString("utf8"));
  view.title = `${view.title} · ${version}`;
  return Buffer.from(`${JSON.stringify(view, null, 2)}\n`);
}

const resourceDefinitions = [
  {
    source: "overview.view.json",
    output: "overview.view.json",
    path: "ui/declarative/overview.view.json",
    mimeType: "application/json",
  },
  {
    source: "incident-detail.view.json",
    output: "incident-detail.view.json",
    path: "ui/declarative/incident-detail.view.json",
    mimeType: "application/json",
  },
  {
    source: "topology.html",
    output: "topology.html",
    path: "ui/artifacts/topology.html",
    mimeType: "text/html",
  },
];

const actionIds = [
  `${extensionId}.overview.query`,
  `${extensionId}.incident.query`,
  `${extensionId}.topology.query`,
  `${extensionId}.incident.acknowledge`,
];
const agentToolNames = [
  "interop_ops_open_overview",
  "interop_ops_open_incident",
  "interop_ops_open_topology",
];

function makePermissions(expanded = false) {
  return {
    resourceOrigins: [publicOrigin],
    networkOrigins: [publicOrigin],
    externalLinkOrigins: [],
    credentialScopes: ["ops.read", "ops.write"],
    actionIds,
    agentToolNames,
    clipboard: expanded,
    popups: false,
  };
}

function makeExtension(version) {
  return {
    $schema: "openchamber://extension/v1",
    id: extensionId,
    name: "Hosted OCIX Remote Ops Lab",
    shortName: "Hosted Ops",
    version,
    publisher: publisherName,
    agentRouting: {
      domain: "interop_ops",
      intents: [
        "interop_ops.overview",
        "interop_ops.incident.view",
        "interop_ops.incident.acknowledge",
        "interop_ops.topology",
      ],
      examples: {
        en: [
          "Open the hosted operations overview",
          "Open incident INC-9001",
          "Show the payments service topology",
          "Acknowledge incident INC-9001",
        ],
      },
      dataAuthority: "connected-business-system",
    },
    connectors: [
      {
        id: "ops-api",
        type: "http",
        baseUrl: publicBaseUrl,
        auth: {
          type: "api-key",
          placement: {
            type: "header",
            name: "Authorization",
            prefix: "Bearer ",
          },
        },
        test: { method: "GET", path: "/health/hosted-ocix" },
      },
    ],
    views: [
      {
        id: `${extensionId}.overview`,
        title: "Hosted operations overview",
        runtime: "declarative",
        entry: "ui/declarative/overview.view.json",
        tools: ["interop_ops_open_overview"],
        routing: {
          intents: ["interop_ops.overview"],
          priority: 92,
          operation: "read",
        },
        displayModes: ["inline", "workspace", "fullscreen"],
        dashboard: {
          description: "Signed remote service health, SLO, latency, and incidents.",
          inputSchema: {
            type: "object",
            properties: {
              environment: { type: "string", minLength: 1, maxLength: 40 },
            },
            required: ["environment"],
          },
          defaultContext: { environment: "production" },
          layout: {
            columns: 6,
            rows: 8,
            minColumns: 4,
            maxColumns: 12,
            minRows: 4,
            maxRows: 16,
            overflow: "auto",
          },
          instances: "byContext",
          refresh: {
            mode: "interval",
            minimumIntervalSeconds: 30,
            intervalSeconds: 60,
          },
          events: {
            emits: [
              {
                id: "service.selected",
                payloadSchema: {
                  type: "object",
                  properties: {
                    serviceId: { type: "string", minLength: 1, maxLength: 80 },
                  },
                  required: ["serviceId"],
                },
              },
              {
                id: "incident.selected",
                payloadSchema: {
                  type: "object",
                  properties: {
                    incidentId: { type: "string", minLength: 1, maxLength: 80 },
                  },
                  required: ["incidentId"],
                },
              },
            ],
            accepts: [],
          },
          popout: { supported: true },
        },
      },
      {
        id: `${extensionId}.incident-detail`,
        title: "Hosted incident detail",
        runtime: "declarative",
        entry: "ui/declarative/incident-detail.view.json",
        tools: ["interop_ops_open_incident"],
        routing: {
          intents: [
            "interop_ops.incident.view",
            "interop_ops.incident.acknowledge",
          ],
          priority: 96,
          operation: "mixed",
        },
        displayModes: ["inline", "workspace"],
        dashboard: {
          description:
            "One authoritative incident with revision-checked acknowledgement.",
          inputSchema: {
            type: "object",
            properties: {
              environment: { type: "string", minLength: 1, maxLength: 40 },
              incidentId: { type: "string", minLength: 1, maxLength: 80 },
            },
            required: ["environment", "incidentId"],
          },
          defaultContext: { environment: "production" },
          layout: {
            columns: 6,
            rows: 6,
            minColumns: 4,
            maxColumns: 12,
            minRows: 4,
            maxRows: 14,
            overflow: "auto",
          },
          instances: "byContext",
          refresh: { mode: "manual", minimumIntervalSeconds: 30 },
          events: {
            emits: [],
            accepts: ["incident.selected"],
          },
          popout: { supported: false },
        },
      },
    ],
    artifacts: [
      {
        id: `${extensionId}.topology`,
        title: "Hosted service topology",
        entry: "ui/artifacts/topology.html",
        tools: ["interop_ops_open_topology"],
        routing: {
          intents: ["interop_ops.topology"],
          priority: 90,
          operation: "read",
        },
        displayModes: ["inline", "workspace", "fullscreen"],
        inlineHeight: 560,
        capabilities: {
          scripts: true,
          businessActions: [`${extensionId}.topology.query`],
        },
        dashboard: {
          description: "Signed remote interactive service dependency topology.",
          inputSchema: {
            type: "object",
            properties: {
              environment: { type: "string", minLength: 1, maxLength: 40 },
              serviceId: { type: "string", minLength: 1, maxLength: 80 },
            },
            required: ["environment"],
          },
          defaultContext: { environment: "production" },
          layout: {
            columns: 6,
            rows: 8,
            minColumns: 4,
            maxColumns: 12,
            minRows: 5,
            maxRows: 18,
            overflow: "auto",
          },
          instances: "byContext",
          refresh: { mode: "manual", minimumIntervalSeconds: 30 },
          events: {
            emits: [
              {
                id: "service.selected",
                payloadSchema: {
                  type: "object",
                  properties: {
                    serviceId: { type: "string", minLength: 1, maxLength: 80 },
                  },
                  required: ["serviceId"],
                },
              },
            ],
            accepts: [],
          },
          popout: { supported: true },
        },
      },
    ],
    links: [
      {
        id: "overview-incident-to-detail",
        from: `${extensionId}.overview`,
        event: "incident.selected",
        to: `${extensionId}.incident-detail`,
        map: {
          environment: "$source.context.environment",
          incidentId: "$event.payload.incidentId",
        },
        relationship: "incident",
        placement: "adjacent",
      },
    ],
    actions: [
      {
        id: `${extensionId}.overview.query`,
        connector: "ops-api",
        risk: "read",
        permission: "allow",
        request: { method: "GET", path: "/api/v1/services" },
      },
      {
        id: `${extensionId}.incident.query`,
        connector: "ops-api",
        risk: "read",
        permission: "allow",
        request: { method: "GET", path: "/api/v1/incident" },
      },
      {
        id: `${extensionId}.topology.query`,
        connector: "ops-api",
        risk: "read",
        permission: "allow",
        request: { method: "GET", path: "/api/v1/topology" },
      },
      {
        id: `${extensionId}.incident.acknowledge`,
        connector: "ops-api",
        risk: "write",
        permission: "ask",
        request: { method: "POST", path: "/api/v1/incidents/acknowledge" },
        confirmation: {
          title: "Acknowledge this incident?",
          description:
            "This changes incident state in the connected operations system.",
        },
      },
    ],
    permissions: { network: [publicOrigin] },
    trust: { mode: "declarative", signature: "hosted-release" },
  };
}

const privateKeyPem = await readFile(privateKeyPath, "utf8");
const privateKey = crypto.createPrivateKey(privateKeyPem);

function signManifest(unsignedManifest) {
  const value = crypto
    .sign(
      null,
      Buffer.from(JSON.stringify(canonicalize(unsignedManifest))),
      privateKey,
    )
    .toString("base64");
  return {
    ...unsignedManifest,
    signature: {
      algorithm: "ed25519",
      keyId,
      value,
    },
  };
}

async function writeRelease({
  directory,
  assetBaseUrl,
  slot,
  version,
  publishedAt,
  expanded = false,
  tamper = false,
}) {
  const resourcesRoot = join(directory, "resources");
  await mkdir(resourcesRoot, { recursive: true });
  const resources = [];
  for (const definition of resourceDefinitions) {
    const sourceBody = await readFile(join(sourceRoot, definition.source));
    const body = prepareResourceBody(definition, sourceBody, version);
    await writeFile(join(resourcesRoot, definition.output), body);
    resources.push({
      path: definition.path,
      url: `${assetBaseUrl}/resources/${definition.output}`,
      mimeType: definition.mimeType,
      sha256: sha256(body),
    });
  }
  const permissions = makePermissions(expanded);
  const unsignedManifest = {
    $schema: "openchamber://hosted-ocix-manifest/v1",
    app: { id: extensionId, version, publishedAt },
    permissions,
    extension: makeExtension(version),
    resources,
  };
  const manifest = signManifest(unsignedManifest);
  await writeFile(
    join(directory, "openchamber.hosted.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  if (tamper) {
    const target = join(resourcesRoot, "topology.html");
    const original = await readFile(target);
    await writeFile(
      target,
      Buffer.concat([
        original,
        Buffer.from("\n<!-- negative fixture: mutated after signing -->\n"),
      ]),
    );
  }
  return {
    slot,
    version,
    publishedAt,
    manifestUrl: `${assetBaseUrl}/openchamber.hosted.json`,
    permissions,
    permissionDigest: sha256(
      Buffer.from(JSON.stringify(canonicalize(permissions))),
    ),
    resourceCount: resources.length,
    tamperedAfterSigning: tamper,
  };
}

await rm(outputRoot, { recursive: true, force: true });
await rm(thinRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await mkdir(thinRoot, { recursive: true });

const baselinePermissions = makePermissions(false);
const rootRelease = await writeRelease({
  directory: outputRoot,
  assetBaseUrl: remoteBaseUrl,
  slot: "root",
  version: "1.0.0",
  publishedAt: "2026-07-28T00:00:00.000Z",
});
const releaseSpecs = [
  {
    slot: "1.0.0",
    version: "1.0.0",
    publishedAt: "2026-07-28T00:00:00.000Z",
  },
  {
    slot: "1.0.1",
    version: "1.0.1",
    publishedAt: "2026-07-29T00:00:00.000Z",
  },
  {
    slot: "1.1.0",
    version: "1.1.0",
    publishedAt: "2026-07-30T00:00:00.000Z",
    expanded: true,
  },
  {
    slot: "tampered",
    version: "1.0.0",
    publishedAt: "2026-07-28T00:00:00.000Z",
    tamper: true,
  },
];
const releases = [];
for (const spec of releaseSpecs) {
  const directory = join(outputRoot, "releases", spec.slot);
  const assetBaseUrl = `${remoteBaseUrl}/releases/${spec.slot}`;
  releases.push(
    await writeRelease({
      directory,
      assetBaseUrl,
      ...spec,
    }),
  );
}
const channels = [];
for (const spec of releaseSpecs) {
  const directory = join(outputRoot, "channels", spec.slot);
  channels.push(
    await writeRelease({
      directory,
      assetBaseUrl: remoteBaseUrl,
      ...spec,
    }),
  );
}

await writeFile(
  join(thinRoot, "openchamber.extension.json"),
  `${JSON.stringify(
    {
      $schema: "openchamber://extension/v1",
      id: extensionId,
      name: "Hosted OCIX Remote Ops Lab",
      shortName: "Hosted Ops",
      version: "1.0.0",
      publisher: publisherName,
      delivery: {
        type: "hosted",
        manifestUrl: `${remoteBaseUrl}/openchamber.hosted.json`,
        ttlSeconds: 60,
        minimumRuntimeVersion: "1.16.3",
        initialPermissions: baselinePermissions,
      },
      permissions: { network: [] },
      trust: { mode: "declarative", signature: "hosted-release" },
    },
    null,
    2,
  )}\n`,
);

const packageResult = await createExtensionPackage({
  extensionDirectory: thinRoot,
  privateKey: privateKeyPem,
  publisherId,
  publisherName,
  keyId,
  createdAt: "2026-07-28T00:00:00.000Z",
});
await writeFile(join(outputRoot, "remote-ops.ocix"), packageResult.buffer);
await writeFile(
  join(outputRoot, "build-metadata.json"),
  `${JSON.stringify(
    {
      extensionId,
      thinPackageVersion: "1.0.0",
      publicBaseUrl,
      rootRelease,
      releases,
      channels,
      acceptance: {
        stableManifestUrl: `${remoteBaseUrl}/openchamber.hosted.json`,
        administrableSlots: releaseSpecs.map((spec) => spec.slot),
        defaultSlot: "1.0.0",
        permissionEquivalent: ["1.0.0", "1.0.1"],
        permissionExpanded: "1.1.0",
        tamperedNegativeFixture: "tampered",
      },
      publisher: {
        id: publisherId,
        name: publisherName,
        keyId,
        publicKeySha256: crypto
          .createHash("sha256")
          .update(await readFile(publicKeyPath))
          .digest("hex"),
      },
    },
    null,
    2,
  )}\n`,
);
console.log(
  `Signed Hosted OCIX baseline, compatible patch, expanded minor, and tampered fixture in ${outputRoot}`,
);
