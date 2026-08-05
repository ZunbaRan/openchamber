// ChatView.tsx lines 1326-1385 (CodePilot reference)
      if (!started) {
        // A guard suppressed the stream (e.g. resolved provider/model went
        // empty). isStreaming will never flip true, so the reset below can't
        // fire — release the latch here so a later state change re-runs the
        // effect instead of the queue deadlocking with dequeuingRef stuck true.
        dequeuingRef.current = false;
      }
    }
    if (isStreaming) {
      dequeuingRef.current = false;
    }
  }, [isStreaming, messageQueue, doStartStream, cappedSetMessages, sessionId, noCompatibleProvider, providerFetchState, sessionProviderRuntimeIncompatible]);

  // Expose widget drill-down bridge: widgets can call window.__widgetSendMessage(text)
  // to trigger follow-up questions (e.g. clicking a node to get deeper explanation)
  // Hardened: type-checked, length-limited, rate-limited, sanitized.
  useEffect(() => {
    let lastCallTime = 0;
    const RATE_LIMIT_MS = 2000;
    const MAX_LENGTH = 500;

    const bridge = (text: unknown) => {
      if (typeof text !== 'string') return;
      const trimmed = text.trim();
      if (!trimmed || trimmed.length > MAX_LENGTH) return;

      // Rate limit: max one message per 2 seconds
      const now = Date.now();
      if (now - lastCallTime < RATE_LIMIT_MS) return;
      lastCallTime = now;

      sendMessageRef.current?.(trimmed);
    };
    (window as unknown as Record<string, unknown>).__widgetSendMessage = bridge;
    return () => {
      delete (window as unknown as Record<string, unknown>).__widgetSendMessage;
    };
  }, []);

  // Listen for widget pin requests from PinnableWidget buttons.
  // The AI model receives the widget code + instructions and calls the
  // codepilot_dashboard_pin MCP tool to complete the pin operation.
  useEffect(() => {
    const handler = (e: Event) => {
      const { widgetCode, title } = (e as CustomEvent).detail || {};
      if (!widgetCode || !sendMessageRef.current) return;

      const instruction = `请将下面的可视化组件固定到项目看板。\n\n标题建议：${title || 'Untitled'}\n\n组件代码：\n${widgetCode}`;
      sendMessageRef.current(instruction, undefined, undefined, `📌 固定「${title || 'Widget'}」到看板`);
    };
    window.addEventListener('widget-pin-request', handler);
    return () => window.removeEventListener('widget-pin-request', handler);
  }, []);

  // Listen for dashboard widget drilldown (click title → conversation)
  useEffect(() => {
    const handler = (e: Event) => {
      const { title, dataContract } = (e as CustomEvent).detail || {};
      if (!title || !sendMessageRef.current) return;
      sendMessageRef.current(
