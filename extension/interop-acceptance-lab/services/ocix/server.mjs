import http from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_HOSTED_RELEASE_SLOT,
  HostedReleaseStateError,
  assertHostedReleaseAssets,
  readHostedReleaseState,
  resolveHostedRootAsset,
} from "./release-state.mjs";

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const MODE = process.env.MODE || "all";
const FIXED_TIME = "2026-07-28T00:00:00.000Z";
const HOSTED_ROOT =
  process.env.HOSTED_ASSET_ROOT ||
  join(fileURLToPath(new URL(".", import.meta.url)), "hosted-ops");
const HOSTED_RELEASE_STATE_FILE =
  process.env.HOSTED_RELEASE_STATE_FILE || "/data/active-release.json";

const readSecret = async (name, required = true) => {
  const direct = process.env[name]?.trim();
  if (direct) return direct;
  const filePath = process.env[`${name}_FILE`]?.trim();
  if (filePath) {
    const value = (await readFile(filePath, "utf8")).trim();
    if (value) return value;
  }
  if (required) throw new Error(`${name}_FILE is required`);
  return "";
};

const credentials = {
  crm:
    MODE === "local-crm" || MODE === "all"
      ? {
          write: await readSecret("LOCAL_CRM_API_KEY"),
          read: await readSecret("LOCAL_CRM_READ_ONLY_KEY", false),
        }
      : null,
  ops:
    MODE === "hosted-ops" || MODE === "all"
      ? {
          write: await readSecret("HOSTED_OPS_API_KEY"),
          read: await readSecret("HOSTED_OPS_READ_ONLY_KEY", false),
        }
      : null,
};

const crmStages = [
  { id: "lead", label: "Lead", probability: 0.1 },
  { id: "qualified", label: "Qualified", probability: 0.3 },
  { id: "proposal", label: "Proposal", probability: 0.55 },
  { id: "negotiation", label: "Negotiation", probability: 0.8 },
  { id: "won", label: "Won", probability: 1 },
];

const crm = {
  customers: [
    {
      id: "CUS-1001",
      name: "Star River Manufacturing",
      industry: "Advanced manufacturing",
      owner: "Lin Xiao",
      health: "healthy",
      healthLabel: "Healthy",
      healthTone: "success",
      contacts: [
        { id: "CON-101", name: "Chen Wei", title: "Digital transformation lead" },
        { id: "CON-102", name: "Wu Mei", title: "Procurement manager" },
      ],
    },
    {
      id: "CUS-1002",
      name: "Sea Breeze Retail",
      industry: "Retail",
      owner: "Zhou Ning",
      health: "attention",
      healthLabel: "Needs attention",
      healthTone: "warning",
      contacts: [{ id: "CON-201", name: "Zhao Min", title: "VP Operations" }],
    },
    {
      id: "CUS-1003",
      name: "Horizon Energy",
      industry: "Renewable energy",
      owner: "Chen Ke",
      health: "healthy",
      healthLabel: "Healthy",
      healthTone: "success",
      contacts: [{ id: "CON-301", name: "Qian Rui", title: "Program director" }],
    },
  ],
  opportunities: [
    {
      id: "OPP-2001",
      customerId: "CUS-1001",
      name: "Smart factory upgrade",
      value: 1680000,
      stage: "proposal",
      revision: 3,
    },
    {
      id: "OPP-2002",
      customerId: "CUS-1001",
      name: "Predictive maintenance",
      value: 620000,
      stage: "qualified",
      revision: 2,
    },
    {
      id: "OPP-2003",
      customerId: "CUS-1002",
      name: "Store analytics",
      value: 980000,
      stage: "negotiation",
      revision: 5,
    },
    {
      id: "OPP-2004",
      customerId: "CUS-1003",
      name: "Wind farm operations",
      value: 2350000,
      stage: "lead",
      revision: 1,
    },
  ],
  followUps: [],
};

const ops = {
  services: [
    {
      id: "SVC-GATEWAY",
      name: "API Gateway",
      team: "Platform",
      status: "healthy",
      statusLabel: "Healthy",
      statusTone: "success",
      availability: 0.9998,
      p50Ms: 28,
      p95Ms: 72,
    },
    {
      id: "SVC-PAYMENTS",
      name: "Payments",
      team: "Transactions",
      status: "incident",
      statusLabel: "Incident",
      statusTone: "error",
      availability: 0.9872,
      p50Ms: 92,
      p95Ms: 680,
    },
    {
      id: "SVC-ORDERS",
      name: "Orders",
      team: "Transactions",
      status: "degraded",
      statusLabel: "Degraded",
      statusTone: "warning",
      availability: 0.9961,
      p50Ms: 54,
      p95Ms: 240,
    },
    {
      id: "SVC-NOTIFY",
      name: "Notifications",
      team: "Customer experience",
      status: "healthy",
      statusLabel: "Healthy",
      statusTone: "success",
      availability: 0.9994,
      p50Ms: 44,
      p95Ms: 110,
    },
    {
      id: "SVC-DATABASE",
      name: "Transaction database",
      team: "Data infrastructure",
      status: "healthy",
      statusLabel: "Healthy",
      statusTone: "success",
      availability: 0.9999,
      p50Ms: 12,
      p95Ms: 35,
    },
  ],
  incidents: [
    {
      id: "INC-9001",
      serviceId: "SVC-PAYMENTS",
      title: "Payment-provider timeout",
      severity: "critical",
      severityLabel: "Critical",
      severityTone: "error",
      status: "open",
      statusLabel: "Open",
      revision: 3,
      openedAt: "2026-07-27T03:12:00.000Z",
    },
    {
      id: "INC-9002",
      serviceId: "SVC-ORDERS",
      title: "Order-index lag elevated",
      severity: "warning",
      severityLabel: "Warning",
      severityTone: "warning",
      status: "open",
      statusLabel: "Open",
      revision: 2,
      openedAt: "2026-07-27T04:05:00.000Z",
    },
  ],
  dependencies: [
    { source: "SVC-GATEWAY", target: "SVC-PAYMENTS", label: "checkout" },
    { source: "SVC-GATEWAY", target: "SVC-ORDERS", label: "orders" },
    { source: "SVC-PAYMENTS", target: "SVC-DATABASE", label: "transactions" },
    { source: "SVC-ORDERS", target: "SVC-DATABASE", label: "persistence" },
    { source: "SVC-ORDERS", target: "SVC-NOTIFY", label: "events" },
  ],
};

const clone = (value) => structuredClone(value);

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function authorize(request, credentialSet) {
  const authorization = request.headers.authorization || "";
  if (authorization === `Bearer ${credentialSet.write}`) {
    return { ok: true, write: true };
  }
  if (credentialSet.read && authorization === `Bearer ${credentialSet.read}`) {
    return { ok: true, write: false };
  }
  return { ok: false, write: false };
}

async function injectResponseFault(request, response, url) {
  const mode =
    request.headers["x-acceptance-inject"] ||
    url.searchParams.get("acceptanceFault");
  if (mode === "timeout") {
    await delay(16_000);
    return false;
  }
  if (mode === "invalid-json-response") {
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-acceptance-fault": mode,
    });
    response.end('{"truncated":');
    return true;
  }
  if (mode === "oversize-response") {
    sendJson(response, 200, {
      acceptanceFault: mode,
      padding: "x".repeat(2 * 1024 * 1024 + 1024),
    });
    return true;
  }
  return false;
}

function opportunityView(opportunity) {
  const index = crmStages.findIndex((candidate) => candidate.id === opportunity.stage);
  const stage = crmStages[Math.max(0, index)];
  const next = index >= 0 && index < crmStages.length - 1 ? crmStages[index + 1] : null;
  return {
    ...clone(opportunity),
    stageLabel: stage.label,
    stageTone:
      stage.id === "won" ? "success" : stage.id === "lead" ? "neutral" : "warning",
    probability: stage.probability,
    nextStage: next?.id || null,
    nextStageLabel: next?.label || null,
  };
}

function crmOverview() {
  const active = crm.opportunities.filter((item) => item.stage !== "won");
  return {
    updatedAt: FIXED_TIME,
    customerCount: crm.customers.length,
    activeOpportunityCount: active.length,
    pipelineValue: active.reduce((sum, item) => sum + item.value, 0),
    weightedForecast: active.reduce((sum, item) => {
      const stage = crmStages.find((candidate) => candidate.id === item.stage);
      return sum + item.value * (stage?.probability || 0);
    }, 0),
    pipeline: Object.fromEntries(
      crmStages.map((stage) => [
        stage.id,
        crm.opportunities.filter((item) => item.stage === stage.id).length,
      ]),
    ),
    customers: crm.customers.map((customer) => ({
      id: customer.id,
      name: customer.name,
      industry: customer.industry,
      owner: customer.owner,
      health: customer.health,
      pipelineValue: crm.opportunities
        .filter((item) => item.customerId === customer.id && item.stage !== "won")
        .reduce((sum, item) => sum + item.value, 0),
    })),
  };
}

function opsOverview() {
  return {
    updatedAt: FIXED_TIME,
    serviceCount: ops.services.length,
    healthyCount: ops.services.filter((item) => item.status === "healthy").length,
    openIncidentCount: ops.incidents.filter((item) => item.status === "open").length,
    availability:
      ops.services.reduce((sum, item) => sum + item.availability, 0) /
      ops.services.length,
    services: clone(ops.services),
    incidents: clone(ops.incidents),
    latencyTrend: Array.from({ length: 12 }, (_, index) => ({
      time: `${String(index * 5).padStart(2, "0")}:00`,
      minute: index * 5,
      p50: 34 + ((index * 7) % 26),
      p95: 104 + ((index * 31) % 180) + (index > 7 ? 110 : 0),
    })),
  };
}

function opsTopology() {
  const positions = {
    "SVC-GATEWAY": [120, 215],
    "SVC-PAYMENTS": [360, 120],
    "SVC-ORDERS": [360, 310],
    "SVC-DATABASE": [650, 120],
    "SVC-NOTIFY": [650, 310],
  };
  return {
    updatedAt: FIXED_TIME,
    nodes: ops.services.map((service) => ({
      ...clone(service),
      x: positions[service.id][0],
      y: positions[service.id][1],
    })),
    edges: clone(ops.dependencies),
  };
}

async function handleCrm(request, response, url) {
  const pathname = url.pathname.replace(
    /^\/local-crm\/api\/v1(?=\/|$)/,
    "/local-crm",
  );
  if (request.method === "GET" && pathname === "/local-crm/health") {
    sendJson(response, 200, {
      status: "ok",
      service: "openchamber-interop-local-crm",
      datasetRevision: 1,
    });
    return;
  }
  const auth = authorize(request, credentials.crm);
  if (!auth.ok) {
    sendJson(response, 401, { error: "unauthorized" });
    return;
  }
  if (await injectResponseFault(request, response, url)) return;

  if (request.method === "GET" && pathname === "/local-crm/customers") {
    sendJson(response, 200, {
      updatedAt: FIXED_TIME,
      customers: clone(crm.customers),
    });
    return;
  }
  const customerMatch = pathname.match(/^\/local-crm\/customers\/([^/]+)$/);
  if (request.method === "GET" && customerMatch) {
    const customer = crm.customers.find(
      (item) => item.id === decodeURIComponent(customerMatch[1]),
    );
    if (!customer) {
      sendJson(response, 404, { error: "customer_not_found" });
      return;
    }
    sendJson(response, 200, {
      updatedAt: FIXED_TIME,
      customer: clone(customer),
      opportunities: crm.opportunities
        .filter((item) => item.customerId === customer.id)
        .map(opportunityView),
    });
    return;
  }
  if (request.method === "GET" && pathname === "/local-crm/opportunities") {
    const customerId = url.searchParams.get("customerId");
    sendJson(response, 200, {
      updatedAt: FIXED_TIME,
      opportunities: crm.opportunities
        .filter((item) => !customerId || item.customerId === customerId)
        .map(opportunityView),
    });
    return;
  }
  const statusMatch = pathname.match(
    /^\/local-crm\/opportunities\/([^/]+)\/status$/,
  );
  if (request.method === "PATCH" && statusMatch) {
    if (!auth.write) {
      sendJson(response, 403, { error: "forbidden", reason: "read_only_key" });
      return;
    }
    const input = await readJson(request);
    const opportunity = crm.opportunities.find(
      (item) => item.id === decodeURIComponent(statusMatch[1]),
    );
    if (!opportunity) {
      sendJson(response, 404, { error: "opportunity_not_found" });
      return;
    }
    if (Number(input.revision) !== opportunity.revision) {
      sendJson(response, 409, {
        error: "revision_conflict",
        currentRevision: opportunity.revision,
      });
      return;
    }
    if (!crmStages.some((stage) => stage.id === input.status)) {
      sendJson(response, 400, { error: "invalid_status" });
      return;
    }
    opportunity.stage = input.status;
    opportunity.revision += 1;
    sendJson(response, 200, {
      updatedAt: FIXED_TIME,
      opportunity: opportunityView(opportunity),
    });
    return;
  }
  const followUpCustomerMatch = pathname.match(
    /^\/local-crm\/customers\/([^/]+)\/follow-ups$/,
  );
  if (
    request.method === "POST" &&
    (pathname === "/local-crm/follow-ups" || followUpCustomerMatch)
  ) {
    if (!auth.write) {
      sendJson(response, 403, { error: "forbidden", reason: "read_only_key" });
      return;
    }
    const input = await readJson(request);
    const customerId = followUpCustomerMatch
      ? decodeURIComponent(followUpCustomerMatch[1])
      : input.customerId;
    const customer = crm.customers.find((item) => item.id === customerId);
    if (!customer || typeof input.note !== "string" || !input.note.trim()) {
      sendJson(response, 400, { error: "invalid_follow_up" });
      return;
    }
    const followUp = {
      id: `FUP-${String(crm.followUps.length + 1).padStart(4, "0")}`,
      customerId: customer.id,
      note: input.note.trim().slice(0, 500),
      status: "open",
      revision: 1,
      createdAt: FIXED_TIME,
    };
    crm.followUps.push(followUp);
    sendJson(response, 201, { followUp: clone(followUp) });
    return;
  }
  if (request.method === "GET" && pathname === "/local-crm/overview") {
    sendJson(response, 200, crmOverview());
    return;
  }
  if (request.method === "GET" && pathname === "/local-crm/customer") {
    const customerId = url.searchParams.get("customerId");
    const customer = crm.customers.find((item) => item.id === customerId);
    if (!customer) {
      sendJson(response, 404, { error: "customer_not_found" });
      return;
    }
    sendJson(response, 200, {
      updatedAt: FIXED_TIME,
      customer: clone(customer),
      contacts: clone(customer.contacts),
      opportunities: crm.opportunities
        .filter((item) => item.customerId === customer.id)
        .map(opportunityView),
      pipelineValue: crm.opportunities
        .filter((item) => item.customerId === customer.id && item.stage !== "won")
        .reduce((sum, item) => sum + item.value, 0),
    });
    return;
  }
  if (request.method !== "POST") {
    sendJson(response, 404, { error: "not_found" });
    return;
  }
  const input = await readJson(request);
  if (pathname === "/local-crm/v1/overview") {
    sendJson(response, 200, crmOverview());
    return;
  }
  if (pathname === "/local-crm/v1/customer") {
    const customer = crm.customers.find((item) => item.id === input.customerId);
    if (!customer) {
      sendJson(response, 404, { error: "customer_not_found" });
      return;
    }
    sendJson(response, 200, {
      updatedAt: FIXED_TIME,
      customer: clone(customer),
      contacts: clone(customer.contacts),
      opportunities: crm.opportunities
        .filter((item) => item.customerId === customer.id)
        .map(opportunityView),
      pipelineValue: crm.opportunities
        .filter((item) => item.customerId === customer.id && item.stage !== "won")
        .reduce((sum, item) => sum + item.value, 0),
    });
    return;
  }
  if (
    pathname === "/local-crm/v1/opportunity/advance" ||
    pathname === "/local-crm/opportunity/advance"
  ) {
    if (!auth.write) {
      sendJson(response, 403, { error: "forbidden", reason: "read_only_key" });
      return;
    }
    const opportunity = crm.opportunities.find((item) => item.id === input.opportunityId);
    if (!opportunity) {
      sendJson(response, 404, { error: "opportunity_not_found" });
      return;
    }
    if (Number(input.revision) !== opportunity.revision) {
      sendJson(response, 409, {
        error: "revision_conflict",
        currentRevision: opportunity.revision,
      });
      return;
    }
    const index = crmStages.findIndex((item) => item.id === opportunity.stage);
    if (index >= crmStages.length - 1) {
      sendJson(response, 409, { error: "opportunity_already_final" });
      return;
    }
    opportunity.stage = crmStages[index + 1].id;
    opportunity.revision += 1;
    sendJson(response, 200, {
      updatedAt: FIXED_TIME,
      message: "Opportunity advanced",
      opportunity: opportunityView(opportunity),
    });
    return;
  }
  sendJson(response, 404, { error: "not_found" });
}

async function handleOpsApi(request, response, url) {
  const pathname = url.pathname.replace(
    /^\/hosted\/ops\/api\/v1(?=\/|$)/,
    "/hosted/ops",
  );
  if (request.method === "GET" && pathname === "/hosted/ops/health") {
    sendJson(response, 200, {
      status: "ok",
      service: "openchamber-interop-hosted-ops",
      datasetRevision: 1,
    });
    return;
  }
  const auth = authorize(request, credentials.ops);
  if (!auth.ok) {
    sendJson(response, 401, { error: "unauthorized" });
    return;
  }
  if (await injectResponseFault(request, response, url)) return;

  if (request.method === "GET" && pathname === "/hosted/ops/incidents") {
    sendJson(response, 200, {
      updatedAt: FIXED_TIME,
      incidents: clone(ops.incidents),
    });
    return;
  }
  const incidentMatch = pathname.match(/^\/hosted\/ops\/incidents\/([^/]+)$/);
  if (request.method === "GET" && incidentMatch) {
    const incident = ops.incidents.find(
      (item) => item.id === decodeURIComponent(incidentMatch[1]),
    );
    if (!incident) {
      sendJson(response, 404, { error: "incident_not_found" });
      return;
    }
    sendJson(response, 200, {
      updatedAt: FIXED_TIME,
      incident: clone(incident),
      incidents: [clone(incident)],
    });
    return;
  }
  const acknowledgeMatch = pathname.match(
    /^\/hosted\/ops\/incidents\/([^/]+)\/acknowledge$/,
  );
  if (request.method === "POST" && acknowledgeMatch) {
    if (!auth.write) {
      sendJson(response, 403, { error: "forbidden", reason: "read_only_key" });
      return;
    }
    const input = await readJson(request);
    const incident = ops.incidents.find(
      (item) => item.id === decodeURIComponent(acknowledgeMatch[1]),
    );
    if (!incident) {
      sendJson(response, 404, { error: "incident_not_found" });
      return;
    }
    if (Number(input.revision) !== incident.revision) {
      sendJson(response, 409, {
        error: "revision_conflict",
        currentRevision: incident.revision,
      });
      return;
    }
    incident.status = "acknowledged";
    incident.statusLabel = "Acknowledged";
    incident.revision += 1;
    sendJson(response, 200, { updatedAt: FIXED_TIME, incident: clone(incident) });
    return;
  }
  if (request.method === "GET" && pathname === "/hosted/ops/services") {
    sendJson(response, 200, opsOverview());
    return;
  }
  if (request.method === "GET" && pathname === "/hosted/ops/incident") {
    const incidentId = url.searchParams.get("incidentId");
    const incident = ops.incidents.find((item) => item.id === incidentId);
    if (!incident) {
      sendJson(response, 404, { error: "incident_not_found" });
      return;
    }
    sendJson(response, 200, {
      updatedAt: FIXED_TIME,
      incident: clone(incident),
      incidents: [clone(incident)],
    });
    return;
  }
  if (request.method === "GET" && pathname === "/hosted/ops/topology") {
    sendJson(response, 200, opsTopology());
    return;
  }
  if (
    request.method === "POST" &&
    pathname === "/hosted/ops/incidents/acknowledge"
  ) {
    if (!auth.write) {
      sendJson(response, 403, { error: "forbidden", reason: "read_only_key" });
      return;
    }
    const input = await readJson(request);
    const incident = ops.incidents.find((item) => item.id === input.incidentId);
    if (!incident) {
      sendJson(response, 404, { error: "incident_not_found" });
      return;
    }
    if (Number(input.revision) !== incident.revision) {
      sendJson(response, 409, {
        error: "revision_conflict",
        currentRevision: incident.revision,
      });
      return;
    }
    if (incident.status !== "open") {
      sendJson(response, 409, { error: "incident_already_acknowledged" });
      return;
    }
    incident.status = "acknowledged";
    incident.statusLabel = "Acknowledged";
    incident.revision += 1;
    sendJson(response, 200, { updatedAt: FIXED_TIME, incident: clone(incident) });
    return;
  }
  const serviceTopologyMatch = pathname.match(
    /^\/hosted\/ops\/services\/([^/]+)\/topology$/,
  );
  if (request.method === "GET" && serviceTopologyMatch) {
    const serviceId = decodeURIComponent(serviceTopologyMatch[1]);
    const service = ops.services.find((item) => item.id === serviceId);
    if (!service) {
      sendJson(response, 404, { error: "service_not_found" });
      return;
    }
    sendJson(response, 200, {
      updatedAt: FIXED_TIME,
      service: clone(service),
      topology: {
        nodes: clone(
          ops.services.filter(
            (item) =>
              item.id === serviceId ||
              ops.dependencies.some(
                (edge) =>
                  (edge.source === serviceId && edge.target === item.id) ||
                  (edge.target === serviceId && edge.source === item.id),
              ),
          ),
        ),
        edges: clone(
          ops.dependencies.filter(
            (edge) => edge.source === serviceId || edge.target === serviceId,
          ),
        ),
      },
    });
    return;
  }
  if (request.method !== "POST") {
    sendJson(response, 404, { error: "not_found" });
    return;
  }
  const input = await readJson(request);
  if (pathname === "/hosted/ops/v1/overview") {
    sendJson(response, 200, opsOverview());
    return;
  }
  if (pathname === "/hosted/ops/v1/service") {
    const service = ops.services.find((item) => item.id === input.serviceId);
    if (!service) {
      sendJson(response, 404, { error: "service_not_found" });
      return;
    }
    sendJson(response, 200, {
      updatedAt: FIXED_TIME,
      service: clone(service),
      incidents: clone(ops.incidents.filter((item) => item.serviceId === service.id)),
      dependencies: clone(
        ops.dependencies.filter(
          (edge) => edge.source === service.id || edge.target === service.id,
        ),
      ),
    });
    return;
  }
  if (pathname === "/hosted/ops/v1/topology") {
    sendJson(response, 200, opsTopology());
    return;
  }
  if (pathname === "/hosted/ops/v1/incident/acknowledge") {
    if (!auth.write) {
      sendJson(response, 403, { error: "forbidden", reason: "read_only_key" });
      return;
    }
    const incident = ops.incidents.find((item) => item.id === input.incidentId);
    if (!incident) {
      sendJson(response, 404, { error: "incident_not_found" });
      return;
    }
    if (Number(input.revision) !== incident.revision) {
      sendJson(response, 409, {
        error: "revision_conflict",
        currentRevision: incident.revision,
      });
      return;
    }
    if (incident.status !== "open") {
      sendJson(response, 409, { error: "incident_already_acknowledged" });
      return;
    }
    incident.status = "acknowledged";
    incident.statusLabel = "Acknowledged";
    incident.revision += 1;
    sendJson(response, 200, { updatedAt: FIXED_TIME, incident: clone(incident) });
    return;
  }
  sendJson(response, 404, { error: "not_found" });
}

const hostedStatic = new Map([
  [
    "/hosted/ops/remote-ops.ocix",
    ["remote-ops.ocix", "application/zip"],
  ],
]);

async function activeHostedRelease() {
  const state = await readHostedReleaseState({
    stateFile: HOSTED_RELEASE_STATE_FILE,
  });
  await assertHostedReleaseAssets({
    assetRoot: HOSTED_ROOT,
    slot: state.slot,
  });
  return state;
}

async function serveHostedStatic(response, pathname) {
  let definition;
  let selectedSlot;
  if (resolveHostedRootAsset(pathname, DEFAULT_HOSTED_RELEASE_SLOT)) {
    const active = await activeHostedRelease();
    selectedSlot = active.slot;
    const rootAsset = resolveHostedRootAsset(pathname, active.slot);
    definition = [
      rootAsset.relativePath,
      rootAsset.contentType,
      rootAsset.cacheControl,
    ];
  } else {
    definition = hostedStatic.get(pathname);
  }
  if (!definition) {
    const releaseMatch = pathname.match(
      /^\/hosted\/ops\/releases\/(1\.0\.0|1\.0\.1|1\.1\.0|tampered)\/(openchamber\.hosted\.json|resources\/(?:overview\.view\.json|incident-detail\.view\.json|topology\.html|interop_ops_open_overview\.ts|interop_ops_open_incident\.ts|interop_ops_open_topology\.ts|SKILL\.md))$/,
    );
    if (releaseMatch) {
      const relative = `releases/${releaseMatch[1]}/${releaseMatch[2]}`;
      const filename = releaseMatch[2];
      const contentType = filename.endsWith(".json")
        ? "application/json; charset=utf-8"
        : filename.endsWith(".html")
          ? "text/html; charset=utf-8"
          : filename.endsWith(".md")
            ? "text/markdown; charset=utf-8"
            : "text/plain; charset=utf-8";
      definition = [relative, contentType, "public, max-age=60"];
    }
  }
  if (!definition) return false;
  try {
    const body = await readFile(join(HOSTED_ROOT, definition[0]));
    response.writeHead(200, {
      "content-type": definition[1],
      "content-length": String(body.byteLength),
      "cache-control": definition[2] || "public, max-age=60",
      "x-content-type-options": "nosniff",
      ...(selectedSlot ? { "x-ocix-active-release": selectedSlot } : {}),
    });
    response.end(body);
  } catch {
    sendJson(response, 503, {
      error: "hosted_assets_missing",
      hint: "Run scripts/build-all.sh before building images",
    });
  }
  return true;
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/health") {
      const hostedRelease =
        MODE === "local-crm" ? null : await activeHostedRelease();
      sendJson(response, 200, {
        status: "ok",
        service:
          MODE === "local-crm"
            ? "oc-local-crm-api"
            : MODE === "hosted-ops"
              ? "oc-hosted-ocix-lab"
              : "openchamber-interop-ocix",
        mode: MODE,
        ...(hostedRelease
          ? {
              activeHostedRelease: {
                slot: hostedRelease.slot,
                version: hostedRelease.version,
                persisted: hostedRelease.persisted,
              },
            }
          : {}),
      });
      return;
    }
    if (
      MODE !== "local-crm" &&
      request.method === "GET" &&
      (await serveHostedStatic(response, url.pathname))
    ) {
      return;
    }
    if (MODE !== "hosted-ops" && url.pathname.startsWith("/local-crm/")) {
      await handleCrm(request, response, url);
      return;
    }
    if (MODE !== "local-crm" && url.pathname.startsWith("/hosted/ops/")) {
      await handleOpsApi(request, response, url);
      return;
    }
    sendJson(response, 404, { error: "not_found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof HostedReleaseStateError) {
      sendJson(response, 503, { error: "hosted_release_unavailable" });
    } else {
      sendJson(response, message === "request_too_large" ? 413 : 400, {
        error: "bad_request",
      });
    }
  }
});

server.listen(PORT, HOST, () => {
  console.error(`OCIX interop backend listening on ${HOST}:${PORT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
