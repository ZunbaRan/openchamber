const HTML_ARTIFACT_SCHEMA = 'openchamber://html-artifact-result/v1';
const MAX_ENVELOPE_BYTES = 256 * 1024;
const MAX_HTML_BYTES = 192 * 1024;
const CSP_REVISION = 3;
const ARTIFACT_ID_PATTERN = /^[a-f0-9]{64}$/;
const TOP_LEVEL_KEYS = new Set([
  '$schema', 'schemaVersion', 'title', 'summary', 'html', 'capabilities', 'display', 'updatedAt',
]);
const CAPABILITY_KEYS = new Set(['scripts']);
const DISPLAY_KEYS = new Set(['preferred', 'allowExpand', 'inlineHeight']);
const DISPLAY_MODES = new Set(['inline', 'workspace', 'fullscreen']);
const MAX_MARKUP_ELEMENTS = 4_000;
const MAX_SESSION_ID_LENGTH = 200;
const MAX_ARTIFACTS_PER_SESSION = 4_096;

export class HTMLArtifactError extends Error {
  constructor(message, code = 'invalid_artifact', status = 400, details = undefined) {
    super(message);
    this.name = 'HTMLArtifactError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOnlyKeys = (value, allowed) => Object.keys(value).every((key) => allowed.has(key));
const isEnabled = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true') return true;
  if (normalized === '0' || normalized === 'false') return false;
  return fallback;
};

const canonicalizeEnvelope = (value) => JSON.stringify({
  $schema: HTML_ARTIFACT_SCHEMA,
  schemaVersion: 1,
  title: value.title,
  ...(value.summary !== undefined ? { summary: value.summary } : {}),
  html: value.html,
  capabilities: { scripts: value.capabilities.scripts },
  display: {
    preferred: value.display.preferred,
    allowExpand: value.display.allowExpand,
    inlineHeight: value.display.inlineHeight,
  },
  ...(value.updatedAt !== undefined ? { updatedAt: value.updatedAt } : {}),
});

const canonicalizeExecutableContent = (value) => JSON.stringify({
  schemaVersion: 1,
  html: value.html,
  scripts: value.capabilities.scripts,
});

const displayMetadata = (envelope) => ({
  inlineHeight: envelope.display.inlineHeight,
  preferred: envelope.display.preferred,
  allowExpand: envelope.display.allowExpand,
});

export const validateHTMLArtifactSource = (html, scripts) => {
  if (html.includes('\0')) {
    throw new HTMLArtifactError('Artifact HTML contains invalid bytes', 'invalid_artifact_html');
  }
  const elementCount = html.match(/<[a-z][a-z0-9:-]*(?:\s|\/?>)/gi)?.length ?? 0;
  if (elementCount > MAX_MARKUP_ELEMENTS) {
    throw new HTMLArtifactError(`Artifact HTML exceeds ${MAX_MARKUP_ELEMENTS} elements`, 'artifact_dom_too_large', 413);
  }
  if (/<\s*(?:iframe|frame|frameset|object|embed|form|base|link)\b/i.test(html)
    || /<\s*meta\b[^>]*http-equiv\s*=\s*["']?\s*refresh\b/i.test(html)) {
    throw new HTMLArtifactError('Artifact HTML contains a prohibited element', 'prohibited_artifact_markup');
  }
  if (/\b(?:href|src|action)\s*=\s*["']?\s*(?:javascript:|vbscript:)/i.test(html)
    || /\bhref\s*=\s*["']?\s*data\s*:/i.test(html)) {
    throw new HTMLArtifactError('Artifact HTML contains a prohibited navigation target', 'prohibited_artifact_navigation');
  }
  if (/\b(?:src|href|action)\s*=\s*["']?\s*(?:https?:|\/\/)/i.test(html)
    || /url\(\s*["']?\s*(?:https?:|\/\/)/i.test(html)) {
    throw new HTMLArtifactError('Artifact HTML contains a remote resource', 'remote_artifact_resource');
  }
  if (!scripts) {
    const navigationTargets = html.matchAll(/\b(?:href|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi);
    for (const match of navigationTargets) {
      const target = (match[1] ?? match[2] ?? match[3] ?? '').trim();
      if (!target.startsWith('#')) {
        throw new HTMLArtifactError('Artifact HTML contains a prohibited navigation target', 'prohibited_artifact_navigation');
      }
    }
  }
  if (!scripts && /<\s*script\b/i.test(html)) {
    throw new HTMLArtifactError('Static Artifact HTML cannot contain scripts', 'static_artifact_contains_script');
  }
  if (!scripts && /\son[a-z][a-z0-9:_-]*\s*=/i.test(html)) {
    throw new HTMLArtifactError('Static Artifact HTML cannot contain event handlers', 'static_artifact_contains_event_handler');
  }
  if (scripts && (/<\s*script\b[^>]*\bsrc\s*=/i.test(html)
    || /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|SharedWorker|Worker|WebAssembly)\s*(?:\(|\.)/i.test(html)
    || /\bnavigator\s*\.\s*(?:sendBeacon|serviceWorker)\b/i.test(html)
    || /\beval\s*\(/i.test(html)
    || /\b(?:new\s+)?Function\s*\(/.test(html))) {
    throw new HTMLArtifactError('Interactive Artifact requests a prohibited execution capability', 'prohibited_artifact_capability');
  }
};

const validateEnvelope = (value) => {
  if (!isRecord(value) || !hasOnlyKeys(value, TOP_LEVEL_KEYS)) {
    throw new HTMLArtifactError('Artifact result must use the exact v1 contract', 'invalid_artifact_contract');
  }
  if (value.$schema !== HTML_ARTIFACT_SCHEMA || value.schemaVersion !== 1) {
    throw new HTMLArtifactError('Artifact result schema is unsupported', 'unsupported_artifact_schema');
  }
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120) {
    throw new HTMLArtifactError('Artifact title is invalid', 'invalid_artifact_title');
  }
  if (value.summary !== undefined && (typeof value.summary !== 'string' || value.summary.length > 500)) {
    throw new HTMLArtifactError('Artifact summary is invalid', 'invalid_artifact_summary');
  }
  if (typeof value.html !== 'string' || !value.html.trim() || Buffer.byteLength(value.html, 'utf8') > MAX_HTML_BYTES) {
    throw new HTMLArtifactError('Artifact HTML is missing or too large', 'invalid_artifact_html');
  }
  if (value.updatedAt !== undefined && (
    typeof value.updatedAt !== 'string'
    || value.updatedAt.length > 64
    || !Number.isFinite(Date.parse(value.updatedAt))
  )) {
    throw new HTMLArtifactError('Artifact updatedAt is invalid', 'invalid_artifact_updated_at');
  }
  if (!isRecord(value.capabilities) || !hasOnlyKeys(value.capabilities, CAPABILITY_KEYS) || typeof value.capabilities.scripts !== 'boolean') {
    throw new HTMLArtifactError('Artifact capabilities are invalid', 'invalid_artifact_capabilities');
  }
  if (!isRecord(value.display) || !hasOnlyKeys(value.display, DISPLAY_KEYS)) {
    throw new HTMLArtifactError('Artifact display contract is invalid', 'invalid_artifact_display');
  }
  if (!DISPLAY_MODES.has(value.display.preferred)
    || typeof value.display.allowExpand !== 'boolean'
    || !Number.isInteger(value.display.inlineHeight)
    || value.display.inlineHeight < 120
    || value.display.inlineHeight > 900) {
    throw new HTMLArtifactError('Artifact display values are invalid', 'invalid_artifact_display');
  }
  validateHTMLArtifactSource(value.html, value.capabilities.scripts);

  const normalized = JSON.parse(canonicalizeEnvelope({
    ...value,
    title: value.title.trim(),
  }));
  if (Buffer.byteLength(canonicalizeEnvelope(normalized), 'utf8') > MAX_ENVELOPE_BYTES) {
    throw new HTMLArtifactError('Artifact result exceeds 256 KiB', 'artifact_too_large', 413);
  }
  return normalized;
};

const assertArtifactId = (artifactId) => {
  if (!ARTIFACT_ID_PATTERN.test(artifactId ?? '')) {
    throw new HTMLArtifactError('Artifact id is invalid', 'invalid_artifact_id');
  }
};

const normalizeSessionId = (sessionId) => {
  if (typeof sessionId !== 'string'
    || !sessionId
    || sessionId.length > MAX_SESSION_ID_LENGTH
    || /[\0-\x1f\x7f]/.test(sessionId)) {
    throw new HTMLArtifactError('Artifact session reference is invalid', 'invalid_artifact_session_reference');
  }
  return sessionId;
};

const artifactMissing = () => new HTMLArtifactError('Artifact cache entry was not found', 'artifact_not_found', 404, {
  rematerializable: true,
});

const createBridgeBootstrap = ({ businessEnabled = false } = {}) => {
  const businessState = businessEnabled
    ? String.raw`const pending=new Map();const finish=value=>{const payload=value&&value.payload||{},request=pending.get(payload.requestId);if(!request)return;clearTimeout(request.timer);pending.delete(payload.requestId);if(payload.ok)request.resolve(payload.data);else{const error=new Error(typeof payload.error==="string"?payload.error:"Business request failed");if(typeof payload.code==="string")error.code=payload.code;request.reject(error)}};`
    : '';
  const businessMessageHandler = businessEnabled
    ? String.raw`if(value.type==="host.businessResult"&&value.channelId===channel){finish(value);return}`
    : '';
  const businessBridge = businessEnabled
    ? String.raw`const request=(intent,action,input)=>new Promise((resolve,reject)=>{if(!channel){reject(new Error("OpenChamber Host is not ready"));return}if(typeof action!=="string"||!/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i.test(action)){reject(new Error("Business action is invalid"));return}const requestId=globalThis.crypto&&typeof globalThis.crypto.randomUUID==="function"?globalThis.crypto.randomUUID():Date.now()+"-"+Math.random().toString(36).slice(2),timer=setTimeout(()=>{pending.delete(requestId);reject(new Error("Business request timed out"))},20000);pending.set(requestId,{resolve,reject,timer});send("artifact.businessRequest",{requestId,intent,action,input})});const emit=(eventId,payload={})=>{if(!channel)return Promise.reject(new Error("OpenChamber Host is not ready"));if(typeof eventId!=="string"||!/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i.test(eventId)||!payload||typeof payload!=="object"||Array.isArray(payload))return Promise.reject(new Error("Dashboard event is invalid"));send("artifact.dashboardEvent",{eventId,payload});return Promise.resolve()};Object.defineProperty(window,"openchamber",{value:Object.freeze({business:Object.freeze({query:(action,input={})=>request("query",action,input),execute:(action,input={})=>request("execute",action,input)}),dashboard:Object.freeze({emit})}),configurable:false,writable:false});`
    : '';

  return String.raw`<script>(()=>{"use strict";${businessState}let channel="",sequence=0,observer,heartbeatTimer;const send=(type,payload={})=>{if(!channel)return;parent.postMessage({source:"openchamber-artifact",direction:"artifact-to-host",bridgeVersion:1,channelId:channel,sequence:++sequence,type,payload},"*")};const resize=()=>send("artifact.resize",{height:Math.max(120,Math.min(5000,Math.ceil(document.documentElement.getBoundingClientRect().height)))});const startHeartbeat=lease=>{if(heartbeatTimer)clearInterval(heartbeatTimer);if(!lease||typeof lease.id!=="string")return;const interval=Math.max(500,Math.min(5000,Number(lease.heartbeatIntervalMs)||1000));send("artifact.heartbeat",{leaseId:lease.id});heartbeatTimer=setInterval(()=>send("artifact.heartbeat",{leaseId:lease.id}),interval)};addEventListener("message",event=>{const value=event.data;if(event.source!==parent||!value||value.source!=="openchamber-host"||value.direction!=="host-to-artifact"||value.bridgeVersion!==1||typeof value.channelId!=="string")return;${businessMessageHandler}if(value.type!=="host.init")return;channel=value.channelId;const payload=value.payload||{};for(const [name,token] of Object.entries(payload.tokens||{})){if(/^--ocix-[a-z0-9-]+$/.test(name)&&typeof token==="string"&&token.length<=160)document.documentElement.style.setProperty(name,token)}document.documentElement.dataset.ocixTheme=payload.theme==="dark"?"dark":"light";document.documentElement.lang=typeof payload.locale==="string"?payload.locale:"";dispatchEvent(new CustomEvent("openchamber:host-init",{detail:payload}));send("artifact.ready",{});startHeartbeat(payload.executionLease);resize();if(!observer&&typeof ResizeObserver==="function"){observer=new ResizeObserver(resize);observer.observe(document.documentElement)}});addEventListener("error",event=>send("artifact.reportError",{code:"runtime_error",message:String(event.message||"Artifact error").slice(0,500),line:Number(event.lineno)||0,column:Number(event.colno)||0}));Object.defineProperty(window,"openchamberArtifact",{value:Object.freeze({send}),configurable:false,writable:false});${businessBridge}})();</script>`;
};

const ARTIFACT_SECURITY_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; media-src 'none'; base-uri 'none'; form-action 'none'">`;
const ARTIFACT_BASE_STYLE = '<style data-openchamber-artifact-base>html,body{margin:0!important;min-width:0;background:transparent!important}html{color-scheme:light dark}body{overflow-wrap:anywhere}</style>';

const addArtifactHeadContent = (html, content) => {
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (head?.index !== undefined) {
    const insertion = head.index + head[0].length;
    return `${html.slice(0, insertion)}${content}${html.slice(insertion)}`;
  }
  const root = /<html(?:\s[^>]*)?>/i.exec(html);
  if (root?.index !== undefined) {
    const insertion = root.index + root[0].length;
    return `${html.slice(0, insertion)}<head>${content}</head>${html.slice(insertion)}`;
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) {
    const insertion = doctype[0].length;
    return `${html.slice(0, insertion)}<head>${content}</head>${html.slice(insertion)}`;
  }
  return `<head>${content}</head>${html}`;
};

const addArtifactSecurityMeta = (html) => addArtifactHeadContent(html, ARTIFACT_SECURITY_META);
const addArtifactBaseStyle = (html) => addArtifactHeadContent(html, ARTIFACT_BASE_STYLE);

const addBridgeBootstrap = (html, options) => {
  const closingBody = html.toLowerCase().lastIndexOf('</body>');
  const bootstrap = createBridgeBootstrap(options);
  return closingBody === -1
    ? `${html}${bootstrap}`
    : `${html.slice(0, closingBody)}${bootstrap}${html.slice(closingBody)}`;
};

export const createInstalledHTMLArtifactDocument = (html) => {
  if (typeof html !== 'string' || !html.trim() || Buffer.byteLength(html, 'utf8') > 2 * 1024 * 1024) {
    throw new HTMLArtifactError('Installed HTML Artifact is missing or too large', 'invalid_installed_artifact_html', 413);
  }
  validateHTMLArtifactSource(html, true);
  return addBridgeBootstrap(addArtifactSecurityMeta(addArtifactBaseStyle(html)), { businessEnabled: true });
};

export const createHTMLArtifactStore = ({
  dataDirectory,
  fsImpl,
  pathImpl,
  cryptoImpl,
  environment = {},
}) => {
  if (!dataDirectory || !fsImpl || !pathImpl || !cryptoImpl) throw new Error('HTML Artifact store dependencies are required');
  const root = pathImpl.join(dataDirectory, 'interactive-ui', 'artifacts');
  const referencesRoot = pathImpl.join(root, 'references');
  const staticEnabled = isEnabled(environment.OPENCHAMBER_HTML_ARTIFACTS_STATIC, true);
  // Managed Desktop has an independently terminable WebContentsView runner.
  // Keep Web default-off; retain the same environment variable as a Desktop
  // kill switch and an explicit Web development opt-in.
  const scriptsEnabled = isEnabled(
    environment.OPENCHAMBER_HTML_ARTIFACTS_SCRIPTS,
    environment.OPENCHAMBER_RUNTIME === 'desktop',
  );
  let mutationQueue = Promise.resolve();

  const withMutationLock = (operation) => {
    const pending = mutationQueue.then(operation, operation);
    mutationQueue = pending.catch(() => undefined);
    return pending;
  };

  const artifactPath = (artifactId) => pathImpl.join(root, artifactId);
  const sessionReferencePath = (sessionId) => pathImpl.join(
    referencesRoot,
    `${cryptoImpl.createHash('sha256').update(normalizeSessionId(sessionId)).digest('hex')}.json`,
  );

  const parseSessionReference = (payload, expectedSessionId) => {
    if (!isRecord(payload)
      || payload.schemaVersion !== 1
      || normalizeSessionId(payload.sessionId) !== expectedSessionId
      || !Array.isArray(payload.artifactIds)
      || payload.artifactIds.length > MAX_ARTIFACTS_PER_SESSION
      || payload.artifactIds.some((artifactId) => !ARTIFACT_ID_PATTERN.test(artifactId))
      || new Set(payload.artifactIds).size !== payload.artifactIds.length) {
      throw new HTMLArtifactError('Artifact session reference is corrupt', 'artifact_reference_corrupt', 500);
    }
    return payload;
  };

  const readSessionReference = async (sessionId, { allowMissing = false } = {}) => {
    const normalizedSessionId = normalizeSessionId(sessionId);
    try {
      const payload = JSON.parse(await fsImpl.readFile(sessionReferencePath(normalizedSessionId), 'utf8'));
      return parseSessionReference(payload, normalizedSessionId);
    } catch (error) {
      if (error?.code === 'ENOENT' && allowMissing) return null;
      if (error instanceof HTMLArtifactError) throw error;
      throw new HTMLArtifactError('Artifact session reference is corrupt', 'artifact_reference_corrupt', 500);
    }
  };

  const writeSessionReference = async (reference) => {
    await fsImpl.mkdir(referencesRoot, { recursive: true, mode: 0o700 });
    const destination = sessionReferencePath(reference.sessionId);
    const temporary = `${destination}.tmp-${cryptoImpl.randomBytes(8).toString('hex')}`;
    try {
      await fsImpl.writeFile(temporary, `${JSON.stringify(reference)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await fsImpl.rename(temporary, destination);
    } catch (error) {
      await fsImpl.rm(temporary, { force: true }).catch(() => undefined);
      throw new HTMLArtifactError('Artifact session reference could not be written', 'artifact_reference_write_failed', 500);
    }
  };

  const trackSessionReference = async (sessionId, artifactId) => {
    if (sessionId === undefined || sessionId === null) return false;
    const normalizedSessionId = normalizeSessionId(sessionId);
    const current = await readSessionReference(normalizedSessionId, { allowMissing: true });
    if (current?.artifactIds.includes(artifactId)) return true;
    const artifactIds = [...(current?.artifactIds ?? []), artifactId];
    if (artifactIds.length > MAX_ARTIFACTS_PER_SESSION) {
      throw new HTMLArtifactError('Artifact session reference limit exceeded', 'artifact_session_reference_limit', 413);
    }
    await writeSessionReference({ schemaVersion: 1, sessionId: normalizedSessionId, artifactIds });
    return true;
  };

  const readMetadata = async (artifactId) => {
    assertArtifactId(artifactId);
    try {
      const payload = JSON.parse(await fsImpl.readFile(pathImpl.join(artifactPath(artifactId), 'metadata.json'), 'utf8'));
      if (!isRecord(payload)
        || payload.artifactId !== artifactId
        || payload.schemaVersion !== 1
        || typeof payload.scripts !== 'boolean'
        || !Number.isInteger(payload.documentBytes)
        || payload.documentBytes < 1) {
        throw new Error('invalid metadata');
      }
      // CSP is applied when the document is served, so cached artifacts always
      // report the current response policy revision without rewriting content.
      return { ...payload, cspRevision: CSP_REVISION };
    } catch (error) {
      if (error?.code === 'ENOENT') throw artifactMissing();
      throw new HTMLArtifactError('Artifact metadata is corrupt', 'artifact_corrupt', 500, { rematerializable: true });
    }
  };

  const readCachedArtifact = async (artifactId, expectedDocument, expectedScripts) => {
    const metadata = await readMetadata(artifactId);
    try {
      const html = await fsImpl.readFile(pathImpl.join(artifactPath(artifactId), 'document.html'), 'utf8');
      if (metadata.scripts !== expectedScripts
        || metadata.documentBytes !== Buffer.byteLength(expectedDocument, 'utf8')
        || html !== expectedDocument) {
        throw new Error('cached document mismatch');
      }
      return metadata;
    } catch (error) {
      if (error instanceof HTMLArtifactError) throw error;
      throw new HTMLArtifactError('Artifact document is corrupt', 'artifact_corrupt', 500, { rematerializable: true });
    }
  };

  return {
    getCapabilities() {
      const staticMode = staticEnabled ? 'supported' : 'unsupported';
      const scriptsAvailable = staticEnabled && scriptsEnabled;
      const scriptsMode = scriptsAvailable
        ? environment.OPENCHAMBER_RUNTIME === 'desktop' ? 'supported' : 'experimental'
        : 'unsupported';
      return {
        schemaVersion: 1,
        static: staticEnabled,
        scripts: staticEnabled && scriptsEnabled,
        scriptsMode,
        cspRevision: CSP_REVISION,
        runtimeSupport: {
          web: { static: staticMode, scripts: scriptsAvailable ? 'experimental' : 'unsupported' },
          managedDesktop: { static: staticMode, scripts: scriptsAvailable ? 'supported' : 'unsupported' },
          hostedMobile: { static: staticMode, scripts: 'unsupported' },
          capacitorMobile: { static: staticMode, scripts: 'unsupported' },
          vscode: { static: 'unsupported', scripts: 'unsupported' },
          e2eeRelay: { static: 'unsupported', scripts: 'unsupported' },
        },
      };
    },

    async materialize(candidate, { sessionId } = {}) {
      return withMutationLock(async () => {
        if (!staticEnabled) {
          throw new HTMLArtifactError('HTML Artifact is disabled in this runtime', 'artifact_runtime_unsupported', 409);
        }
        const envelope = validateEnvelope(candidate);
        if (envelope.capabilities.scripts && !scriptsEnabled) {
          throw new HTMLArtifactError('Interactive HTML Artifact scripts are disabled in this runtime', 'artifact_scripts_unsupported', 409, {
            staticAvailable: true,
          });
        }

        const canonical = canonicalizeExecutableContent(envelope);
        const artifactId = cryptoImpl.createHash('sha256').update(canonical).digest('hex');
        const destination = artifactPath(artifactId);
        const themedDocument = addArtifactBaseStyle(envelope.html);
        const document = envelope.capabilities.scripts
          ? addBridgeBootstrap(addArtifactSecurityMeta(themedDocument), { businessEnabled: false })
          : themedDocument;
        let cacheRebuilt = false;
        try {
          const existing = await readCachedArtifact(artifactId, document, envelope.capabilities.scripts);
          const sessionReferenceTracked = await trackSessionReference(sessionId, artifactId);
          return {
            ...existing,
            ...displayMetadata(envelope),
            cacheHit: true,
            cacheRebuilt: false,
            sessionReferenceTracked,
          };
        } catch (error) {
          if (!(error instanceof HTMLArtifactError)
            || (error.code !== 'artifact_not_found' && error.code !== 'artifact_corrupt')) throw error;
          cacheRebuilt = error.code === 'artifact_corrupt';
          if (cacheRebuilt) await fsImpl.rm(destination, { recursive: true, force: true });
        }

        await fsImpl.mkdir(root, { recursive: true, mode: 0o700 });
        const tempId = `.tmp-${artifactId}-${cryptoImpl.randomBytes(8).toString('hex')}`;
        const temporary = pathImpl.join(root, tempId);
        const metadata = {
          artifactId,
          schemaVersion: 1,
          scripts: envelope.capabilities.scripts,
          documentBytes: Buffer.byteLength(document, 'utf8'),
          cspRevision: CSP_REVISION,
        };

        try {
          await fsImpl.mkdir(temporary, { mode: 0o700 });
          await fsImpl.writeFile(pathImpl.join(temporary, 'document.html'), document, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
          await fsImpl.writeFile(pathImpl.join(temporary, 'metadata.json'), `${JSON.stringify(metadata)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
          try {
            await fsImpl.rename(temporary, destination);
          } catch (error) {
            if (error?.code !== 'EEXIST' && error?.code !== 'ENOTEMPTY') throw error;
            await fsImpl.rm(temporary, { recursive: true, force: true });
            const existing = await readCachedArtifact(artifactId, document, envelope.capabilities.scripts);
            const sessionReferenceTracked = await trackSessionReference(sessionId, artifactId);
            return {
              ...existing,
              ...displayMetadata(envelope),
              cacheHit: true,
              cacheRebuilt: false,
              sessionReferenceTracked,
            };
          }
        } catch (error) {
          await fsImpl.rm(temporary, { recursive: true, force: true }).catch(() => undefined);
          if (error instanceof HTMLArtifactError) throw error;
          throw new HTMLArtifactError('Artifact could not be written', 'artifact_write_failed', 500);
        }
        const sessionReferenceTracked = await trackSessionReference(sessionId, artifactId);
        return {
          ...metadata,
          ...displayMetadata(envelope),
          cacheHit: false,
          cacheRebuilt,
          sessionReferenceTracked,
        };
      });
    },

    async getMetadata(artifactId) {
      return readMetadata(artifactId);
    },

    async getDocument(artifactId) {
      const metadata = await readMetadata(artifactId);
      if (metadata.scripts && !scriptsEnabled) {
        throw new HTMLArtifactError('Interactive HTML Artifact scripts are disabled in this runtime', 'artifact_scripts_unsupported', 409, {
          staticAvailable: staticEnabled,
        });
      }
      try {
        const html = await fsImpl.readFile(pathImpl.join(artifactPath(artifactId), 'document.html'), 'utf8');
        if (Buffer.byteLength(html, 'utf8') !== metadata.documentBytes) throw new Error('size mismatch');
        return { metadata, html };
      } catch (error) {
        if (error?.code === 'ENOENT') throw artifactMissing();
        throw new HTMLArtifactError('Artifact document is corrupt', 'artifact_corrupt', 500, { rematerializable: true });
      }
    },

    async releaseSession(sessionId) {
      return withMutationLock(async () => {
        const normalizedSessionId = normalizeSessionId(sessionId);
        const target = await readSessionReference(normalizedSessionId, { allowMissing: true });
        if (!target) return { released: true, removedArtifacts: 0, retainedArtifacts: 0 };

        const targetPath = sessionReferencePath(normalizedSessionId);
        const referencedElsewhere = new Set();
        let entries = [];
        try {
          entries = await fsImpl.readdir(referencesRoot, { withFileTypes: true });
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.json') || pathImpl.join(referencesRoot, entry.name) === targetPath) continue;
          let payload;
          try {
            payload = JSON.parse(await fsImpl.readFile(pathImpl.join(referencesRoot, entry.name), 'utf8'));
          } catch {
            throw new HTMLArtifactError('Artifact session reference is corrupt', 'artifact_reference_corrupt', 500);
          }
          const reference = parseSessionReference(payload, normalizeSessionId(payload?.sessionId));
          for (const artifactId of reference.artifactIds) referencedElsewhere.add(artifactId);
        }

        const removable = target.artifactIds.filter((artifactId) => !referencedElsewhere.has(artifactId));
        for (const artifactId of removable) {
          await fsImpl.rm(artifactPath(artifactId), { recursive: true, force: true });
        }
        await fsImpl.rm(targetPath, { force: true });
        return {
          released: true,
          removedArtifacts: removable.length,
          retainedArtifacts: target.artifactIds.length - removable.length,
        };
      });
    },

    async clear() {
      return withMutationLock(async () => {
        await fsImpl.rm(root, { recursive: true, force: true });
        return { cleared: true, rematerializableFromHistory: true };
      });
    },
  };
};
