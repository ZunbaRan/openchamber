import { describe, expect, test } from 'bun:test';
import {
  buildReceiverSrcdoc,
  CDN_WHITELIST,
  isSafeStreamingUrl,
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
    if (typeof document !== 'undefined') expect(out).toContain('ok');
    else expect(out).toBe('');
  });

  test('streaming strips nested iframe and javascript urls', () => {
    const html =
      '<a href="javascript:alert(1)">x</a><iframe src="https://evil"></iframe>';
    const out = sanitizeForStreaming(html);
    expect(out).not.toContain('iframe');
    expect(out).not.toContain('javascript');
  });

  test('streaming strips decimal-entity-obfuscated active scheme', () => {
    const html = '<a href="java&#115;cript:alert(1)">x</a>';
    const out = sanitizeForStreaming(html);
    expect(isSafeStreamingUrl('java&#115;cript:alert(1)')).toBe(false);
    expect(out).not.toContain('javascript');
    expect(out).not.toContain('&#115;');
  });

  test('streaming strips hex-entity-obfuscated active scheme', () => {
    const html = '<a href="java&#x73;cript:alert(1)">x</a>';
    const out = sanitizeForStreaming(html);
    expect(isSafeStreamingUrl('java&#x73;cript:alert(1)')).toBe(false);
    expect(out).not.toContain('javascript');
  });

  test('streaming strips named-entity-obfuscated active scheme', () => {
    const html = '<a href="javascript&colon;alert(1)">x</a>';
    const out = sanitizeForStreaming(html);
    expect(isSafeStreamingUrl('javascript&colon;alert(1)')).toBe(false);
    expect(out).not.toContain('javascript');
    expect(out).not.toContain('&colon;');
  });

  test('streaming strips mixed-case and control/whitespace-obfuscated scheme', () => {
    const html =
      '<a href="JaVaScRiPt:alert(1)">a</a>' +
      '<a href="java\u0009script:alert(1)">b</a>' +
      '<a href="java\nscript:alert(1)">c</a>';
    const out = sanitizeForStreaming(html);
    expect(isSafeStreamingUrl('JaVaScRiPt:alert(1)')).toBe(false);
    expect(isSafeStreamingUrl('java\u0009script:alert(1)')).toBe(false);
    expect(out).not.toContain('javascript');
  });

  test('streaming strips SVG xlink:href active scheme', () => {
    const html = '<svg><a xlink:href="javascript:alert(1)">x</a></svg>';
    const out = sanitizeForStreaming(html);
    expect(out).not.toContain('javascript');
  });

  test('streaming strips unquoted active-scheme attributes', () => {
    const html = '<a href=javascript:alert(1)>x</a><a href=data:text/html,x>y</a>';
    const out = sanitizeForStreaming(html);
    expect(out).not.toContain('javascript');
    expect(out).not.toContain('data:');
  });

  test('streaming strips vbscript and data schemes', () => {
    const html = '<a href="vbscript:msgbox(1)">a</a><img src="data:image/svg+xml">';
    const out = sanitizeForStreaming(html);
    expect(out).not.toContain('vbscript');
    expect(out).not.toContain('data:');
  });

  test('streaming URL policy rejects every unknown explicit scheme', () => {
    for (const value of ['intent://x', 'market://x', 'sms:+123', 'custom:payload', 'file:///tmp/x']) {
      expect(isSafeStreamingUrl(value)).toBe(false);
    }
  });

  test('streaming receiver reparses slash-separated attributes and removes multi-URL attributes', () => {
    const html = '<svg><svg/onload=alert(1)><img/src=x/onerror=alert(2) srcset="javascript:x 1x">';
    const out = sanitizeForStreaming(html);
    expect(out).not.toContain('onload');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('srcset');

    const doc = buildReceiverSrcdoc('', false);
    expect(doc).toContain('_sanitizeStreaming(tmp.content)');
    expect(doc).toContain("name.slice(0,2)==='on'");
    expect(doc).toContain('|imagesrcset|ping|srcdoc|srcset|');
    expect(doc).toContain('e.source!==parent');
  });

  test('streaming sanitizer bounds raw UTF-8 input before DOM parsing', () => {
    const LIMIT = 1024 * 1024;
    let reads = 0;
    const synthetic = {
      get length(): number {
        return LIMIT + 1;
      },
      charCodeAt(): number {
        reads += 1;
        if (reads > LIMIT + 1) throw new Error('sanitizer guard read too far');
        return 0x61;
      },
      toString(): never {
        throw new Error('sanitizer guard must not parse or stringify oversized input');
      },
    };

    expect(sanitizeForStreaming(synthetic as unknown as string)).toBe('');
    expect(reads).toBe(LIMIT + 1);
  });

  test('streaming preserves safe relative/fragment and http/https URLs', () => {
    const html =
      '<a href="https://example.com/x">a</a>' +
      '<a href="/relative">b</a>' +
      '<a href="#frag">c</a>' +
      '<img src="https://cdn.example.com/a.png">' +
      '<a href="mailto:a@b.com">d</a>';
    const out = sanitizeForStreaming(html);
    for (const value of ['https://example.com/x', '/relative', '#frag', 'https://cdn.example.com/a.png', 'mailto:a@b.com']) {
      expect(isSafeStreamingUrl(value)).toBe(true);
      // Browser runs DOMPurify and preserves safe values. Headless Bun has no
      // DOM and the production function deliberately fails closed to empty.
      if (typeof document !== 'undefined') expect(out).toContain(value);
    }
    if (typeof document === 'undefined') expect(out).toBe('');
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
