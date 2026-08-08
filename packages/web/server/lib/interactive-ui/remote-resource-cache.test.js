import { describe, expect, it } from 'bun:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {
  REMOTE_RESOURCE_CACHE_SCHEMA,
  REMOTE_RESOURCE_TTL_MS,
  createRemoteResourceCache,
  remoteResourceCacheKey,
} from './remote-resource-cache.js';

const EXTENSION_ID = 'com.acme.remote';

const sha256 = (value) => `sha256-${crypto.createHash('sha256').update(value).digest('base64')}`;

const resource = ({ path: resourcePath = 'ui/overview.view.json', bytes = Buffer.from('{"layout":{"type":"text"}}'), mimeType = 'application/json' } = {}) => ({
  path: resourcePath,
  url: `https://apps.example.com/${resourcePath}`,
  mimeType,
  bytes,
  sha256: sha256(bytes),
});

const okResponse = (bytes, mimeType = 'application/json') => new Response(bytes, {
  status: 200,
  headers: { 'content-type': mimeType },
});

// Builds a full well-formed stored entry for the injected cacheStore test
// seam. size is always exactly bytes.length; expiresAt = cachedAt + ttlMs.
const makeEntry = ({
  key,
  extensionId = EXTENSION_ID,
  path: resourcePath,
  bytes,
  sha256: resourceSha256 = sha256(bytes),
  manifestHash,
  cachedAt,
}) => ({
  $schema: REMOTE_RESOURCE_CACHE_SCHEMA,
  key,
  extensionId,
  path: resourcePath,
  url: `https://apps.example.com/${resourcePath}`,
  mimeType: 'application/json',
  sha256: resourceSha256,
  manifestHash,
  bytes: Buffer.from(bytes),
  size: bytes.length,
  cachedAt,
  expiresAt: cachedAt + REMOTE_RESOURCE_TTL_MS,
});

describe('Remote OCIX in-memory resource cache (revision 24 contract)', () => {
  it('exposes only resolve and clearExtension (no store seam in the public API)', () => {
    const cache = createRemoteResourceCache({
      fetchImpl: async () => { throw new Error('offline'); },
    });
    expect(Object.keys(cache).sort()).toEqual(['clearExtension', 'resolve']);
  });

  it('serves an exact-key TTL hit without fetching and returns per-caller copies', async () => {
    const store = new Map();
    const view = resource();
    const manifestHash = sha256(Buffer.from('manifest-v1'));
    const key = remoteResourceCacheKey(crypto, {
      extensionId: EXTENSION_ID,
      path: view.path,
      sha256: view.sha256,
      manifestHash,
    });
    let offline = false;
    let fetches = 0;
    const cache = createRemoteResourceCache({
      fetchImpl: async () => {
        fetches += 1;
        if (offline) throw new Error('offline');
        return okResponse(view.bytes);
      },
      now: () => 1_000_000,
      cacheStore: store,
    });
    const first = await cache.resolve({ extensionId: EXTENSION_ID, resource: view, manifestHash });
    expect(first.equals(view.bytes)).toBe(true);
    offline = true;
    const second = await cache.resolve({ extensionId: EXTENSION_ID, resource: view, manifestHash });
    expect(second.equals(view.bytes)).toBe(true);
    expect(fetches).toBe(1);
    // Per-caller copies: different object identities, never the stored Buffer.
    expect(first).not.toBe(second);
    const stored = store.get(key).bytes;
    expect(first).not.toBe(stored);
    expect(second).not.toBe(stored);
    // Mutating one caller's buffer cannot corrupt the other or the store.
    first[0] ^= 0xff;
    expect(second.equals(view.bytes)).toBe(true);
    expect(stored.equals(view.bytes)).toBe(true);
    // The exact TTL window is enforced from the stored expiresAt.
    expect(store.get(key).expiresAt).toBe(store.get(key).cachedAt + REMOTE_RESOURCE_TTL_MS);
  });

  it('deletes expired entries and hard-fails offline (one store, mutable clock)', async () => {
    const store = new Map();
    const view = resource();
    const manifestHash = sha256(Buffer.from('manifest-v1'));
    const key = remoteResourceCacheKey(crypto, {
      extensionId: EXTENSION_ID,
      path: view.path,
      sha256: view.sha256,
      manifestHash,
    });
    let clock = 1_000_000;
    let offline = false;
    const cache = createRemoteResourceCache({
      fetchImpl: async () => {
        if (offline) throw new Error('offline');
        return okResponse(view.bytes);
      },
      now: () => clock,
      cacheStore: store,
    });
    // Populate online; cachedAt is taken AFTER the verified fetch completes.
    await cache.resolve({ extensionId: EXTENSION_ID, resource: view, manifestHash });
    expect(store.has(key)).toBe(true);
    offline = true;
    // Unexpired in-memory bytes are still served offline.
    expect((await cache.resolve({ extensionId: EXTENSION_ID, resource: view, manifestHash }))
      .equals(view.bytes)).toBe(true);
    // Advance beyond expiresAt: the entry is deleted and the offline refetch
    // fails hard and sanitized (never stale bytes).
    clock = 1_000_000 + REMOTE_RESOURCE_TTL_MS + 1;
    await expect(cache.resolve({ extensionId: EXTENSION_ID, resource: view, manifestHash }))
      .rejects.toMatchObject({ code: 'hosted_resource_unavailable' });
    expect(store.has(key)).toBe(false);
    // An offline uncached miss also fails hard.
    await expect(cache.resolve({ extensionId: EXTENSION_ID, resource: view, manifestHash }))
      .rejects.toMatchObject({ code: 'hosted_resource_unavailable' });
    expect(store.size).toBe(0);
  });

  it('deletes a future-dated entry only for its key and keeps unrelated valid entries resolvable', async () => {
    const store = new Map();
    const manifestHash = sha256(Buffer.from('manifest-v1'));
    const valid = resource({ path: 'ui/valid.view.json', bytes: Buffer.from('{"valid":true}') });
    const future = resource({ path: 'ui/future.view.json', bytes: Buffer.from('{"future":true}') });
    const validKey = remoteResourceCacheKey(crypto, {
      extensionId: EXTENSION_ID, path: valid.path, sha256: valid.sha256, manifestHash,
    });
    const futureKey = remoteResourceCacheKey(crypto, {
      extensionId: EXTENSION_ID, path: future.path, sha256: future.sha256, manifestHash,
    });
    store.set(validKey, makeEntry({ key: validKey, path: valid.path, bytes: valid.bytes, manifestHash, cachedAt: 900_000 }));
    // Future-dated: cachedAt AFTER the current clock (any negative age invalid).
    store.set(futureKey, makeEntry({ key: futureKey, path: future.path, bytes: future.bytes, manifestHash, cachedAt: 1_000_010 }));
    const cache = createRemoteResourceCache({
      fetchImpl: async () => { throw new Error('offline'); },
      now: () => 1_000_000,
      cacheStore: store,
    });
    await expect(cache.resolve({ extensionId: EXTENSION_ID, resource: future, manifestHash }))
      .rejects.toMatchObject({ code: 'hosted_resource_unavailable' });
    expect(store.has(futureKey)).toBe(false);
    // The unrelated valid entry still resolves offline.
    expect((await cache.resolve({ extensionId: EXTENSION_ID, resource: valid, manifestHash }))
      .equals(valid.bytes)).toBe(true);
    expect(store.has(validKey)).toBe(true);
    expect(store.size).toBe(1);
  });

  it('deletes tampered bytes only for that key and keeps unrelated entries resolvable', async () => {
    const store = new Map();
    const manifestHash = sha256(Buffer.from('manifest-v1'));
    const first = resource({ path: 'ui/first.view.json', bytes: Buffer.from('{"first":true}') });
    const second = resource({ path: 'ui/second.view.json', bytes: Buffer.from('{"second":true}') });
    const firstKey = remoteResourceCacheKey(crypto, {
      extensionId: EXTENSION_ID, path: first.path, sha256: first.sha256, manifestHash,
    });
    const secondKey = remoteResourceCacheKey(crypto, {
      extensionId: EXTENSION_ID, path: second.path, sha256: second.sha256, manifestHash,
    });
    let offline = false;
    const cache = createRemoteResourceCache({
      fetchImpl: async (url) => {
        if (offline) throw new Error('offline');
        const value = String(url);
        if (value.endsWith('/ui/first.view.json')) return okResponse(first.bytes);
        if (value.endsWith('/ui/second.view.json')) return okResponse(second.bytes);
        return new Response('not found', { status: 404 });
      },
      now: () => 1_000_000,
      cacheStore: store,
    });
    // Populate BOTH keys online (each resolve fetches its own resource).
    await cache.resolve({ extensionId: EXTENSION_ID, resource: first, manifestHash });
    await cache.resolve({ extensionId: EXTENSION_ID, resource: second, manifestHash });
    // Tamper only the first entry's bytes (size kept consistent: the re-hash
    // on the next hit must be what fails).
    const tampered = store.get(firstKey);
    tampered.bytes = Buffer.from('tampered bytes');
    tampered.size = tampered.bytes.length;
    offline = true;
    await expect(cache.resolve({ extensionId: EXTENSION_ID, resource: first, manifestHash }))
      .rejects.toMatchObject({ code: 'hosted_resource_unavailable' });
    expect(store.has(firstKey)).toBe(false);
    // The unrelated second entry still resolves offline.
    expect((await cache.resolve({ extensionId: EXTENSION_ID, resource: second, manifestHash }))
      .equals(second.bytes)).toBe(true);
    expect(store.has(secondKey)).toBe(true);
  });

  it('deletes malformed entries (non-record and missing size) per key without blocking', async () => {
    const store = new Map();
    const manifestHash = sha256(Buffer.from('manifest-v1'));
    const valid = resource({ path: 'ui/valid.view.json', bytes: Buffer.from('{"valid":true}') });
    const stringy = resource({ path: 'ui/stringy.view.json', bytes: Buffer.from('{"stringy":true}') });
    const nosize = resource({ path: 'ui/nosize.view.json', bytes: Buffer.from('{"nosize":true}') });
    const validKey = remoteResourceCacheKey(crypto, {
      extensionId: EXTENSION_ID, path: valid.path, sha256: valid.sha256, manifestHash,
    });
    const stringyKey = remoteResourceCacheKey(crypto, {
      extensionId: EXTENSION_ID, path: stringy.path, sha256: stringy.sha256, manifestHash,
    });
    const nosizeKey = remoteResourceCacheKey(crypto, {
      extensionId: EXTENSION_ID, path: nosize.path, sha256: nosize.sha256, manifestHash,
    });
    store.set(stringyKey, 'malformed');
    const missingSize = makeEntry({ key: nosizeKey, path: nosize.path, bytes: nosize.bytes, manifestHash, cachedAt: 900_000 });
    delete missingSize.size;
    store.set(nosizeKey, missingSize);
    store.set(validKey, makeEntry({ key: validKey, path: valid.path, bytes: valid.bytes, manifestHash, cachedAt: 900_000 }));
    const cache = createRemoteResourceCache({
      fetchImpl: async () => { throw new Error('offline'); },
      now: () => 1_000_000,
      cacheStore: store,
    });
    await expect(cache.resolve({ extensionId: EXTENSION_ID, resource: stringy, manifestHash }))
      .rejects.toMatchObject({ code: 'hosted_resource_unavailable' });
    expect(store.has(stringyKey)).toBe(false);
    await expect(cache.resolve({ extensionId: EXTENSION_ID, resource: nosize, manifestHash }))
      .rejects.toMatchObject({ code: 'hosted_resource_unavailable' });
    expect(store.has(nosizeKey)).toBe(false);
    // Unrelated valid entry still resolves; only the two bad keys were removed.
    expect((await cache.resolve({ extensionId: EXTENSION_ID, resource: valid, manifestHash }))
      .equals(valid.bytes)).toBe(true);
    expect(store.size).toBe(1);
    expect(store.has(validKey)).toBe(true);
  });

  it('deletes an entry whose metadata mismatches the requested key binding', async () => {
    const store = new Map();
    const manifestHash = sha256(Buffer.from('manifest-v1'));
    const mismatched = resource({ path: 'ui/mismatch.view.json', bytes: Buffer.from('{"mismatch":true}') });
    const valid = resource({ path: 'ui/valid.view.json', bytes: Buffer.from('{"valid":true}') });
    const mismatchKey = remoteResourceCacheKey(crypto, {
      extensionId: EXTENSION_ID, path: mismatched.path, sha256: mismatched.sha256, manifestHash,
    });
    const validKey = remoteResourceCacheKey(crypto, {
      extensionId: EXTENSION_ID, path: valid.path, sha256: valid.sha256, manifestHash,
    });
    const wrongEntry = makeEntry({ key: mismatchKey, path: mismatched.path, bytes: mismatched.bytes, manifestHash, cachedAt: 900_000 });
    wrongEntry.manifestHash = sha256(Buffer.from('some-other-manifest'));
    store.set(mismatchKey, wrongEntry);
    store.set(validKey, makeEntry({ key: validKey, path: valid.path, bytes: valid.bytes, manifestHash, cachedAt: 900_000 }));
    const cache = createRemoteResourceCache({
      fetchImpl: async () => { throw new Error('offline'); },
      now: () => 1_000_000,
      cacheStore: store,
    });
    await expect(cache.resolve({ extensionId: EXTENSION_ID, resource: mismatched, manifestHash }))
      .rejects.toMatchObject({ code: 'hosted_resource_unavailable' });
    expect(store.has(mismatchKey)).toBe(false);
    expect((await cache.resolve({ extensionId: EXTENSION_ID, resource: valid, manifestHash }))
      .equals(valid.bytes)).toBe(true);
    expect(store.size).toBe(1);
  });

  it('evicts TRUE oldest entries (by cachedAt, not Map insertion order) within the byte budget', async () => {
    const store = new Map();
    const manifestHash = sha256(Buffer.from('manifest-v1'));
    // 8-byte payloads; budget 20 -> exactly two of the three fit.
    const a = resource({ path: 'ui/a.view.json', bytes: Buffer.from('AAAAAAAA') });
    const b = resource({ path: 'ui/b.view.json', bytes: Buffer.from('BBBBBBBB') });
    const c = resource({ path: 'ui/c.view.json', bytes: Buffer.from('CCCCCCCC') });
    const keyA = remoteResourceCacheKey(crypto, {
      extensionId: EXTENSION_ID, path: a.path, sha256: a.sha256, manifestHash,
    });
    const keyB = remoteResourceCacheKey(crypto, {
      extensionId: EXTENSION_ID, path: b.path, sha256: b.sha256, manifestHash,
    });
    const keyC = remoteResourceCacheKey(crypto, {
      extensionId: EXTENSION_ID, path: c.path, sha256: c.sha256, manifestHash,
    });
    // Insertion order is B then A, but the OLDEST cachedAt is A: true
    // oldest-first eviction must remove A, never B.
    store.set(keyB, makeEntry({ key: keyB, path: b.path, bytes: b.bytes, manifestHash, cachedAt: 900_000 }));
    store.set(keyA, makeEntry({ key: keyA, path: a.path, bytes: a.bytes, manifestHash, cachedAt: 100_000 }));
    const cache = createRemoteResourceCache({
      fetchImpl: async () => okResponse(c.bytes),
      now: () => 1_000_000,
      cacheStore: store,
      maxEntries: 10,
      maxTotalBytes: 20,
    });
    await cache.resolve({ extensionId: EXTENSION_ID, resource: c, manifestHash });
    expect(store.has(keyA)).toBe(false);
    expect(store.has(keyB)).toBe(true);
    expect(store.has(keyC)).toBe(true);
    expect(store.size).toBe(2);
    // Exact byte bound holds after insertion.
    const totalBytes = [...store.values()].reduce((sum, entry) => sum + entry.size, 0);
    expect(totalBytes).toBe(16);
  });

  it('a malformed entry with a missing/non-numeric size never poisons subsequent accounting', async () => {
    const store = new Map();
    const manifestHash = sha256(Buffer.from('manifest-v1'));
    const a = resource({ path: 'ui/a.view.json', bytes: Buffer.from('AAAAAAAA') });
    const b = resource({ path: 'ui/b.view.json', bytes: Buffer.from('BBBBBBBB') });
    const c = resource({ path: 'ui/c.view.json', bytes: Buffer.from('CCCCCCCC') });
    const keyA = remoteResourceCacheKey(crypto, {
      extensionId: EXTENSION_ID, path: a.path, sha256: a.sha256, manifestHash,
    });
    const keyB = remoteResourceCacheKey(crypto, {
      extensionId: EXTENSION_ID, path: b.path, sha256: b.sha256, manifestHash,
    });
    const keyC = remoteResourceCacheKey(crypto, {
      extensionId: EXTENSION_ID, path: c.path, sha256: c.sha256, manifestHash,
    });
    const badKey = remoteResourceCacheKey(crypto, {
      extensionId: EXTENSION_ID, path: 'ui/bad.view.json', sha256: sha256(Buffer.from('x')), manifestHash,
    });
    // Malformed entry with a HUGE buffer and NO size: if its size were trusted
    // (undefined/NaN arithmetic) the 24-byte budget would evict everything.
    const malformed = makeEntry({ key: badKey, path: 'ui/bad.view.json', bytes: Buffer.alloc(10_000), manifestHash, cachedAt: 900_000 });
    delete malformed.size;
    store.set(badKey, malformed);
    store.set(keyA, makeEntry({ key: keyA, path: a.path, bytes: a.bytes, manifestHash, cachedAt: 998_000 }));
    store.set(keyB, makeEntry({ key: keyB, path: b.path, bytes: b.bytes, manifestHash, cachedAt: 999_000 }));
    const cache = createRemoteResourceCache({
      fetchImpl: async () => okResponse(c.bytes),
      now: () => 1_000_000,
      cacheStore: store,
      maxEntries: 10,
      maxTotalBytes: 24,
    });
    await cache.resolve({ extensionId: EXTENSION_ID, resource: c, manifestHash });
    // The malformed entry was deleted during recompute; A, B and C survive
    // exactly (24 bytes), proving no NaN undercount corrupted the eviction.
    expect(store.has(badKey)).toBe(false);
    expect(store.has(keyA)).toBe(true);
    expect(store.has(keyB)).toBe(true);
    expect(store.has(keyC)).toBe(true);
    expect(store.size).toBe(3);
    const totalBytes = [...store.values()].reduce((sum, entry) => sum + entry.size, 0);
    expect(totalBytes).toBe(24);
  });

  it('honors the documented INCLUSIVE TTL upper bound (hit at now === expiresAt, expiry at +1)', async () => {
    const store = new Map();
    const view = resource();
    const manifestHash = sha256(Buffer.from('manifest-v1'));
    let clock = 1_000_000;
    let fetches = 0;
    let offline = false;
    const cache = createRemoteResourceCache({
      fetchImpl: async () => {
        fetches += 1;
        if (offline) throw new Error('offline');
        return okResponse(view.bytes);
      },
      now: () => clock,
      cacheStore: store,
    });
    await cache.resolve({ extensionId: EXTENSION_ID, resource: view, manifestHash });
    expect(fetches).toBe(1);
    // Exactly AT expiresAt the entry is still a valid hit (0 <= age <= ttlMs).
    clock = 1_000_000 + REMOTE_RESOURCE_TTL_MS;
    expect((await cache.resolve({ extensionId: EXTENSION_ID, resource: view, manifestHash }))
      .equals(view.bytes)).toBe(true);
    expect(fetches).toBe(1);
    expect(store.has(remoteResourceCacheKey(crypto, {
      extensionId: EXTENSION_ID, path: view.path, sha256: view.sha256, manifestHash,
    }))).toBe(true);
    // AT expiresAt + 1 the entry is expired: it is deleted and refetched.
    clock = 1_000_000 + REMOTE_RESOURCE_TTL_MS + 1;
    expect((await cache.resolve({ extensionId: EXTENSION_ID, resource: view, manifestHash }))
      .equals(view.bytes)).toBe(true);
    expect(fetches).toBe(2);
    // Offline at exactly the new expiresAt is still a hit; offline one tick
    // later hard-fails sanitized (never stale bytes).
    clock = 1_000_000 + (2 * REMOTE_RESOURCE_TTL_MS) + 1;
    offline = true;
    expect((await cache.resolve({ extensionId: EXTENSION_ID, resource: view, manifestHash }))
      .equals(view.bytes)).toBe(true);
    clock = 1_000_000 + (2 * REMOTE_RESOURCE_TTL_MS) + 2;
    await expect(cache.resolve({ extensionId: EXTENSION_ID, resource: view, manifestHash }))
      .rejects.toMatchObject({ code: 'hosted_resource_unavailable' });
    expect(store.size).toBe(0);
  });

  it('clearExtension never throws on malformed entries and keeps unrelated well-formed entries', async () => {
    const store = new Map();
    const manifestHash = sha256(Buffer.from('manifest-v1'));
    const mine = resource({ path: 'ui/mine.view.json', bytes: Buffer.from('{"mine":true}') });
    const other = resource({ path: 'ui/other.view.json', bytes: Buffer.from('{"other":true}') });
    const mineKey = remoteResourceCacheKey(crypto, {
      extensionId: EXTENSION_ID, path: mine.path, sha256: mine.sha256, manifestHash,
    });
    const otherKey = remoteResourceCacheKey(crypto, {
      extensionId: 'com.acme.other', path: other.path, sha256: other.sha256, manifestHash,
    });
    store.set('bad-null', null);
    store.set('bad-undefined', undefined);
    store.set('bad-string', 'malformed');
    store.set('bad-number', 42);
    store.set('bad-array', []);
    store.set('bad-no-id', { $schema: REMOTE_RESOURCE_CACHE_SCHEMA, key: 'bad-no-id' });
    store.set(mineKey, makeEntry({ key: mineKey, path: mine.path, bytes: mine.bytes, manifestHash, cachedAt: 900_000 }));
    store.set(otherKey, makeEntry({ key: otherKey, extensionId: 'com.acme.other', path: other.path, bytes: other.bytes, manifestHash, cachedAt: 900_000 }));
    const cache = createRemoteResourceCache({
      fetchImpl: async (url) => {
        const value = String(url);
        if (value.endsWith('/ui/extra.view.json')) return okResponse(extra.bytes);
        return okResponse(mine.bytes);
      },
      now: () => 1_000_000,
      cacheStore: store,
    });
    let caught;
    try {
      await cache.clearExtension(EXTENSION_ID);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeUndefined();
    // The target extension's well-formed entry is removed; the unrelated
    // well-formed entry is preserved; identity-less malformed entries are
    // skipped and left for recomputeStore to sanitize on the next insertion.
    expect(store.has(mineKey)).toBe(false);
    expect(store.has(otherKey)).toBe(true);
    for (const badKey of ['bad-null', 'bad-undefined', 'bad-string', 'bad-number', 'bad-array', 'bad-no-id']) {
      expect(store.has(badKey)).toBe(true); // documented choice: left for recompute
    }
    // A subsequent insertion sanitizes every malformed entry without throwing.
    const extra = resource({ path: 'ui/extra.view.json', bytes: Buffer.from('{"extra":true}') });
    await cache.resolve({ extensionId: 'com.acme.other', resource: extra, manifestHash });
    for (const badKey of ['bad-null', 'bad-undefined', 'bad-string', 'bad-number', 'bad-array', 'bad-no-id']) {
      expect(store.has(badKey)).toBe(false);
    }
    expect(store.has(otherKey)).toBe(true);
  });

  it('rejects and caches nothing for any invalid clock timestamp (NaN/Infinity/fractional/negative/overflow)', async () => {
    const view = resource();
    const manifestHash = sha256(Buffer.from('manifest-v1'));
    const invalidClocks = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      1.5,
      -5,
      -1_000_000,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER - REMOTE_RESOURCE_TTL_MS + 1,
    ];
    for (const clock of invalidClocks) {
      const store = new Map();
      let fetches = 0;
      const cache = createRemoteResourceCache({
        fetchImpl: async () => {
          fetches += 1;
          return okResponse(view.bytes);
        },
        now: () => clock,
        cacheStore: store,
      });
      await expect(cache.resolve({ extensionId: EXTENSION_ID, resource: view, manifestHash }))
        .rejects.toThrow('Remote resource cache clock is invalid');
      expect(fetches).toBe(0); // an invalid clock serves AND fetches nothing
      expect(store.size).toBe(0); // and stores nothing
    }
    // A post-fetch clock that becomes invalid still never inserts.
    const store = new Map();
    let fetches = 0;
    let clockStep = 0;
    const flakyCache = createRemoteResourceCache({
      fetchImpl: async () => {
        fetches += 1;
        return okResponse(view.bytes);
      },
      now: () => (clockStep++ === 0 ? 1_000_000 : 1.5),
      cacheStore: store,
    });
    await expect(flakyCache.resolve({ extensionId: EXTENSION_ID, resource: view, manifestHash }))
      .rejects.toThrow('Remote resource cache clock is invalid');
    expect(store.size).toBe(0);
    // The production default clock (Date.now()) remains valid.
    const realClockCache = createRemoteResourceCache({ fetchImpl: async () => okResponse(view.bytes) });
    expect((await realClockCache.resolve({ extensionId: EXTENSION_ID, resource: view, manifestHash }))
      .equals(view.bytes)).toBe(true);
  });

  it('coalesces same-key concurrent resolves and isolates each caller buffer', async () => {
    const store = new Map();
    const view = resource();
    const manifestHash = sha256(Buffer.from('manifest-v1'));
    let fetches = 0;
    let release;
    const gate = new Promise((resolveGate) => { release = resolveGate; });
    const cache = createRemoteResourceCache({
      fetchImpl: async () => {
        fetches += 1;
        await gate;
        return okResponse(view.bytes);
      },
      now: () => 1_000_000,
      cacheStore: store,
    });
    const first = cache.resolve({ extensionId: EXTENSION_ID, resource: view, manifestHash });
    const second = cache.resolve({ extensionId: EXTENSION_ID, resource: view, manifestHash });
    expect(fetches).toBe(1); // the second caller joined the in-flight fetch
    release();
    const [left, right] = await Promise.all([first, second]);
    expect(left.equals(right)).toBe(true);
    // Coalesced callers each receive their OWN buffer copy.
    expect(left).not.toBe(right);
    left[0] ^= 0xff;
    expect(right.equals(view.bytes)).toBe(true);
    const stored = store.get(remoteResourceCacheKey(crypto, {
      extensionId: EXTENSION_ID, path: view.path, sha256: view.sha256, manifestHash,
    })).bytes;
    expect(left).not.toBe(stored);
    expect(stored.equals(view.bytes)).toBe(true);
    // A later resolve is a clean hit (still one fetch total).
    expect((await cache.resolve({ extensionId: EXTENSION_ID, resource: view, manifestHash }))
      .equals(view.bytes)).toBe(true);
    expect(fetches).toBe(1);
  });

  it('clear during fetch: first caller settles, cache stays empty, a post-clear resolve fresh-fetches under the new epoch', async () => {
    const store = new Map();
    const view = resource();
    const manifestHash = sha256(Buffer.from('manifest-v1'));
    const key = remoteResourceCacheKey(crypto, {
      extensionId: EXTENSION_ID, path: view.path, sha256: view.sha256, manifestHash,
    });
    let fetches = 0;
    let release;
    const gate = new Promise((resolveGate) => { release = resolveGate; });
    const cache = createRemoteResourceCache({
      fetchImpl: async () => {
        fetches += 1;
        await gate;
        return okResponse(view.bytes);
      },
      now: () => 1_000_000,
      cacheStore: store,
    });
    const preClear = cache.resolve({ extensionId: EXTENSION_ID, resource: view, manifestHash });
    await cache.clearExtension(EXTENSION_ID); // epoch 0 -> 1, store emptied
    const postClear = cache.resolve({ extensionId: EXTENSION_ID, resource: view, manifestHash }); // must NOT join preClear
    release();
    const [oldCaller, newCaller] = await Promise.all([preClear, postClear]);
    expect(oldCaller.equals(newCaller)).toBe(true);
    expect(oldCaller).not.toBe(newCaller);
    // TWO fetches: the post-clear resolve did not join the pre-clear promise,
    // and exactly one of them (the new epoch) inserted.
    expect(fetches).toBe(2);
    expect(store.size).toBe(1);
    expect(store.has(key)).toBe(true);
    expect(store.get(key).bytes.equals(view.bytes)).toBe(true);
    // A follow-up resolve is a clean hit under the new epoch.
    expect((await cache.resolve({ extensionId: EXTENSION_ID, resource: view, manifestHash }))
      .equals(view.bytes)).toBe(true);
    expect(fetches).toBe(2);
    expect(store.size).toBe(1);
  });

  it("clearExtension removes only that extension's entries and leaves others intact", async () => {
    const store = new Map();
    const firstManifest = sha256(Buffer.from('manifest-v1'));
    const secondManifest = sha256(Buffer.from('manifest-v2'));
    const a = resource({ path: 'ui/a.view.json', bytes: Buffer.from('{"a":true}') });
    const b = resource({ path: 'ui/b.view.json', bytes: Buffer.from('{"b":true}') });
    const keyA = remoteResourceCacheKey(crypto, {
      extensionId: EXTENSION_ID, path: a.path, sha256: a.sha256, manifestHash: firstManifest,
    });
    const otherExtension = 'com.acme.other';
    const keyB = remoteResourceCacheKey(crypto, {
      extensionId: otherExtension, path: b.path, sha256: b.sha256, manifestHash: secondManifest,
    });
    let offline = false;
    const cache = createRemoteResourceCache({
      fetchImpl: async (url) => {
        if (offline) throw new Error('offline');
        const value = String(url);
        if (value.endsWith('/ui/a.view.json')) return okResponse(a.bytes);
        if (value.endsWith('/ui/b.view.json')) return okResponse(b.bytes);
        return new Response('not found', { status: 404 });
      },
      now: () => 1_000_000,
      cacheStore: store,
    });
    await cache.resolve({ extensionId: EXTENSION_ID, resource: a, manifestHash: firstManifest });
    await cache.resolve({ extensionId: otherExtension, resource: b, manifestHash: secondManifest });
    await cache.clearExtension(EXTENSION_ID);
    expect(store.has(keyA)).toBe(false);
    expect(store.has(keyB)).toBe(true);
    offline = true;
    // The other extension still resolves from its intact entry.
    expect((await cache.resolve({ extensionId: otherExtension, resource: b, manifestHash: secondManifest }))
      .equals(b.bytes)).toBe(true);
    // The cleared extension refetches under its new epoch (online).
    offline = false;
    expect((await cache.resolve({ extensionId: EXTENSION_ID, resource: a, manifestHash: firstManifest }))
      .equals(a.bytes)).toBe(true);
    expect(store.has(keyA)).toBe(true);
    expect(store.size).toBe(2);
  });

  it('a failed fetch caches nothing and does not poison retries', async () => {
    const store = new Map();
    const view = resource();
    const manifestHash = sha256(Buffer.from('manifest-v1'));
    let failing = true;
    const cache = createRemoteResourceCache({
      fetchImpl: async () => {
        if (failing) throw new Error('down');
        return okResponse(view.bytes);
      },
      now: () => 1_000_000,
      cacheStore: store,
    });
    await expect(cache.resolve({ extensionId: EXTENSION_ID, resource: view, manifestHash }))
      .rejects.toMatchObject({ code: 'hosted_resource_unavailable' });
    expect(store.size).toBe(0);
    failing = false;
    expect((await cache.resolve({ extensionId: EXTENSION_ID, resource: view, manifestHash }))
      .equals(view.bytes)).toBe(true);
    expect(store.size).toBe(1);
  });

  it('has no filesystem surface and validates the optional cacheStore dependency', async () => {
    const source = await fs.readFile(new URL('./remote-resource-cache.js', import.meta.url), 'utf8');
    // Indirect production-shape proof: the cache module itself imports no
    // fs/path and has no cacheDirectory option (the Manager integration test
    // asserts no on-disk remote-cache directory is ever created).
    expect(source).not.toMatch(/node:fs|node:path/);
    expect(source).not.toContain('cacheDirectory');
    expect(() => createRemoteResourceCache({ fetchImpl: async () => {}, cacheStore: 'not-a-map' }))
      .toThrow('Remote resource cache cacheStore must be a Map');
    expect(() => createRemoteResourceCache({ fetchImpl: async () => {}, cacheStore: new Set() }))
      .toThrow('Remote resource cache cacheStore must be a Map');
  });

  it('never lets an Access Key enter the key, store, fetch, or errors', async () => {
    const store = new Map();
    const secret = 'sk-lazy-secret-42';
    const view = resource();
    const manifestHash = sha256(Buffer.from('manifest-v1'));
    const cache = createRemoteResourceCache({
      fetchImpl: async (url) => {
        expect(String(url)).not.toContain(secret);
        throw new Error(`upstream refused ${secret}`); // hostile error text
      },
      now: () => 1_000_000,
      cacheStore: store,
    });
    let caught;
    try {
      await cache.resolve({ extensionId: EXTENSION_ID, resource: view, manifestHash });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(caught.code).toBe('hosted_resource_unavailable');
    expect(String(caught.message)).not.toContain(secret);
    expect(store.size).toBe(0);
    for (const [key, entry] of store) {
      expect(key).not.toContain(secret);
      expect(JSON.stringify(entry)).not.toContain(secret);
    }
  });
});
