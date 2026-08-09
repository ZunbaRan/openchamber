/**
 * Host bridge for widget drill-down (__widgetSendMessage).
 * Rate-limited; does not call business APIs.
 */

const MAX_LENGTH = 500;
const RATE_LIMIT_MS = 2000;

type SendHandler = (text: string) => void;

let handler: SendHandler | null = null;
let lastCallTime = 0;

export const setGenerativeWidgetSendHandler = (next: SendHandler | null): void => {
  handler = next;
  if (typeof window === 'undefined') return;
  if (next) {
    (window as unknown as { __widgetSendMessage?: (text: unknown) => void }).__widgetSendMessage =
      invokeGenerativeWidgetSendMessage;
  } else {
    delete (window as unknown as { __widgetSendMessage?: unknown }).__widgetSendMessage;
  }
};

export const invokeGenerativeWidgetSendMessage = (text: unknown): void => {
  if (typeof text !== 'string') return;
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_LENGTH) return;
  const now = Date.now();
  if (now - lastCallTime < RATE_LIMIT_MS) return;
  lastCallTime = now;
  handler?.(trimmed);
};
