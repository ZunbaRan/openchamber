import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';

export const TLDRAW_MODEL_TOOLS = [
  'tldraw_create_view',
  'tldraw_patch_shapes',
];

export const TLDRAW_APP_ONLY_TOOLS = [
  'tldraw_get_canvas_state',
  'tldraw_list_canvas_revisions',
  'tldraw_restore_canvas_revision',
  'tldraw_apply_operations',
  'tldraw_save_canvas',
  'tldraw_export_snapshot',
];

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const selectHostPersistablePinAction = (candidates, expectedRevision) => {
  if (!Array.isArray(candidates) || expectedRevision === undefined || expectedRevision === null) {
    return null;
  }
  const expected = String(expectedRevision);
  return candidates.find((candidate) => (
    candidate?.selector === 'button[data-mcp-app-persistable-revision]'
    && candidate?.scopedToTldrawIframe === true
    && candidate?.revision === expected
    && candidate?.visible === true
    && candidate?.disabled === false
  )) ?? null;
};

export const hasPositiveRect = (rect) => (
  Number(rect?.width) > 1
  && Number(rect?.height) > 1
);

export const isProjectDirectoryOnboardingText = (value) => (
  /(?:Add project directory|添加项目目录|新增專案目錄)/i.test(String(value || ''))
);

// Acceptance harness hardening: decide whether a serialized top-level dialog is
// the supported project-directory onboarding AND carries a usable rendered
// close action (connected, visible, enabled, positive hit area). The verifier
// uses this before it ever attempts a click, so a hidden dialog, a zero-rect
// dialog, or a missing/disabled/hidden/zero-rect close action fails closed
// instead of being silently bypassed. Locale detection stays in
// isProjectDirectoryOnboardingText; this predicate never duplicates it.
export const assessProjectDirectoryOnboarding = (dialog) => {
  if (!isRecord(dialog)) {
    return { pass: false, reasons: ['missing-dialog-state'] };
  }
  if (!isProjectDirectoryOnboardingText(dialog.text)) {
    return { pass: false, reasons: ['not-project-directory-onboarding'] };
  }
  const reasons = [];
  if (dialog.visible !== true) reasons.push('dialog-not-visible');
  if (!hasPositiveRect(dialog.rect)) reasons.push('dialog-has-no-hit-area');
  const close = isRecord(dialog.close) ? dialog.close : null;
  if (!close) reasons.push('close-action-missing');
  else {
    if (close.connected !== true) reasons.push('close-not-connected');
    if (close.visible !== true) reasons.push('close-not-visible');
    if (close.disabled === true) reasons.push('close-disabled');
    if (!hasPositiveRect(close.rect)) reasons.push('close-has-no-hit-area');
  }
  return { pass: reasons.length === 0, reasons };
};

export const assessTldrawEditorReadiness = (candidate) => {
  const reasons = [];
  if (!candidate || typeof candidate !== 'object') {
    return { ready: false, reasons: ['missing-app-context'], noteButton: null };
  }
  if (candidate.mode !== 'fullscreen') reasons.push('not-fullscreen');
  if (!candidate.shellConnected) reasons.push('shell-detached');
  if (!hasPositiveRect(candidate.shellRect)) reasons.push('shell-has-no-hit-area');
  if (!hasPositiveRect(candidate.canvasRect)) reasons.push('editor-canvas-has-no-hit-area');

  const noteButton = Array.isArray(candidate.buttons)
    ? candidate.buttons.find((button) => button?.text === '+ Note') ?? null
    : null;
  if (!noteButton) reasons.push('note-action-missing');
  else {
    if (noteButton.disabled) reasons.push('note-action-disabled');
    if (noteButton.visible === false || !hasPositiveRect(noteButton.rect)) {
      reasons.push('note-action-has-no-hit-area');
    }
  }

  // Newer standalone Apps expose an explicit lifecycle marker. Keep the
  // rendered canvas + enabled real button fallback so the acceptance runner
  // can still diagnose older pinned/history fixtures without weakening the
  // interaction requirement.
  // Legal values: true | false | undefined | null. `false` means the App has
  // declared itself not ready; only non-boolean non-nullish values are invalid.
  if (candidate.editorReady === false) {
    reasons.push('app-declared-editor-not-ready');
  } else if (
    candidate.editorReady !== true
    && candidate.editorReady !== undefined
    && candidate.editorReady !== null
  ) {
    reasons.push('invalid-editor-ready-marker');
  }

  return {
    ready: reasons.length === 0,
    reasons,
    noteButton,
    editorReady: candidate.editorReady ?? null,
    editorStatus: candidate.editorStatus ?? '',
  };
};

// WP-2: Surface Contract V1 predicate (plan §4.2/§4.3). The authoritative
// inline/editor surface must carry the frozen contract identity, an
// authoritative authority-state, a real tldraw renderer that is render-ready,
// a positive canvas hit area, and the role-appropriate mutation authority.
// This predicate is pure so the browser verifier can unit-test every negative
// case without a full E2E run.
export const assessTldrawSurfaceContract = (
  surface,
  { expectedRole, expectedMutationAuthority } = {},
) => {
  const reasons = [];
  if (!surface || typeof surface !== 'object') {
    return { pass: false, reasons: ['missing-surface-state'] };
  }
  if (surface.surfaceContract !== 'tldraw-authoritative-v1') {
    reasons.push(`surface-contract=${surface.surfaceContract || 'missing'}`);
  }
  if (expectedRole && surface.surfaceRole !== expectedRole) {
    reasons.push(`role=${surface.surfaceRole || 'missing'}`);
  }
  if (surface.authorityState !== 'authoritative') {
    reasons.push(`authority-state=${surface.authorityState || 'missing'}`);
  }
  if (surface.surfaceRenderer !== 'tldraw') {
    reasons.push(`renderer=${surface.surfaceRenderer || 'missing'}`);
  }
  if (surface.renderReady !== true) {
    reasons.push(`render-ready=${surface.renderReady}`);
  }
  if (surface.semanticContentReady !== true) {
    reasons.push(`semantic-content-ready=${surface.semanticContentReady}`);
  }
  if (!Number.isSafeInteger(surface.renderedSemanticElementCount) || surface.renderedSemanticElementCount < 1) {
    reasons.push('rendered-semantic-content-empty');
  }
  if (surface.visibleSemanticContent !== true) {
    reasons.push('visible-semantic-content-missing');
  }
  if (
    expectedMutationAuthority &&
    surface.mutationAuthority !== expectedMutationAuthority
  ) {
    reasons.push(`mutation-authority=${surface.mutationAuthority || 'missing'}`);
  }
  if (!hasPositiveRect(surface.canvasRect)) reasons.push('canvas-has-no-hit-area');
  if (!hasPositiveRect(surface.shellRect)) reasons.push('shell-has-no-hit-area');
  return { pass: reasons.length === 0, reasons };
};

export const selectActiveAppContext = (candidates, {
  mode,
  requireCanvas = true,
  minCreatedOrdinal = 0,
} = {}) => candidates
  .filter((candidate) => (
    candidate?.sessionActive === true
    && candidate.shellConnected === true
    && candidate.shellDisplay !== 'none'
    && candidate.shellVisibility !== 'hidden'
    && candidate.shellOpacity !== '0'
    && hasPositiveRect(candidate.shellRect)
    && candidate.createdOrdinal >= minCreatedOrdinal
    && (!requireCanvas || candidate.containsCanvas)
    && (!mode || candidate.mode === mode)
  ))
  .sort((left, right) => (
    right.createdOrdinal - left.createdOrdinal
    || Number(right.isDefaultContext) - Number(left.isDefaultContext)
  ))[0] ?? null;

const APP_FALLBACK_PATTERN = /MCP App capability was not negotiated|(?:text|semanticDocument|structured canvas state) fallback|UI (?:surface )?(?:is )?unavailable|Original Tool Output/i;

const parseOutputEnvelope = (part) => {
  if (typeof part?.state?.output !== 'string') return null;
  try {
    const parsed = JSON.parse(part.state.output);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const inspectToolOutcome = (part) => {
  const outputEnvelope = parseOutputEnvelope(part);
  const metadata = isRecord(part?.state?.metadata) ? part.state.metadata : null;
  const mcpApp = isRecord(metadata?.mcpApp) ? metadata.mcpApp : null;
  const candidates = [outputEnvelope, metadata, mcpApp].filter(isRecord);
  const contentText = candidates.flatMap((candidate) => (
    Array.isArray(candidate.content)
      ? candidate.content
          .filter((item) => item?.type === 'text')
          .map((item) => String(item.text))
      : []
  ));
  if (typeof part?.state?.output === 'string' && !outputEnvelope) {
    contentText.push(part.state.output);
  }
  const fallbackSignals = contentText.filter((text) => APP_FALLBACK_PATTERN.test(text));
  return {
    isError: candidates.some((candidate) => candidate.isError === true),
    fallbackDetected: fallbackSignals.length > 0,
    fallbackSignals: fallbackSignals.map((text) => text.slice(0, 240)),
  };
};

export const parseModelSelector = (selector) => {
  const value = String(selector || '').trim();
  const slash = value.indexOf('/');
  assert(slash > 0 && slash < value.length - 1, `Invalid model selector ${value}`);
  return { providerID: value.slice(0, slash), modelID: value.slice(slash + 1) };
};

// WP-3: the semantic fixture is a reviewed constant so the browser verifier
// can assert the requested count against the Tool projection and the
// authoritative semantic document without any default-value fallback.
export const SEMANTIC_CREATE_FIXTURE_ELEMENTS = [
    {
      kind: 'frame',
      id: 'acceptance-frame',
      x: 60,
      y: 60,
      width: 1080,
      height: 520,
      name: 'OpenChamber MCP 2026 acceptance topology',
    },
    {
      kind: 'geo',
      id: 'gateway',
      x: 120,
      y: 210,
      width: 240,
      height: 128,
      shape: 'rectangle',
      text: 'API Gateway',
      parentId: 'acceptance-frame',
      style: { color: 'blue', fill: 'semi', size: 'm' },
    },
    {
      kind: 'geo',
      id: 'orders',
      x: 480,
      y: 210,
      width: 240,
      height: 128,
      shape: 'rectangle',
      text: 'Order Service',
      parentId: 'acceptance-frame',
      style: { color: 'green', fill: 'semi', size: 'm' },
    },
    {
      kind: 'geo',
      id: 'payments',
      x: 840,
      y: 210,
      width: 240,
      height: 128,
      shape: 'rectangle',
      text: 'Payment Service',
      parentId: 'acceptance-frame',
      style: { color: 'orange', fill: 'semi', size: 'm' },
    },
    {
      kind: 'arrow',
      id: 'gateway-orders',
      x: 360,
      y: 274,
      width: 120,
      height: 1,
      points: [{ x: 360, y: 274 }, { x: 480, y: 274 }],
      start: { elementId: 'gateway', anchorX: 1, anchorY: 0.5 },
      end: { elementId: 'orders', anchorX: 0, anchorY: 0.5 },
      text: 'checkout',
      parentId: 'acceptance-frame',
      style: { color: 'grey', size: 'm' },
    },
    {
      kind: 'arrow',
      id: 'orders-payments',
      x: 720,
      y: 274,
      width: 120,
      height: 1,
      points: [{ x: 720, y: 274 }, { x: 840, y: 274 }],
      start: { elementId: 'orders', anchorX: 1, anchorY: 0.5 },
      end: { elementId: 'payments', anchorX: 0, anchorY: 0.5 },
      text: 'charge',
      parentId: 'acceptance-frame',
      style: { color: 'grey', size: 'm' },
    },
    {
      kind: 'note',
      id: 'acceptance-note',
      x: 440,
      y: 390,
      width: 360,
      height: 112,
      text: 'MCP 2026 semantic contract\nCreated by Agent tool call',
      parentId: 'acceptance-frame',
      style: { color: 'violet', size: 'm' },
    },
  ];
export const SEMANTIC_CREATE_REQUESTED_ELEMENT_COUNT =
  SEMANTIC_CREATE_FIXTURE_ELEMENTS.length;

export const buildSemanticCreatePrompt = ({ server, canvasId }) => {
  const tool = `${server}_tldraw_create_view`;
  const elements = SEMANTIC_CREATE_FIXTURE_ELEMENTS;

  return [
    `Call the exact tool ${tool} once.`,
    'Do not use Excalidraw, HTML Artifact, interactive_ui, or legacy tldraw_open_canvas.',
    `Use canvasId ${canvasId}, createIfMissing true, and pass this exact semantic elements JSON:`,
    JSON.stringify(elements),
    'After the tool completes, briefly state the canvas ID. Do not call any second drawing tool.',
  ].join('\n');
};

export const inspectRegistry = ({ payload, server }) => {
  const definitions = Object.values(payload?.apps ?? payload ?? {}).filter(isRecord);
  const byTool = new Map(
    definitions
      .filter((definition) => definition.server === server && typeof definition.tool === 'string')
      .map((definition) => [definition.tool, definition]),
  );
  const read = (tool) => {
    const definition = byTool.get(tool);
    assert(definition, `${server} did not register ${tool}`);
    assert.match(definition.meta?.resourceUri ?? '', /^ui:\/\//, `${server}/${tool} has no ui:// resource`);
    return {
      tool,
      visibility: [...(definition.meta?.visibility ?? [])].sort(),
      resourceUri: definition.meta.resourceUri,
    };
  };

  const modelTools = TLDRAW_MODEL_TOOLS.map(read);
  const appOnlyTools = TLDRAW_APP_ONLY_TOOLS.map(read);
  for (const entry of modelTools) {
    assert.deepEqual(entry.visibility, ['app', 'model'], `${server}/${entry.tool} must be model+app visible`);
  }
  for (const entry of appOnlyTools) {
    assert.deepEqual(entry.visibility, ['app'], `${server}/${entry.tool} leaked into the model tool list`);
  }
  const resources = new Set([...modelTools, ...appOnlyTools].map((entry) => entry.resourceUri));
  assert.equal(resources.size, 1, `${server} tool definitions do not share one App resource`);
  return { modelTools, appOnlyTools, resourceUri: [...resources][0] };
};

const extractCanvasState = (part) => {
  const structured = part?.state?.metadata?.structuredContent;
  if (isRecord(structured)) return structured;
  if (isRecord(part?.state?.metadata?.mcpApp?.structuredContent)) {
    return part.state.metadata.mcpApp.structuredContent;
  }
  if (typeof part?.state?.output === 'string') {
    try {
      const parsed = JSON.parse(part.state.output);
      if (isRecord(parsed?.structuredContent)) return parsed.structuredContent;
      if (isRecord(parsed)) return parsed;
    } catch {
      // Text output is still useful for diagnostics, but it is not structured evidence.
    }
  }
  return null;
};

export const findSemanticCreateToolPart = ({ messages, server, canvasId }) => {
  const expectedTool = `${server}_tldraw_create_view`;
  const parts = messages
    .flatMap((message) => message?.parts ?? [])
    .filter((part) => part?.type === 'tool' && part?.state?.status === 'completed');
  const part = parts.find((candidate) => (
    candidate.tool === expectedTool
    && candidate.state?.input?.canvasId === canvasId
  ));
  assert(part, `The model did not complete ${expectedTool} for ${canvasId}`);
  const outcome = inspectToolOutcome(part);
  assert.equal(outcome.isError, false, `${expectedTool} completed with isError=true`);
  assert.equal(
    outcome.fallbackDetected,
    false,
    `${expectedTool} returned an MCP App fallback: ${outcome.fallbackSignals.join('; ')}`,
  );
  const structuredContent = extractCanvasState(part);
  assert(structuredContent, `${expectedTool} completed without structuredContent`);
  const returnedCanvasId = structuredContent.canvasId ?? structuredContent.canvas?.id;
  assert.equal(returnedCanvasId, canvasId, `${expectedTool} returned a different canvas`);
  const revision = structuredContent.revision ?? structuredContent.canvas?.revision;
  assert(Number.isInteger(revision) && revision > 0, `${expectedTool} returned an invalid revision`);
  return { part, structuredContent, canvasId: returnedCanvasId, revision, outcome };
};

const crc32Table = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return crc >>> 0;
});

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, data) => {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
};

export const PATTERNED_PNG_FEATURE_COLORS = [
  [24, 34, 56],
  [255, 214, 10],
  [37, 99, 235],
  [16, 185, 129],
  [244, 63, 94],
  [168, 85, 247],
  [250, 250, 250],
  [249, 115, 22],
];

export const createPatternedPngBuffer = ({ width = 96, height = 64 } = {}) => {
  assert(Number.isInteger(width) && width >= 16 && width <= 512, 'Patterned PNG width is out of bounds');
  assert(Number.isInteger(height) && height >= 16 && height <= 512, 'Patterned PNG height is out of bounds');
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 4;
      const left = x < width / 2;
      const top = y < height / 2;
      const diagonal = Math.abs((x / width) - (y / height)) < 0.08;
      const border = x < 4 || y < 4 || x >= width - 4 || y >= height - 4;
      const whiteMarker = x >= width * 0.12 && x < width * 0.24 && y >= height * 0.70 && y < height * 0.86;
      const orangeMarker = x >= width * 0.70 && x < width * 0.84 && y >= height * 0.12 && y < height * 0.28;
      const color = border
        ? [24, 34, 56]
        : whiteMarker
          ? [250, 250, 250]
          : orangeMarker
            ? [249, 115, 22]
        : diagonal
          ? [255, 214, 10]
          : left && top
            ? [37, 99, 235]
            : !left && top
              ? [16, 185, 129]
              : left
                ? [244, 63, 94]
                : [168, 85, 247];
      row[offset] = color[0];
      row[offset + 1] = color[1];
      row[offset + 2] = color[2];
      row[offset + 3] = 255;
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};

const decodePngPixels = (buffer) => {
  let offset = 8;
  let header = null;
  const compressed = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    assert(dataEnd + 4 <= buffer.length, `PNG ${type} chunk is truncated`);
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      compressed.push(data);
    }
    offset = dataEnd + 4;
    if (type === 'IEND') break;
  }
  assert(header, 'PNG has no decoded IHDR');
  assert.equal(header.bitDepth, 8, `PNG bit depth ${header.bitDepth} is not supported by acceptance decoding`);
  assert.equal(header.interlace, 0, 'Interlaced PNG cannot provide deterministic pixel evidence');
  const channelsByColorType = { 0: 1, 2: 3, 4: 2, 6: 4 };
  const channels = channelsByColorType[header.colorType];
  assert(channels, `PNG color type ${header.colorType} is not supported by acceptance decoding`);
  const stride = header.width * channels;
  const encoded = inflateSync(Buffer.concat(compressed));
  assert.equal(encoded.length, (stride + 1) * header.height, 'PNG scanline bytes do not match its dimensions');
  const pixels = Buffer.alloc(stride * header.height);
  const paeth = (left, up, upperLeft) => {
    const prediction = left + up - upperLeft;
    const leftDistance = Math.abs(prediction - left);
    const upDistance = Math.abs(prediction - up);
    const upperLeftDistance = Math.abs(prediction - upperLeft);
    if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
    return upDistance <= upperLeftDistance ? up : upperLeft;
  };
  for (let y = 0; y < header.height; y += 1) {
    const encodedRow = y * (stride + 1);
    const filter = encoded[encodedRow];
    assert(filter >= 0 && filter <= 4, `PNG row ${y} uses unsupported filter ${filter}`);
    for (let x = 0; x < stride; x += 1) {
      const source = encoded[encodedRow + 1 + x];
      const target = y * stride + x;
      const left = x >= channels ? pixels[target - channels] : 0;
      const up = y > 0 ? pixels[target - stride] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[target - stride - channels] : 0;
      const predictor = filter === 0
        ? 0
        : filter === 1
          ? left
          : filter === 2
            ? up
            : filter === 3
              ? Math.floor((left + up) / 2)
              : paeth(left, up, upperLeft);
      pixels[target] = (source + predictor) & 0xff;
    }
  }
  return { ...header, channels, pixels };
};

const inspectPngContent = (buffer, { expectedFeatureColors = [], featureColorTolerance = 18 } = {}) => {
  const decoded = decodePngPixels(buffer);
  const colors = new Map();
  const featureColorMatches = expectedFeatureColors.map((rgb) => ({ rgb: [...rgb], pixels: 0 }));
  let opaquePixels = 0;
  for (let offset = 0; offset < decoded.pixels.length; offset += decoded.channels) {
    const red = decoded.pixels[offset];
    const green = decoded.channels === 1 || decoded.channels === 2 ? red : decoded.pixels[offset + 1];
    const blue = decoded.channels === 1 || decoded.channels === 2 ? red : decoded.pixels[offset + 2];
    const alpha = decoded.channels === 2
      ? decoded.pixels[offset + 1]
      : decoded.channels === 4
        ? decoded.pixels[offset + 3]
        : 255;
    if (alpha > 16) opaquePixels += 1;
    if (alpha > 200) {
      for (const feature of featureColorMatches) {
        if (
          Math.abs(red - feature.rgb[0]) <= featureColorTolerance
          && Math.abs(green - feature.rgb[1]) <= featureColorTolerance
          && Math.abs(blue - feature.rgb[2]) <= featureColorTolerance
        ) feature.pixels += 1;
      }
    }
    const key = `${red},${green},${blue},${alpha}`;
    colors.set(key, (colors.get(key) ?? 0) + 1);
  }
  const totalPixels = decoded.width * decoded.height;
  const dominantPixels = Math.max(0, ...colors.values());
  return {
    colorType: decoded.colorType,
    distinctColors: colors.size,
    opaquePixels,
    nonDominantPixels: totalPixels - dominantPixels,
    totalPixels,
    featureColorTolerance,
    featureColorMatches,
  };
};

export const validateSvgBuffer = (buffer, expectedLabels = [], {
  expectedImageSha256,
  requireRichTextStyles = false,
} = {}) => {
  assert(Buffer.isBuffer(buffer) && buffer.length > 200, 'SVG download is empty or implausibly small');
  const text = buffer.toString('utf8');
  assert.match(text, /<svg\b/i, 'SVG download has no SVG root');
  assert.match(text, /<\/(svg)>/i, 'SVG download is truncated');
  for (const label of expectedLabels) {
    assert(text.includes(label), `SVG download is missing ${label}`);
  }
  const embeddedImages = [...text.matchAll(/(?:href|src)=["']data:image\/(?:png|jpeg|webp);base64,([^"']+)["']/gi)]
    .map((match) => {
      const bytes = Buffer.from(match[1], 'base64');
      return {
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    });
  const imageDigests = embeddedImages.map((image) => image.sha256);
  if (expectedImageSha256) {
    const retainedImage = embeddedImages.find((image) => image.sha256 === expectedImageSha256);
    assert(
      retainedImage && retainedImage.bytes > 64,
      `SVG download does not retain the uploaded image digest ${expectedImageSha256}`,
    );
  }
  const richTextStyles = {
    foreignObject: /<foreignObject\b/i.test(text),
    styleElement: /<style\b/i.test(text),
    fontFamily: /(?:font-family|fontFamily)[=:]/i.test(text),
    fontSize: /(?:font-size|fontSize)[=:]/i.test(text),
    paint: /(?:fill|stroke)=["'][^"']+["']/i.test(text),
  };
  if (requireRichTextStyles) {
    assert.equal(
      Object.values(richTextStyles).every(Boolean),
      true,
      `SVG download lost rich text/style evidence: ${JSON.stringify(richTextStyles)}`,
    );
  }
  return { bytes: buffer.length, labels: [...expectedLabels], embeddedImages, imageDigests, richTextStyles };
};

export const validatePngBuffer = (buffer, {
  requireNonBackground = false,
  expectedFeatureColors = [],
  featureColorTolerance = 18,
  minimumFeaturePixels = 4,
} = {}) => {
  assert(Buffer.isBuffer(buffer) && buffer.length > 1_000, 'PNG download is empty or implausibly small');
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG signature is invalid');
  assert.equal(buffer.subarray(12, 16).toString('ascii'), 'IHDR', 'PNG has no IHDR chunk');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  assert(width >= 100 && height >= 100, `PNG dimensions are too small (${width}x${height})`);
  const content = requireNonBackground || expectedFeatureColors.length > 0
    ? inspectPngContent(buffer, { expectedFeatureColors, featureColorTolerance })
    : null;
  if (content) {
    assert(content.distinctColors >= 8, `PNG has only ${content.distinctColors} distinct colors`);
    assert(content.opaquePixels >= 100, `PNG has only ${content.opaquePixels} visible pixels`);
    assert(content.nonDominantPixels >= 100, `PNG has only ${content.nonDominantPixels} non-background pixels`);
    for (const feature of content.featureColorMatches) {
      assert(
        feature.pixels >= minimumFeaturePixels,
        `PNG retains only ${feature.pixels} pixels near uploaded image feature rgb(${feature.rgb.join(',')})`,
      );
    }
  }
  return { bytes: buffer.length, width, height, ...(content ? { content } : {}) };
};

export const validateEditorInteractionEvidence = ({
  semanticPatch,
  operationSummary,
  renamedElementId,
  renamedText,
  movedElementId,
  connectedElementId,
}) => {
  assert(isRecord(semanticPatch), 'Save did not include a semantic patch');
  assert(Array.isArray(semanticPatch.operations), 'Save semantic patch did not expose reviewed operations');
  assert(isRecord(operationSummary), 'Save did not include an operation summary');

  const operations = semanticPatch.operations.filter(isRecord);
  const createdGeo = operations.find((operation) => (
    operation.op === 'create'
    && operation.kind === 'geo'
    && typeof operation.id === 'string'
    && operation.id.startsWith('tldraw-')
  ));
  assert(createdGeo, 'Real rectangle gesture did not create a semantic geo element');

  const renamed = operations.find((operation) => (
    operation.op === 'update'
    && operation.id === renamedElementId
    && operation.text === renamedText
    && Array.isArray(operation.changeKeys)
    && operation.changeKeys.includes('text')
  ));
  assert(renamed, `Real text edit did not rename ${renamedElementId} to ${renamedText}`);

  const moved = operations.find((operation) => (
    operation.op === 'update'
    && operation.id === movedElementId
    && Array.isArray(operation.changeKeys)
    && (operation.changeKeys.includes('x') || operation.changeKeys.includes('y'))
  ));
  assert(moved, `Real pointer drag did not move ${movedElementId}`);

  const connected = operations.find((operation) => {
    if (operation.op !== 'create' || operation.kind !== 'arrow') return false;
    const endpointIds = [operation.start?.elementId, operation.end?.elementId].filter(Boolean);
    return endpointIds.includes(createdGeo.id) && endpointIds.includes(connectedElementId);
  });
  assert(connected, `Real arrow gesture did not bind the new geo element to ${connectedElementId}`);

  assert(Number(operationSummary.added) >= 2, 'Save summary did not count the added geo and connector');
  assert(Number(operationSummary.movedOrEdited) >= 2, 'Save summary did not count the move and rename');

  return {
    createdElementId: createdGeo.id,
    connectorElementId: connected.id,
    renamedElementId,
    renamedText,
    movedElementId,
    connectedElementId,
    operationCount: operations.length,
    operationSummary: {
      added: Number(operationSummary.added),
      movedOrEdited: Number(operationSummary.movedOrEdited),
      removed: Number(operationSummary.removed ?? 0),
    },
  };
};

const CHECKPOINT_NON_PASS_KEYS = ["blocked", "notRun", "not-run", "skipped"];
const CHECKPOINT_NON_PASS_STATUSES = new Set([
  "blocked",
  "not-run",
  "not_run",
  "skipped",
  "cancelled",
    "canceled",
]);

const CHECKPOINT_NON_PASS_KEY_PATTERN = /(?:blocked|not[-_]?run|skipped)$/i;

export const inspectCheckpointOutcome = (value) => {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    return { pass: false, reason: 'checkpoint detail must be a non-empty record' };
  }
  const queue = [value];
  const seen = new Set();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!isRecord(current) || seen.has(current)) continue;
    seen.add(current);
    for (const [key, value] of Object.entries(current)) {
      if (
        (CHECKPOINT_NON_PASS_KEYS.includes(key) || CHECKPOINT_NON_PASS_KEY_PATTERN.test(key))
        && value !== false
        && value !== null
        && value !== undefined
      ) {
        return { pass: false, reason: `resolved checkpoint contains ${key}` };
      }
    }
    if (
      typeof current.status === "string" &&
      CHECKPOINT_NON_PASS_STATUSES.has(current.status.toLowerCase())
    ) {
      return { pass: false, reason: `resolved checkpoint status is ${current.status}` };
    }
    if (current.ok === false) {
      return { pass: false, reason: "resolved checkpoint reported ok=false" };
    }
    for (const nested of Object.values(current)) {
      if (isRecord(nested)) queue.push(nested);
      else if (Array.isArray(nested)) queue.push(...nested);
    }
  }
  return { pass: true, reason: null };
};

export const deriveRequiredCheckpointOk = (checkpoints, requiredNames) => {
  if (!Array.isArray(checkpoints) || !Array.isArray(requiredNames) || requiredNames.length === 0) {
    return false;
  }
  const byName = new Map(
    checkpoints
      .filter((checkpoint) => isRecord(checkpoint) && typeof checkpoint.name === "string")
      .map((checkpoint) => [checkpoint.name, checkpoint]),
  );
  return requiredNames.every((name) => {
    const checkpoint = byName.get(name);
    return checkpoint?.status === "pass" && inspectCheckpointOutcome(checkpoint.detail).pass;
  });
};

export const validateSemanticElementCountEvidence = ({
  requestedElementCount,
  toolResultElementCount,
  authoritativeStateElementCount,
}) => {
  for (const [label, value] of [
    ['requestedElementCount', requestedElementCount],
    ['toolResultElementCount', toolResultElementCount],
    ['authoritativeStateElementCount', authoritativeStateElementCount],
  ]) {
    assert(
      Number.isSafeInteger(value) && value >= 0,
      `${label} must be a non-negative integer; received ${value}`,
    );
  }
  assert.equal(
    toolResultElementCount,
    authoritativeStateElementCount,
    `Tool result count ${toolResultElementCount} differs from authoritative state count ${authoritativeStateElementCount}`,
  );
  assert(
    toolResultElementCount >= requestedElementCount,
    `Authoritative semantic count ${authoritativeStateElementCount} is below requested count ${requestedElementCount}`,
  );
  return {
    requestedElementCount,
    toolResultElementCount,
    authoritativeStateElementCount,
  };
};

export const assessFailureEvidence = (evidence) => {
  const reasons = [];
  if (!isRecord(evidence)) reasons.push("missing-evidence");
  if (!evidence?.failureScreenshot) reasons.push("missing-failure-screenshot");
  if (!isRecord(evidence?.failureSurfaceState)) reasons.push("missing-final-surface-state");
  if (!Array.isArray(evidence?.failureSurfaceState?.appContexts)) {
    reasons.push("missing-final-app-contexts");
  }
  return { pass: reasons.length === 0, reasons };
};

export const serializeError = (error) => ({
  name: error?.name ?? 'Error',
  message: String(error?.message ?? error),
  stack: typeof error?.stack === 'string'
    ? error.stack.split('\n').slice(0, 12).join('\n')
    : undefined,
});
