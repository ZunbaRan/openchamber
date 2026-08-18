/**
 * Focused DOM regression coverage for the Generative Widget card:
 *
 * - A non-empty human-readable title is rendered visibly in the card and the
 *   iframe keeps an equal accessible `title`.
 * - The sandbox contract stays intact: `allow-scripts` present, and
 *   `allow-same-origin` absent.
 * - The visible title and the Show code control live in a header above the
 *   iframe and never overlap the iframe or the loading overlay.
 * - Show code toggling keeps working.
 * - Blank/absent titles fall back to a safe iframe title without inventing a
 *   visually prominent fake title.
 * - The card root exposes stable observation markers
 *   (`data-generative-widget-segment`/`-state`/`-title`) and transitions
 *   streaming -> loading -> ready without altering rendering.
 * - MessageBody/ToolPart part markers are covered with static source
 *   assertions, since the minimal DOM stub cannot render the chat pipeline.
 *
 * Follows the repository's Bun/createRoot minimal-DOM-stub pattern (see
 * packages/ui/src/components/ui/number-input.test.tsx): a hand-rolled
 * document/window stub, real React DOM rendering via `createRoot`, and full
 * global cleanup so no roots or listeners leak between tests.
 */

import { describe, expect, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { WidgetRenderer, type WidgetRendererProps } from './WidgetRenderer';

interface FakeClassList {
  add(...classes: string[]): void;
  remove(...classes: string[]): void;
  contains(className: string): boolean;
}

interface FakeStyle {
  setProperty(name: string, value: string): void;
  getPropertyValue(name: string): string;
}

interface FakeNode {
  nodeType: number;
  nodeName: string;
  tagName: string;
  ownerDocument: FakeDocument;
  parentNode: FakeNode | null;
  childNodes: FakeNode[];
  style: FakeStyle & Record<string, unknown>;
  classList: FakeClassList;
  attributes: Record<string, string>;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  removeAttribute(name: string): void;
  addEventListener(): void;
  removeEventListener(): void;
  appendChild(child: FakeNode): FakeNode;
  insertBefore(child: FakeNode, reference: FakeNode | null): FakeNode;
  removeChild(child: FakeNode): FakeNode;
  contains(other: FakeNode): boolean;
  remove(): void;
  focus(): void;
  blur(): void;
  click(): void;
  textContent: string;
  [key: string]: unknown;
}

interface FakeWindow {
  document: FakeDocument;
  navigator: { userAgent: string; platform: string; maxTouchPoints: number };
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  matchMedia(query: string): {
    matches: boolean;
    addEventListener(): void;
    removeEventListener(): void;
  };
  HTMLIFrameElement: unknown;
  HTMLFrameSetElement: unknown;
  HTMLInputElement: unknown;
  HTMLTextAreaElement: unknown;
  HTMLSelectElement: unknown;
  HTMLOptionElement: unknown;
  HTMLAnchorElement: unknown;
}

interface FakeDocument extends FakeNode {
  defaultView: FakeWindow;
  body: FakeNode;
  documentElement: FakeNode;
  createElement(tag: string): FakeNode;
  createTextNode(text: string): FakeNode;
  getElementById(id: string): FakeNode | null;
  activeElement: FakeNode | null;
  HTMLIFrameElement: unknown;
  HTMLFrameSetElement: unknown;
  HTMLInputElement: unknown;
  HTMLTextAreaElement: unknown;
  HTMLSelectElement: unknown;
  HTMLOptionElement: unknown;
  HTMLAnchorElement: unknown;
}

// --- Minimal DOM stub ------------------------------------------------------

const makeTextNode = (text: string, owner: FakeDocument): FakeNode => {
  const node = {
    nodeType: 3,
    nodeName: '#text',
    tagName: '#text',
    ownerDocument: owner,
    parentNode: null,
    childNodes: [],
    style: { setProperty() {}, getPropertyValue: () => '' },
    classList: { add() {}, remove() {}, contains: () => false },
    attributes: {},
    setAttribute() {},
    getAttribute: () => null,
    hasAttribute: () => false,
    removeAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    appendChild: () => node,
    insertBefore: () => node,
    removeChild: () => node,
    contains: () => false,
    remove() {},
    focus() {},
    blur() {},
    click() {},
    textContent: text,
  } as FakeNode;
  return node;
};

const createNode = (tag: string, owner: FakeDocument): FakeNode => {
  const attributes: Record<string, string> = {};
  let text = '';
  const node: FakeNode = {
    nodeType: 1,
    nodeName: tag.toUpperCase(),
    tagName: tag.toUpperCase(),
    ownerDocument: owner,
    parentNode: null,
    childNodes: [],
    style: { setProperty() {}, getPropertyValue: () => '' },
    classList: { add() {}, remove() {}, contains: () => false },
    attributes,
    setAttribute(name: string, value: string) {
      attributes[name] = String(value);
    },
    getAttribute(name: string) {
      return attributes[name] ?? null;
    },
    hasAttribute(name: string) {
      return Object.prototype.hasOwnProperty.call(attributes, name);
    },
    removeAttribute(name: string) {
      delete attributes[name];
    },
    addEventListener() {},
    removeEventListener() {},
    appendChild(child: FakeNode) {
      node.childNodes.push(child);
      child.parentNode = node;
      return child;
    },
    insertBefore(child: FakeNode, reference: FakeNode | null) {
      if (!reference) return node.appendChild(child);
      const index = node.childNodes.indexOf(reference);
      if (index === -1) return node.appendChild(child);
      node.childNodes.splice(index, 0, child);
      child.parentNode = node;
      return child;
    },
    removeChild(child: FakeNode) {
      const index = node.childNodes.indexOf(child);
      if (index !== -1) node.childNodes.splice(index, 1);
      child.parentNode = null;
      return child;
    },
    contains() {
      return false;
    },
    remove() {
      if (node.parentNode) node.parentNode.removeChild(node);
    },
    focus() {},
    blur() {},
    click() {},
    get textContent() {
      if (node.childNodes.length === 0) return text;
      return node.childNodes.map((child) => child.textContent).join('');
    },
    set textContent(value: string) {
      text = String(value);
      node.childNodes.length = 0;
    },
  };
  // The iframe props we assert on may be applied as DOM properties or
  // attributes depending on React's property info table; back both with the
  // same attribute map so `getAttribute` agrees either way.
  for (const prop of ['title', 'sandbox'] as const) {
    Object.defineProperty(node, prop, {
      get() {
        return attributes[prop] ?? '';
      },
      set(value: unknown) {
        attributes[prop] = String(value);
      },
    });
  }
  return node;
};

interface DomStub {
  messageListeners: Map<string, Array<() => void>>;
  restore(): void;
}

const installDomStub = (): DomStub => {
  const messageListeners = new Map<string, Array<() => void>>();
  const window = {
    document: null as unknown as FakeDocument,
    navigator: { userAgent: 'test', platform: 'test', maxTouchPoints: 0 },
    addEventListener(type: string, listener: () => void) {
      const list = messageListeners.get(type) ?? [];
      list.push(listener);
      messageListeners.set(type, list);
    },
    removeEventListener(type: string, listener: () => void) {
      const list = messageListeners.get(type) ?? [];
      const index = list.indexOf(listener);
      if (index !== -1) list.splice(index, 1);
    },
    matchMedia() {
      return { matches: false, addEventListener() {}, removeEventListener() {} };
    },
    HTMLIFrameElement: class {},
    HTMLFrameSetElement: class {},
    HTMLInputElement: class {},
    HTMLTextAreaElement: class {},
    HTMLSelectElement: class {},
    HTMLOptionElement: class {},
    HTMLAnchorElement: class {},
  } as FakeWindow;
  const document = {
    ...createNode('#document', null as unknown as FakeDocument),
    defaultView: window,
    body: null as unknown as FakeNode,
    documentElement: null as unknown as FakeNode,
    createElement(tag: string) {
      return createNode(tag, document);
    },
    createTextNode(text: string) {
      return makeTextNode(text, document);
    },
    getElementById() {
      return null;
    },
    activeElement: null,
    HTMLIFrameElement: class {},
    HTMLFrameSetElement: class {},
    HTMLInputElement: class {},
    HTMLTextAreaElement: class {},
    HTMLSelectElement: class {},
    HTMLOptionElement: class {},
    HTMLAnchorElement: class {},
  } as FakeDocument;
  window.document = document;
  document.body = createNode('body', document);
  document.documentElement = createNode('html', document);

  const globals = globalThis as unknown as {
    document?: FakeDocument;
    window?: FakeWindow;
    navigator?: FakeWindow['navigator'];
    getComputedStyle?: (element: unknown) => { getPropertyValue(name: string): string };
    requestAnimationFrame?: (callback: () => void) => number;
    MutationObserver?: new (callback: () => void) => {
      observe(node: unknown, options?: unknown): void;
      disconnect(): void;
    };
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previous = {
    document: globals.document,
    window: globals.window,
    navigator: globals.navigator,
    getComputedStyle: globals.getComputedStyle,
    requestAnimationFrame: globals.requestAnimationFrame,
    MutationObserver: globals.MutationObserver,
    actEnvironment: globals.IS_REACT_ACT_ENVIRONMENT,
  };

  globals.document = document;
  globals.window = window;
  globals.navigator = window.navigator;
  globals.getComputedStyle = () => ({ getPropertyValue: () => '' });
  globals.requestAnimationFrame = () => 0;
  globals.MutationObserver = class {
    observe() {}
    disconnect() {}
  } as new (callback: () => void) => {
    observe(node: unknown, options?: unknown): void;
    disconnect(): void;
  };
  globals.IS_REACT_ACT_ENVIRONMENT = true;

  return {
    messageListeners,
    restore() {
      globals.document = previous.document;
      globals.window = previous.window;
      globals.navigator = previous.navigator;
      globals.getComputedStyle = previous.getComputedStyle;
      globals.requestAnimationFrame = previous.requestAnimationFrame;
      globals.MutationObserver = previous.MutationObserver;
      globals.IS_REACT_ACT_ENVIRONMENT = previous.actEnvironment;
    },
  };
};

// --- Mount harness ---------------------------------------------------------

interface WidgetHandle {
  container: FakeNode;
  find(tag: string): FakeNode | null;
  findWhere(predicate: (node: FakeNode) => boolean): FakeNode | null;
  findButton(): FakeNode | null;
  findOverlay(): FakeNode | null;
  clickButton(): void;
  rerender(props: WidgetRendererProps): void;
  unmount(): void;
}

const mountWidget = (props: WidgetRendererProps): WidgetHandle => {
  const doc = (globalThis as unknown as { document: FakeDocument }).document;
  const container = doc.createElement('div');
  const root: Root = createRoot(container as unknown as Element);

  act(() => {
    root.render(React.createElement(WidgetRenderer, props));
  });

  const find = (tag: string, node: FakeNode = container): FakeNode | null => {
    if (node.tagName === tag.toUpperCase()) return node;
    for (const child of node.childNodes) {
      const found = find(tag, child);
      if (found) return found;
    }
    return null;
  };
  const findWhere = (
    predicate: (node: FakeNode) => boolean,
    node: FakeNode = container,
  ): FakeNode | null => {
    if (predicate(node)) return node;
    for (const child of node.childNodes) {
      const found = findWhere(predicate, child);
      if (found) return found;
    }
    return null;
  };

  let unmounted = false;
  return {
    container,
    find,
    findWhere,
    findButton: () => find('button'),
    findOverlay: () => findWhere(
      (node) => String(node.style.background ?? '').includes('linear-gradient'),
    ),
    clickButton() {
      const button = find('button');
      if (!button) throw new Error('expected the Show code button');
      const propsKey = Object.keys(button).find((key) => key.startsWith('__reactProps'));
      if (!propsKey) throw new Error('Show code button has no React props');
      const props = (button as unknown as Record<string, { onClick?: (event: unknown) => void }>)[
        propsKey
      ];
      const onClick = props.onClick;
      if (!onClick) throw new Error('Show code button has no onClick handler');
      act(() => {
        onClick({});
      });
    },
    rerender(nextProps: WidgetRendererProps) {
      act(() => {
        root.render(React.createElement(WidgetRenderer, nextProps));
      });
    },
    unmount() {
      if (unmounted) return;
      unmounted = true;
      act(() => {
        root.unmount();
      });
    },
  };
};

const withWidget = <T,>(
  props: WidgetRendererProps,
  body: (handle: WidgetHandle, listeners: Map<string, Array<() => void>>) => T,
): T => {
  const stub = installDomStub();
  const handle = mountWidget(props);
  try {
    return body(handle, stub.messageListeners);
  } finally {
    try {
      handle.unmount();
    } catch {
      // Global restoration must still run even if teardown misbehaves.
    }
    stub.restore();
  }
};

// --- Tests -----------------------------------------------------------------

describe('WidgetRenderer visible title and sandbox contract', () => {
  test('renders a non-empty title visibly and mirrors it on the iframe title', () => {
    withWidget({
      widgetCode: '<div>Hello world</div>',
      isStreaming: false,
      title: '  Hello Widget  ',
    }, (handle) => {
      const iframe = handle.find('iframe');
      expect(iframe).not.toBeNull();

      // The trimmed human-readable title is visible in the card.
      expect(handle.container.textContent).toContain('Hello Widget');
      // The iframe keeps an equal accessible title.
      expect(iframe?.getAttribute('title')).toBe('Hello Widget');
      // Sandbox contract: scripts allowed, same-origin never allowed.
      expect(iframe?.getAttribute('sandbox')).toContain('allow-scripts');
      expect(iframe?.getAttribute('sandbox')).not.toContain('allow-same-origin');
    });
  });

  test('keeps the title and Show code control above the iframe, not overlapping it or the overlay', () => {
    withWidget({
      widgetCode: '<div>Counter</div>',
      isStreaming: true,
      title: 'Counter',
      showOverlay: true,
    }, (handle) => {
      const iframe = handle.find('iframe');
      const button = handle.findButton();
      expect(button).not.toBeNull();
      const header = button?.parentNode;
      expect(header).not.toBeNull();

      // The header row carries the title and the control together.
      expect(header?.textContent).toContain('Counter');
      expect(header?.textContent).toContain('Show code');

      // The header is a sibling rendered before the iframe wrapper, so the
      // control and the title never overlap the iframe.
      const card = header?.parentNode;
      const wrapper = iframe?.parentNode;
      expect(card).not.toBeNull();
      expect(wrapper).not.toBeNull();
      expect(card?.childNodes.indexOf(header as FakeNode)).toBeLessThan(
        card?.childNodes.indexOf(wrapper as FakeNode) ?? -1,
      );
      expect(header).not.toBe(wrapper);

      // The loading overlay is scoped to the iframe wrapper, so it cannot
      // cover the title or the Show code control either.
      const overlay = handle.findOverlay();
      expect(overlay).not.toBeNull();
      expect(overlay?.parentNode).toBe(wrapper);
    });
  });

  test('falls back to a safe iframe title without inventing a visible title when blank', () => {
    withWidget({
      widgetCode: '<div>A</div>',
      isStreaming: false,
      title: '   ',
    }, (handle) => {
      expect(handle.find('iframe')?.getAttribute('title')).toBe('Widget');
      // The header contains only the Show code control, no fake title.
      expect(handle.findButton()?.parentNode?.textContent.trim()).toBe('Show code');
    });

    withWidget({
      widgetCode: '<div>B</div>',
      isStreaming: false,
    }, (handle) => {
      expect(handle.find('iframe')?.getAttribute('title')).toBe('Widget');
      expect(handle.findButton()?.parentNode?.textContent.trim()).toBe('Show code');
    });
  });

  test('Show code toggling still works', () => {
    const code = '<div id="marker">secret</div>';
    withWidget({
      widgetCode: code,
      isStreaming: false,
      title: 'Toggle',
    }, (handle) => {
      const iframe = handle.find('iframe');
      expect(handle.container.textContent).not.toContain('<div id="marker">');

      handle.clickButton();
      expect(handle.container.textContent).toContain('<div id="marker">');
      expect(iframe?.style.display).toBe('none');

      handle.clickButton();
      expect(iframe?.style.display).toBe('block');
      expect(handle.container.textContent).not.toContain('<div id="marker">');
    });
  });

  test('removes the window message listener on unmount', () => {
    withWidget({
      widgetCode: '<div>Cleanup</div>',
      isStreaming: false,
      title: 'Cleanup',
    }, (handle, listeners) => {
      expect(listeners.get('message')?.length).toBe(1);
      handle.unmount();
      expect(listeners.get('message')?.length).toBe(0);
    });
  });
});

describe('WidgetRenderer segment observation markers', () => {
  const findWidgetRoot = (handle: WidgetHandle): FakeNode | null =>
    handle.findWhere((node) => node.getAttribute('data-generative-widget-segment') === 'widget');

  test('marks the card root as a widget segment with an initial loading state', () => {
    withWidget({
      widgetCode: '<div>Seg</div>',
      isStreaming: false,
      title: 'Seg',
    }, (handle) => {
      const root = findWidgetRoot(handle);
      expect(root).not.toBeNull();
      // The marker lives on the card root: the header (title/Show code) and
      // the iframe both sit inside the marked segment.
      const isDescendantOf = (node: FakeNode | null): boolean => {
        let current: FakeNode | null = node;
        while (current) {
          if (current === root) return true;
          current = current.parentNode;
        }
        return false;
      };
      expect(isDescendantOf(handle.findButton())).toBe(true);
      expect(isDescendantOf(handle.find('iframe'))).toBe(true);
      expect(root?.getAttribute('data-generative-widget-state')).toBe('loading');
    });
  });

  test('transitions streaming -> loading -> ready while preserving rendering', () => {
    withWidget({
      widgetCode: '<div>S</div>',
      isStreaming: true,
      title: 'S',
    }, (handle, listeners) => {
      const root = () => findWidgetRoot(handle);
      expect(root()?.getAttribute('data-generative-widget-state')).toBe('streaming');

      // Streaming stops: iframe/finalization is not ready yet -> loading.
      handle.rerender({ widgetCode: '<div>S</div>', isStreaming: false, title: 'S' });
      expect(root()?.getAttribute('data-generative-widget-state')).toBe('loading');

      // The card itself keeps rendering the title/control/iframe while loading.
      expect(root()?.textContent).toContain('S');
      expect(root()?.textContent).toContain('Show code');
      expect(handle.find('iframe')).not.toBeNull();

      // Widget reaches its final ready state (scriptsReady / finalize path).
      const messageListener = listeners.get('message')?.[0];
      expect(messageListener).toBeDefined();
      act(() => {
        (messageListener as (event: unknown) => void)({
          data: { type: 'widget:scriptsReady' },
          source: undefined,
        });
      });
      expect(root()?.getAttribute('data-generative-widget-state')).toBe('ready');

      // Rendering is preserved after the transition: title still visible, the
      // iframe still mounted, and the Show code control still toggles.
      expect(root()?.textContent).toContain('S');
      expect(handle.find('iframe')).not.toBeNull();
      handle.clickButton();
      expect(root()?.textContent).toContain('<div>S</div>');
    });
  });

  test('keeps streaming priority over a stale final state', () => {
    withWidget({
      widgetCode: '<div>P</div>',
      isStreaming: false,
    }, (handle, listeners) => {
      const messageListener = listeners.get('message')?.[0];
      expect(messageListener).toBeDefined();
      act(() => {
        (messageListener as (event: unknown) => void)({
          data: { type: 'widget:scriptsReady' },
          source: undefined,
        });
      });
      expect(findWidgetRoot(handle)?.getAttribute('data-generative-widget-state')).toBe('ready');

      handle.rerender({ widgetCode: '<div>P</div>', isStreaming: true });
      expect(findWidgetRoot(handle)?.getAttribute('data-generative-widget-state')).toBe('streaming');
    });
  });

  test('exposes data-generative-widget-title only for a normalized visible title', () => {
    withWidget({
      widgetCode: '<div>T</div>',
      isStreaming: false,
      title: '  Trim Me  ',
    }, (handle) => {
      expect(findWidgetRoot(handle)?.getAttribute('data-generative-widget-title')).toBe('Trim Me');
    });

    withWidget({
      widgetCode: '<div>T</div>',
      isStreaming: false,
      title: '   ',
    }, (handle) => {
      expect(findWidgetRoot(handle)?.hasAttribute('data-generative-widget-title')).toBe(false);
    });

    withWidget({
      widgetCode: '<div>T</div>',
      isStreaming: false,
    }, (handle) => {
      expect(findWidgetRoot(handle)?.hasAttribute('data-generative-widget-title')).toBe(false);
    });
  });
});

describe('static message-part marker contract', () => {
  // MessageBody and ToolPart need the full chat pipeline, which the minimal
  // DOM stub cannot render; assert their stable marker attributes directly
  // against the source so the observation contract stays regression-covered.
  // Source is read through DOM-only APIs (fetch over a file: URL) so the
  // assertion stays type-clean under the UI package's restricted types config.
  const readSource = async (relative: string): Promise<string> =>
    (await fetch(new URL(relative, import.meta.url))).text();

  test('MessageBody assistant text wrappers carry stable part identity markers', async () => {
    const source = await readSource('../message/MessageBody.tsx');
    expect(source).toContain('data-message-part-type="text"');
    expect(source).toContain('data-message-part-id={textPartId}');
    expect(source).toContain('data-message-part-index={i}');
    // Existing export markers are preserved exactly on the wrappers.
    expect(source).toContain('data-message-text-export-source="true"');
    expect(source).toContain('data-post-rich-result-notes="collapsed"');
  });

  test('ToolPart outer wrapper carries tool and rich-result markers', async () => {
    const source = await readSource('../message/parts/ToolPart.tsx');
    expect(source).toContain('className="contents"');
    expect(source).toContain('data-message-part-type="tool"');
    expect(source).toContain('data-message-part-id=');
    expect(source).toContain('data-tool-name={toolName}');
    expect(source).toContain('data-rich-result-runtime={richResultRuntime}');
  });
});
