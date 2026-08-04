import { describe, expect, test } from 'bun:test';
import {
  buildReceiverSrcdoc,
  CDN_WHITELIST,
  sanitizeForIframe,
  sanitizeForStreaming,
} from './sanitizer';

describe('generative-widget sanitizer', () => {
  test('streaming strips scripts and handlers', () => {
    const html =
      '<div onclick="alert(1)"><script>alert(2)</script><p>ok</p></div>';
    const out = sanitizeForStreaming(html);
    expect(out).not.toContain('script');
    expect(out).not.toContain('onclick');
    expect(out).toContain('ok');
  });

  test('streaming strips nested iframe and javascript urls', () => {
    const html =
      '<a href="javascript:alert(1)">x</a><iframe src="https://evil"></iframe>';
    const out = sanitizeForStreaming(html);
    expect(out).not.toContain('iframe');
    expect(out).not.toContain('javascript');
  });

  test('finalize keeps scripts but strips nested iframe', () => {
    const html =
      '<div><script>window.__x=1</script><iframe></iframe><p>hi</p></div>';
    const out = sanitizeForIframe(html);
    expect(out).toContain('<script>');
    expect(out).not.toContain('iframe');
    expect(out).toContain('hi');
  });

  test('receiver srcdoc enforces connect-src none and CDN whitelist', () => {
    const doc = buildReceiverSrcdoc('body{color:red}', true);
    expect(doc).toContain("connect-src 'none'");
    expect(doc).toContain("Content-Security-Policy");
    for (const host of CDN_WHITELIST) {
      expect(doc).toContain(host);
    }
    expect(doc).toContain('class="dark"');
    expect(doc).toContain('widget:ready');
  });
});
