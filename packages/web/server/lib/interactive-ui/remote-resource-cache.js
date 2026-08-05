import nodeCrypto from 'node:crypto';
import { fetchVerifiedHostedResource } from './hosted-ocix.js';

// Remote OCIX Phase R2 lazy resource cache — MANAGER-OWNED, PROCESS-LIFETIME,
// IN-MEMORY TTL cache (intentionally non-durable: a process restart drops all
// entries, which is safe early invalidation; OCIX_REMOTE_MODE_DETAILED_PLAN.md
// §7.2 defines ResourceTtlCache as transient state and §5.6 values it for
// same-session reuse). There is deliberately NO persistent filesystem
// representation: no disk paths, scanning, temp files, opens, renames, or
// parent-identity machinery. A connected Remote extension stays metadata-only
// at connect time; the FIRST actual load of ONE declared signed resource
// lazily fetches only that signed resource, verifies it through the shared
// Hosted seam (same-origin redirect, normalized Content-Type vs signed
// mimeType, size limit, exact signed sha256), stores a defensive copy of the
// verified bytes with exact metadata, and returns a copy.
//
// Cache semantics:
// - key = sha256(extensionId + exact signed resource path + signed sha256 +
//   accepted manifestHash); stale metadata can never be served for a key.
// - default TTL is 30 minutes: every entry carries cachedAt (taken AFTER the
//   verified fetch completes, never before) and expiresAt = cachedAt + ttlMs.
//   A hit is valid only when 0 <= now - cachedAt <= ttlMs (INCLUSIVE upper
//   bound: a hit remains valid at now === expiresAt and expires only at
//   expiresAt + 1; any negative age, i.e. future-dated, is invalid) AND the
//   stored bytes re-hash to the signed sha256 on EVERY hit; an expired,
//   future-dated, malformed, size-inconsistent, metadata-mismatched, or
//   tampered entry is deleted ONLY for that key and never served; an offline
//   refetch then fails hard and sanitized as today.
// - CLOCK VALIDITY: one helper (isValidCacheTime) accepts only a non-negative
//   safe integer whose sum with ttlMs is ALSO a safe integer; BOTH the
//   pre-fetch now and the post-fetch fetchedAt are checked with it before
//   serving/fetching/inserting, so NaN/Infinity, fractional, negative, and
//   overflow-near-MAX_SAFE_INTEGER clocks serve/fetch/cache nothing and an
//   entry is never inserted with an immediately invalid expiresAt.
// - FIXED GLOBAL PRODUCTION LIMITS (injectable in tests): at most 512 entries
//   and at most 64 MiB of raw verified bytes. Accounting is CORRUPTION-PROOF:
//   there is no mutable incremental byte counter — before every insertion the
//   store is sanitized/recomputed (per-key schema/identity/Buffer/size/clock
//   validation; malformed, expired, and future-dated entries are deleted per
//   key WITHOUT throwing; bytes are summed from SURVIVING buffers only), then
//   oldest entries (sorted by cachedAt, not Map insertion order) are evicted
//   until count and bytes fit the new entry — a same-key replacement is
//   excluded from the capacity calculation — and a single entry larger than
//   the global byte limit fails closed. A malformed unrelated entry neither
//   blocks nor influences accounting/eviction.
// - PER-ENTITY ISOLATION: validation/removal of a malformed or expired entry
//   never throws in a way that blocks an unrelated extension; one extension's
//   fetch/cache failure never poisons other keys/extensions.
// - SAME-KEY COALESCING: concurrent resolves for the SAME key share one
//   verified fetch; the shared in-flight promise resolves to the INTERNAL
//   verified buffer and EVERY public resolve copies it, so coalesced callers
//   each receive their OWN Buffer (mutating one cannot alter the other or the
//   cached entry). Different keys/extensions stay independent.
// - CLEAR VS IN-FLIGHT: clearExtension increments a per-extension epoch and
//   removes that extension's stored entries. A resolve captures its epoch: a
//   resolve AFTER clear does not join a pre-clear in-flight promise, an
//   in-flight fetch inserts only when its epoch is unchanged (an
//   already-started caller may still settle with its verified bytes but never
//   repopulates the cache after clear), and an old promise's finally never
//   deletes a newer in-flight record. clearExtension NEVER throws on malformed
//   entries: only well-formed records owned by the extension are removed;
//   null/undefined/primitive/identity-less malformed entries are skipped and
//   left for recomputeStore to sanitize on the next insertion.
// - the Remote Access Key / installationId / other secrets never enter the
//   key, the entry, the fetch, returned metadata, logs, or errors.

export const REMOTE_RESOURCE_CACHE_SCHEMA = 'openchamber://remote-resource-cache/v1';
export const REMOTE_RESOURCE_TTL_MS = 30 * 60 * 1000;
// GLOBAL aggregate cache budget (fixed production defaults, injectable in
// tests): at most 512 entries and at most 64 MiB of raw verified bytes.
export const REMOTE_RESOURCE_CACHE_MAX_ENTRIES = 512;
export const REMOTE_RESOURCE_CACHE_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i;
const SHA256_PATTERN = /^sha256-[A-Za-z0-9+/]{43}=$/;
const HEX64_PATTERN = /^[a-f0-9]{64}$/;

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

// Single source of truth for a VALID cache timestamp: a non-negative safe
// integer whose sum with ttlMs is ALSO a safe integer (so cachedAt + ttlMs is
// exactly representable and equals the stored expiresAt). NaN/Infinity,
// fractional, negative, and overflow-near-MAX_SAFE_INTEGER clock results are
// all invalid and serve/fetch/cache nothing.
const isValidCacheTime = (value, ttlMs) => (
  Number.isSafeInteger(value)
  && value >= 0
  && Number.isSafeInteger(value + ttlMs)
);

const sha256 = (cryptoImpl, value) => `sha256-${cryptoImpl.createHash('sha256').update(value).digest('base64')}`;

// Deterministic per-extension, per-resource cache key. Binds the extensionId,
// the exact signed resource path, the signed sha256, and the accepted
// manifest hash so a cache entry can never be served for different metadata.
export const remoteResourceCacheKey = (cryptoImpl, {
  extensionId,
  path: resourcePath,
  sha256: resourceSha256,
  manifestHash,
}) => {
  if (!ID_PATTERN.test(extensionId)
    || typeof resourcePath !== 'string'
    || !resourcePath
    || !SHA256_PATTERN.test(resourceSha256)
    || !SHA256_PATTERN.test(manifestHash ?? '')) {
    throw new Error('Remote resource cache key requires signed resource metadata');
  }
  return cryptoImpl.createHash('sha256')
    .update([extensionId, resourcePath, resourceSha256, manifestHash].join('\0'))
    .digest('hex');
};

// Entry schema/identity validation shared by the per-hit validator and the
// corruption-proof recompute. NEVER throws. `currentTime` must be finite for
// the clock checks; a non-finite clock never serves or counts entries.
const isWellFormedEntry = (mapKey, entry, currentTime, ttlMs) => (
  isRecord(entry)
  && entry.$schema === REMOTE_RESOURCE_CACHE_SCHEMA
  && typeof mapKey === 'string'
  && typeof entry.key === 'string'
  && mapKey === entry.key
  && HEX64_PATTERN.test(entry.key)
  && ID_PATTERN.test(entry.extensionId ?? '')
  && typeof entry.path === 'string'
  && !!entry.path
  && SHA256_PATTERN.test(entry.sha256 ?? '')
  && SHA256_PATTERN.test(entry.manifestHash ?? '')
  && Buffer.isBuffer(entry.bytes)
  && Number.isSafeInteger(entry.size)
  && entry.size >= 0
  && entry.size === entry.bytes.length
  && Number.isSafeInteger(entry.cachedAt)
  && entry.cachedAt >= 0
  && Number.isSafeInteger(entry.expiresAt)
  && entry.expiresAt === entry.cachedAt + ttlMs
  && isValidCacheTime(currentTime, ttlMs)
  && entry.cachedAt <= currentTime
  // INCLUSIVE upper bound, matching the documented 0 <= now - cachedAt
  // <= ttlMs contract: a hit remains valid at now === expiresAt and expires
  // only at expiresAt + 1.
  && entry.expiresAt >= currentTime
);

export const createRemoteResourceCache = ({
  fetchImpl = globalThis.fetch,
  cryptoImpl = nodeCrypto,
  now = () => Date.now(),
  ttlMs = REMOTE_RESOURCE_TTL_MS,
  maxEntries = REMOTE_RESOURCE_CACHE_MAX_ENTRIES,
  maxTotalBytes = REMOTE_RESOURCE_CACHE_MAX_TOTAL_BYTES,
  // Narrowly named OPTIONAL test dependency: an externally owned Map used as
  // the store so tests can inspect/inject entries. Production (the Manager)
  // passes none. Must be a Map or omitted; never exposed through the public
  // return value.
  cacheStore,
} = {}) => {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Remote resource cache dependencies are incomplete');
  }
  if (cacheStore !== undefined && !(cacheStore instanceof Map)) {
    throw new Error('Remote resource cache cacheStore must be a Map');
  }
  for (const [name, value] of [
    ['maxEntries', maxEntries],
    ['maxTotalBytes', maxTotalBytes],
  ]) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Remote resource cache ${name} must be a positive finite safe integer`);
    }
  }
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new Error('Remote resource cache ttlMs must be a positive finite safe integer');
  }

  // In-memory store keyed by the bound cache key; each entry carries a
  // DEFENSIVE COPY of the verified bytes plus exact metadata, cachedAt and
  // expiresAt, and size. The stored Buffer is never exposed: every caller
  // receives a copy.
  const store = cacheStore ?? new Map();
  // Per-extension invalidation epochs: extensionId -> integer, incremented by
  // clearExtension so in-flight fetches and post-clear resolves never join or
  // repopulate across a clear.
  const extensionEpochs = new Map();
  // Same-key coalescing: key -> { epoch, promise } where the promise resolves
  // to the INTERNAL verified buffer (callers copy). epoch-aware so a resolve
  // after clear does not join a pre-clear promise.
  const inFlight = new Map();

  const copyBytes = (buffer) => Buffer.from(buffer);

  // Per-hit validator: exact key/metadata binding, strict TTL window
  // (0 <= now - cachedAt <= ttlMs, ANY negative age invalid), and re-hash of
  // the stored bytes against the signed sha256. NEVER throws: an invalid
  // entry is deleted only for that key and reported as a miss, so a malformed
  // entry for one key cannot block unrelated extensions.
  const isValidHit = (entry, {
    key,
    extensionId,
    resource,
    manifestHash,
    currentTime,
  }) => {
    if (!isWellFormedEntry(key, entry, currentTime, ttlMs)) return false;
    const age = currentTime - entry.cachedAt;
    if (age < 0 || age > ttlMs) return false;
    if (entry.extensionId !== extensionId
      || entry.path !== resource.path
      || entry.sha256 !== resource.sha256
      || entry.manifestHash !== manifestHash) {
      return false;
    }
    // Re-hash the stored bytes on EVERY hit against the signed sha256.
    return sha256(cryptoImpl, entry.bytes) === resource.sha256;
  };

  // CORRUPTION-PROOF aggregate accounting: no mutable incremental counter.
  // Before every insertion the store is sanitized/recomputed — malformed,
  // expired, and future-dated entries are deleted per key WITHOUT throwing
  // and bytes are summed from SURVIVING buffers only — so an injected or
  // mutated entry (missing/non-numeric/changed size, string, wrong schema,
  // wrong clock) can never produce NaN or an undercount.
  const recomputeStore = (currentTime) => {
    const survivors = [];
    let totalBytes = 0;
    for (const [mapKey, entry] of store) {
      if (!isWellFormedEntry(mapKey, entry, currentTime, ttlMs)) {
        store.delete(mapKey);
        continue;
      }
      survivors.push({ key: mapKey, entry });
      totalBytes += entry.size;
    }
    return { survivors, totalBytes };
  };

  // Atomic aggregate-limit enforcement BEFORE insertion: sanitized/recomputed
  // stats are used, a same-key replacement is excluded from the capacity
  // calculation, TRUE oldest entries (sorted by cachedAt, not Map insertion
  // order) are evicted until count and total bytes fit, and an entry larger
  // than the global byte limit fails closed. Internal writes never exceed
  // either aggregate limit.
  const insertEntry = (entry, currentTime) => {
    if (entry.size > maxTotalBytes) {
      throw new Error('Remote resource cache entry exceeds the aggregate byte budget');
    }
    const { survivors, totalBytes } = recomputeStore(currentTime);
    let bytes = totalBytes;
    let count = survivors.length;
    const replacementIndex = survivors.findIndex(({ key }) => key === entry.key);
    if (replacementIndex !== -1) {
      // Same-key replacement: the superseded entry's bytes are excluded from
      // the capacity calculation (it will be overwritten in place).
      bytes -= survivors[replacementIndex].entry.size;
      survivors.splice(replacementIndex, 1);
      count -= 1;
    }
    const oldestFirst = survivors.sort((left, right) => left.entry.cachedAt - right.entry.cachedAt);
    for (const { key, entry: evicted } of oldestFirst) {
      if (count + 1 <= maxEntries && bytes + entry.size <= maxTotalBytes) break;
      store.delete(key);
      count -= 1;
      bytes -= evicted.size;
    }
    if (count + 1 > maxEntries || bytes + entry.size > maxTotalBytes) {
      throw new Error('Remote resource cache has no room within its aggregate limits');
    }
    store.set(entry.key, entry);
  };

  // Resolves one signed resource: verified in-memory TTL hit, or a validated
  // fetch through the shared Hosted verification seam + atomic insert.
  // `resource` must come from the CURRENT reverified signed manifest
  // ({ path, url, mimeType, sha256 }); `manifestHash` is the accepted manifest
  // hash bound into the cache key. Every caller receives its OWN Buffer copy.
  const resolve = async ({ extensionId, resource, manifestHash }) => {
    if (!isRecord(resource)
      || !ID_PATTERN.test(extensionId)
      || !SHA256_PATTERN.test(resource.sha256 ?? '')
      || !SHA256_PATTERN.test(manifestHash ?? '')) {
      throw new Error('Remote resource cache requires signed resource metadata');
    }
    const key = remoteResourceCacheKey(cryptoImpl, {
      extensionId,
      path: resource.path,
      sha256: resource.sha256,
      manifestHash,
    });
    const epoch = extensionEpochs.get(extensionId) ?? 0;
    const inflight = inFlight.get(key);
    // Coalesce concurrent same-key resolves ONLY within the caller's current
    // extension epoch (a resolve after clearExtension must not join a
    // pre-clear promise). The shared promise resolves to the INTERNAL buffer;
    // every caller copies it before returning.
    if (inflight && inflight.epoch === epoch) {
      const internal = await inflight.promise;
      return copyBytes(internal);
    }
    // Deferred promise: inFlight is populated BEFORE the resolution body runs,
    // so the body's finally always sees the record it set (a synchronous
    // cache-hit path must not leave a resolved promise stranded in-flight).
    let resolvePending;
    let rejectPending;
    const pending = new Promise((resolvePromise, rejectPromise) => {
      resolvePending = resolvePromise;
      rejectPending = rejectPromise;
    });
    inFlight.set(key, { epoch, promise: pending });
    void (async () => {
      try {
        const currentTime = now();
        // A cache timestamp that is not a non-negative safe integer (with
        // cachedAt + ttlMs also safe) is rejected BEFORE anything is served or
        // fetched: NaN/Infinity, fractional, negative, and
        // overflow-near-MAX_SAFE_INTEGER clocks fetch and cache nothing.
        if (!isValidCacheTime(currentTime, ttlMs)) {
          throw new Error('Remote resource cache clock is invalid');
        }
        const hit = store.get(key);
        if (hit && isValidHit(hit, {
          key,
          extensionId,
          resource,
          manifestHash,
          currentTime,
        })) {
          resolvePending(copyBytes(hit.bytes));
          return;
        }
        if (hit) {
          // Expired/future-dated/malformed/metadata-mismatched/tampered:
          // delete ONLY this key and never serve.
          store.delete(key);
        }
        // Fetch and validate with the shared Hosted verification; throws the
        // stable hosted error code on any failure and caches nothing.
        const bytes = await fetchVerifiedHostedResource({ resource, fetchImpl, cryptoImpl });
        // cachedAt is taken AFTER the verified fetch completes and must be a
        // valid cache timestamp (same helper, so an entry is never inserted
        // with an immediately invalid expiresAt); a non-finite/fractional/
        // negative/overflow clock result is rejected rather than cached under.
        const fetchedAt = now();
        if (!isValidCacheTime(fetchedAt, ttlMs)) {
          throw new Error('Remote resource cache clock is invalid');
        }
        // The epoch is captured BEFORE the fetch: a clearExtension during the
        // fetch increments it, so the already-started caller still settles
        // with its verified bytes but MUST NOT repopulate the cache.
        if ((extensionEpochs.get(extensionId) ?? 0) === epoch) {
          insertEntry({
            $schema: REMOTE_RESOURCE_CACHE_SCHEMA,
            key,
            extensionId,
            path: resource.path,
            url: resource.url,
            mimeType: resource.mimeType,
            sha256: resource.sha256,
            manifestHash,
            bytes: Buffer.from(bytes),
            size: bytes.length,
            cachedAt: fetchedAt,
            expiresAt: fetchedAt + ttlMs,
          }, fetchedAt);
        }
        resolvePending(Buffer.from(bytes));
      } catch (error) {
        rejectPending(error);
      } finally {
        const current = inFlight.get(key);
        // Never delete a NEWER in-flight record (created after a clear under a
        // newer epoch).
        if (current && current.epoch === epoch) {
          inFlight.delete(key);
        }
      }
    })();
    const internal = await pending;
    return copyBytes(internal);
  };

  // Removes ONLY the given extension's entries and INVALIDATES its in-flight
  // fetches: clearExtension increments the extension's epoch (so a resolve
  // after the clear does not join a pre-clear promise and an in-flight fetch
  // does not repopulate the cache) and deletes its stored entries. Other
  // extensions remain intact. Called on uninstall and on Remote connect
  // rollback so a removed/disconnected extension leaves no resource cache
  // behind. The manager may await it before its durable state removal
  // (semantic cleanup; there is no filesystem removal to fail).
  const clearExtension = async (extensionId) => {
    if (!ID_PATTERN.test(extensionId ?? '')) return;
    extensionEpochs.set(extensionId, (extensionEpochs.get(extensionId) ?? 0) + 1);
    for (const [key, entry] of store) {
      // NEVER throws on malformed entries: only WELL-FORMED records owned by
      // this extension are removed here (a null/undefined/primitive/other
      // malformed value is skipped), so a malformed entry can never block the
      // clear or an unrelated extension. Identity-less malformed entries are
      // deliberately left in place for recomputeStore to sanitize on the next
      // insertion (documented choice: clearExtension performs no store scan
      // of its own beyond this safe isRecord gate).
      if (isRecord(entry) && entry.extensionId === extensionId) {
        store.delete(key);
      }
    }
  };

  // Public contract ONLY: the store and epochs are never exposed.
  return { resolve, clearExtension };
};
