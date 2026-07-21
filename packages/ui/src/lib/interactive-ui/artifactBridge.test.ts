import { describe, expect, test } from 'bun:test';
import {
  createHTMLArtifactBridgeRateLimiter,
  createHTMLArtifactHostInitMessage,
  isHTMLArtifactBrokerNavigationMessage,
  parseHTMLArtifactBridgeMessage,
} from './artifactBridge';

const message = (overrides: Record<string, unknown> = {}) => ({
  source: 'openchamber-artifact',
  direction: 'artifact-to-host',
  bridgeVersion: 1,
  channelId: 'channel-1',
  sequence: 1,
  type: 'artifact.resize',
  payload: { height: 480 },
  ...overrides,
});

describe('HTML Artifact bridge parser', () => {
  test('builds a bounded host init snapshot with the current viewport and theme context', () => {
    expect(createHTMLArtifactHostInitMessage({
      channelId: 'channel-1',
      mode: 'inline',
      locale: 'zh-CN',
      timezone: 'Asia/Singapore',
      reducedMotion: true,
      theme: 'dark',
      tokens: { '--ocix-surface': '#111' },
      viewport: { width: 680, height: 420 },
    })).toEqual({
      source: 'openchamber-host',
      direction: 'host-to-artifact',
      bridgeVersion: 1,
      channelId: 'channel-1',
      sequence: 1,
      type: 'host.init',
      payload: {
        mode: 'inline',
        locale: 'zh-CN',
        timezone: 'Asia/Singapore',
        reducedMotion: true,
        theme: 'dark',
        tokens: { '--ocix-surface': '#111' },
        viewport: { width: 680, height: 420 },
      },
    });
  });

  test('accepts a strict message on the active channel', () => {
    expect(parseHTMLArtifactBridgeMessage(message(), 'channel-1', 0)).toEqual({
      type: 'artifact.resize',
      payload: { height: 480 },
      sequence: 1,
    });
  });

  test('rejects forged channels, replayed sequences, unknown fields and oversized payloads', () => {
    expect(parseHTMLArtifactBridgeMessage(message(), 'another-channel', 0)).toBeNull();
    expect(parseHTMLArtifactBridgeMessage(message(), 'channel-1', 1)).toBeNull();
    expect(parseHTMLArtifactBridgeMessage(message({ privileged: true }), 'channel-1', 0)).toBeNull();
    expect(parseHTMLArtifactBridgeMessage(message({
      type: 'artifact.copyText',
      payload: { text: 'x'.repeat(9_000) },
    }), 'channel-1', 0)).toBeNull();
  });

  test('rejects non-http links and host capability requests', () => {
    expect(parseHTMLArtifactBridgeMessage(message({
      type: 'artifact.openExternal',
      payload: { url: 'javascript:alert(1)' },
    }), 'channel-1', 0)).toBeNull();
    expect(parseHTMLArtifactBridgeMessage(message({
      type: 'artifact.callTool',
      payload: { tool: 'bash' },
    }), 'channel-1', 0)).toBeNull();
  });

  test('accepts only the strict broker navigation signal on the active channel', () => {
    const brokerMessage = {
      source: 'openchamber-artifact-broker',
      direction: 'broker-to-host',
      bridgeVersion: 1,
      channelId: 'channel-1',
      type: 'broker.navigationBlocked',
      payload: {},
    };
    expect(isHTMLArtifactBrokerNavigationMessage(brokerMessage, 'channel-1')).toBe(true);
    expect(isHTMLArtifactBrokerNavigationMessage({ ...brokerMessage, channelId: 'forged' }, 'channel-1')).toBe(false);
    expect(isHTMLArtifactBrokerNavigationMessage({ ...brokerMessage, privileged: true }, 'channel-1')).toBe(false);
    expect(isHTMLArtifactBrokerNavigationMessage({ ...brokerMessage, payload: { url: 'https://example.com' } }, 'channel-1')).toBe(false);
  });

  test('bounds total messages and resize floods in independent rolling windows', () => {
    const limiter = createHTMLArtifactBridgeRateLimiter({ messageLimit: 3, resizeLimit: 2 });
    expect(limiter.allowMessage(0)).toBe(true);
    expect(limiter.allowMessage(10)).toBe(true);
    expect(limiter.allowMessage(20)).toBe(true);
    expect(limiter.allowMessage(30)).toBe(false);
    expect(limiter.allowResize(30)).toBe(true);
    expect(limiter.allowResize(40)).toBe(true);
    expect(limiter.allowResize(50)).toBe(false);
    expect(limiter.allowMessage(1_000)).toBe(true);
    expect(limiter.allowResize(1_030)).toBe(true);
    limiter.reset();
    expect(limiter.allowMessage(1_031)).toBe(true);
    expect(limiter.allowResize(1_031)).toBe(true);
  });
});
