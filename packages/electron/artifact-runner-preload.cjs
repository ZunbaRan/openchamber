'use strict';

const { ipcRenderer } = require('electron');

let runnerLayout = null;
let acknowledgedLayoutRevision = 0;

const normalizeLayout = (value) => {
  if (!value || typeof value !== 'object') return null;
  const width = Math.trunc(Number(value.width));
  const height = Math.trunc(Number(value.height));
  const offsetX = Math.trunc(Number(value.offsetX));
  const offsetY = Math.trunc(Number(value.offsetY));
  const revision = Math.trunc(Number(value.revision));
  if (!Number.isInteger(width) || width < 1 || width > 8_192
    || !Number.isInteger(height) || height < 1 || height > 8_192
    || !Number.isInteger(offsetX) || offsetX < 0 || offsetX > width
    || !Number.isInteger(offsetY) || offsetY < 0 || offsetY > height
    || !Number.isSafeInteger(revision) || revision < 1) return null;
  return { width, height, offsetX, offsetY, revision };
};

const applyRunnerLayout = () => {
  if (!runnerLayout) return;
  const frame = document.querySelector('body[data-ocix-artifact-broker] > iframe');
  if (!(frame instanceof HTMLIFrameElement)) return;
  const { width, height, offsetX, offsetY, revision } = runnerLayout;
  Object.assign(frame.style, {
    position: 'fixed',
    left: `${-offsetX}px`,
    top: `${-offsetY}px`,
    width: `${width}px`,
    height: `${height}px`,
    maxWidth: 'none',
    maxHeight: 'none',
  });
  if (acknowledgedLayoutRevision !== revision) {
    acknowledgedLayoutRevision = revision;
    ipcRenderer.send('openchamber:artifact-runner-layout-applied', { revision });
  }
};

ipcRenderer.on('openchamber:artifact-runner-layout', (_event, value) => {
  const next = normalizeLayout(value);
  if (!next) return;
  runnerLayout = next;
  applyRunnerLayout();
});

addEventListener('DOMContentLoaded', applyRunnerLayout);
new MutationObserver(applyRunnerLayout).observe(document, { childList: true, subtree: true });

const byteLength = (value) => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

const normalizeBoundaryWheel = (value) => {
  if (!value || typeof value !== 'object'
    || value.source !== 'openchamber-artifact-broker-internal'
    || value.type !== 'wheel-boundary') return null;
  const deltaX = Number(value.deltaX ?? 0);
  const deltaY = Number(value.deltaY ?? 0);
  const deltaMode = Math.trunc(Number(value.deltaMode ?? 0));
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)
    || (deltaX === 0 && deltaY === 0) || ![0, 1, 2].includes(deltaMode)) return null;
  return {
    deltaX,
    deltaY,
    deltaMode,
    shiftKey: value.shiftKey === true,
    ctrlKey: value.ctrlKey === true,
    altKey: value.altKey === true,
    metaKey: value.metaKey === true,
  };
};

// This preload deliberately exposes nothing to the main world. It is a narrow
// transport between the broker document's postMessage channel and Electron's
// main-process runner manager.
addEventListener('message', (event) => {
  if (event.source !== window || !event.data || typeof event.data !== 'object') return;
  const boundaryWheel = normalizeBoundaryWheel(event.data);
  if (boundaryWheel) {
    ipcRenderer.send('openchamber:artifact-runner-wheel-boundary', boundaryWheel);
    return;
  }
  const source = event.data.source;
  if (source !== 'openchamber-artifact' && source !== 'openchamber-artifact-broker') return;
  if (byteLength(event.data) > 65_536) return;
  ipcRenderer.send('openchamber:artifact-runner-message', event.data);
});

ipcRenderer.on('openchamber:artifact-runner-host-message', (_event, message) => {
  if (!message || typeof message !== 'object' || byteLength(message) > 2_200_000) return;
  window.postMessage(message, '*');
});
