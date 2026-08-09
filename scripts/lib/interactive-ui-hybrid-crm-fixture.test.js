import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { verifyExtensionPackage } from '../../packages/web/server/lib/interactive-ui/package-format.js';
import {
  HYBRID_CRM_FIXTURE,
  createHybridCrmPackage,
  startHybridCrmApi,
} from './interactive-ui-hybrid-crm-fixture.mjs';

const temporaryDirectories = [];
const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('repository-owned hybrid CRM acceptance fixture', () => {
  it('builds a signed mixed OCIX without workspace-external sources or private keys', async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hybrid-crm-fixture-test-'));
    temporaryDirectories.push(temporaryRoot);
    const api = await startHybridCrmApi();
    servers.push(api);

    const packed = await createHybridCrmPackage({
      temporaryRoot,
      crmApiUrl: api.url,
      version: '1.3.0-test.1',
    });
    const verified = await verifyExtensionPackage({
      buffer: packed.buffer,
      allowEmbeddedPublisherKey: true,
      resolveTrustedPublisherKey: async () => null,
    });

    expect(verified.manifest.id).toBe(HYBRID_CRM_FIXTURE.extensionId);
    expect(verified.manifest.views.map((view) => view.runtime).sort()).toEqual(['declarative', 'native']);
    expect(verified.manifest.artifacts.map((artifact) => artifact.id)).toEqual([HYBRID_CRM_FIXTURE.artifactId]);
    expect(verified.agentRuntime.tools.map((tool) => tool.name).sort()).toEqual([...HYBRID_CRM_FIXTURE.toolNames].sort());
    expect(verified.agentRuntime.skills.map((skill) => skill.name)).toContain(HYBRID_CRM_FIXTURE.skillName);
    expect(packed.publisherKeys.privateKey).toContain('BEGIN PRIVATE KEY');
    expect(packed.buffer.includes(Buffer.from('BEGIN PRIVATE KEY'))).toBe(false);
  });

  it('provides full, readonly, and revoked Business Gateway behaviors', async () => {
    const api = await startHybridCrmApi();
    servers.push(api);
    const request = (pathname, key, body = {}) => fetch(`${api.url}${pathname}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const dashboardResponse = await request('/dashboard', api.keys.full);
    expect(dashboardResponse.status).toBe(200);
    const dashboard = await dashboardResponse.json();
    expect({ customers: dashboard.customerCount, opportunities: dashboard.openOpportunityCount })
      .toEqual({ customers: 4, opportunities: 4 });

    const readonlyResponse = await request('/opportunities/advance', api.keys.readonly, {
      opportunityId: 'OP-2001',
      revision: 4,
    });
    expect(readonlyResponse.status).toBe(403);

    const revokedResponse = await request('/dashboard', api.keys.revoked);
    expect(revokedResponse.status).toBe(401);
  });
});
