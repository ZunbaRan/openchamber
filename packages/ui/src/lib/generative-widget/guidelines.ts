/**
 * System prompt fragments for Generative Widget (show-widget).
 * Inject via OpenCode instructions / agent system append.
 */

export const GENERATIVE_WIDGET_WIRE_FORMAT = `## GENERATIVE WIDGET OUTPUT FORMAT — non-negotiable

The ONLY way to render an interactive widget in the chat is a code fence labelled \`show-widget\` whose body is a JSON object with a \`widget_code\` string:

\`\`\`show-widget
{"title":"<human-readable title>","widget_code":"<escaped HTML/SVG string>"}
\`\`\`

- \`widget_code\` is a JSON-encoded string, not raw HTML. Prefer single-quote HTML attributes.
- A raw HTML fence (\`\`\`html) is NEVER rendered as a widget.
- Explanatory prose goes OUTSIDE the fence. Multiple widgets use separate fences interleaved with text.
`;

export const GENERATIVE_WIDGET_SYSTEM_PROMPT = `<generative-widget-capability>
You can create interactive visualizations using the \`show-widget\` code fence. Follow the GENERATIVE WIDGET OUTPUT FORMAT above.

## Rules
1. widget_code is a JSON string — escape quotes/newlines. No DOCTYPE/html/head/body.
2. Transparent background — host provides bg.
3. Prefer each widget ≤ 3000 chars. Always close JSON + fence.
4. Streaming order: SVG → defs first; HTML → style → content → script last.
5. CDN allowlist only: cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com, esm.sh
6. No network APIs (fetch/XHR) — sandbox blocks connect-src.
7. Drill-down: onclick="window.__widgetSendMessage('…')" (short follow-up questions only).
8. Title human-readable in the user's language.
9. Use min-height not fixed height on outermost container.
</generative-widget-capability>`;

export const GENERATIVE_WIDGET_KEYWORDS =
  /可视化|图表|流程图|时间线|架构图|对比|visualiz|diagram|chart|flowchart|timeline|infographic|interactive|widget|show-widget|hierarchy|dashboard/i;

export const shouldOfferWidgetGuidelines = (prompt: string): boolean =>
  GENERATIVE_WIDGET_KEYWORDS.test(prompt);
