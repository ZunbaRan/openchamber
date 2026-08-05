// StreamingMessage.tsx lines 301-560
  streamingToolOutput,
  thinkingContent,
  statusText,
  onForceStop,
}: StreamingMessageProps) {
  const { t } = useTranslation();
  const bufferedContent = useBufferedContent(content, isStreaming);
  // A2 (audit 2026-06): index toolResults by id once, then reuse for both the
  // running-tools filter and the per-tool lookup in the render below. Both
  // previously did an O(n) scan inside an O(n) loop → O(n²) every render.
  const toolResultsById = useMemo(
    () => new Map(toolResults.map((r) => [r.tool_use_id, r] as const)),
    [toolResults]
  );
  const runningTools = useMemo(
    () => toolUses.filter((tool) => !toolResultsById.has(tool.id)),
    [toolUses, toolResultsById]
  );
  const subagentTools = useMemo(
    () => toolUses.filter((tool) => {
      const result = toolResultsById.get(tool.id);
      return isSubagentToolCall(tool.name, tool.input, result?.content);
    }),
    [toolUses, toolResultsById],
  );
  const subagentRuns = useMemo(
    () => collapseLogicalSubagentRuns(subagentTools.map((tool) => {
      const result = toolResultsById.get(tool.id);
      return buildSubagentRunView({
        id: tool.id,
        name: tool.name,
        toolInput: tool.input,
        result: result?.content,
        isError: result?.is_error,
      });
    })),
    [subagentTools, toolResultsById],
  );
  const regularTools = useMemo(
    () => toolUses.filter((tool) => {
      const result = toolResultsById.get(tool.id);
      return !isSubagentToolCall(tool.name, tool.input, result?.content);
    }),
    [toolUses, toolResultsById],
  );

  // Extract a human-readable summary of the running command
  const getRunningCommandSummary = (): string | undefined => {
    if (runningTools.length === 0) {
      // All tools completed but still streaming — AI is generating text
      if (toolUses.length > 0) return 'Generating response...';
      return undefined;
    }
    const tool = runningTools[runningTools.length - 1];
    const input = tool.input as Record<string, unknown>;
    if (tool.name === 'Bash' && input.command) {
      const cmd = String(input.command);
      return cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd;
    }
    if (input.file_path) return `${tool.name}: ${String(input.file_path)}`;
    if (input.path) return `${tool.name}: ${String(input.path)}`;
    return `Running ${tool.name}...`;
  };

  return (
    <AIMessage from="assistant">
      <MessageContent>
        {/* Tool calls + thinking — single collapsible group */}
        {(regularTools.length > 0 || thinkingContent) && (
          <ToolActionsGroup
            tools={regularTools.map((tool) => {
              const result = toolResultsById.get(tool.id);
              return {
                id: tool.id,
                name: tool.name,
                input: tool.input,
                result: result?.content,
                isError: result?.is_error,
                media: result?.media,
              };
            })}
            isStreaming={isStreaming}
            streamingToolOutput={streamingToolOutput}
            thinkingContent={thinkingContent}
          />
        )}

        {/* Media from tool results — rendered outside tool group so images stay visible */}
        {(() => {
          const allMedia = toolResults.flatMap(r => r.media || []);
          return allMedia.length > 0 ? <MediaPreview media={allMedia} /> : null;
        })()}

        <SearchSources sources={toolResults.flatMap(result => result.sources || [])} />

        {/* Streaming text content rendered via Streamdown */}
        {content && (() => {
          // ── Show-widget handling ──
          // During streaming: detect partial fences FIRST to avoid premature script execution.
          // After streaming: use parseAllShowWidgets for completed fences only.
          const hasWidgetFence = /`{1,3}show-widget/.test(content);

          if (hasWidgetFence && isStreaming) {
            // Fence-agnostic: find the last show-widget marker
            const lastMarkerMatch = [...content.matchAll(/`{1,3}show-widget/g)].pop();
            if (!lastMarkerMatch) return <MessageResponse>{content}</MessageResponse>;

            const lastFenceStart = lastMarkerMatch.index!;
            const afterLastFence = content.slice(lastFenceStart);
            // Check if JSON is complete (has matching closing brace)
            const jsonStart = afterLastFence.indexOf('{');
            let lastFenceClosed = false;
            if (jsonStart !== -1) {
              let depth = 0, inStr = false, esc = false;
              for (let i = jsonStart; i < afterLastFence.length; i++) {
                const ch = afterLastFence[i];
                if (esc) { esc = false; continue; }
                if (ch === '\\' && inStr) { esc = true; continue; }
                if (ch === '"') { inStr = !inStr; continue; }
                if (inStr) continue;
                if (ch === '{') depth++;
                else if (ch === '}') { depth--; if (depth === 0) { lastFenceClosed = true; break; } }
              }
            }

            if (lastFenceClosed) {
              // All fences complete — parse and render the full content
              const allSegments = parseAllShowWidgets(content);
              return (
                <>
                  {allSegments.map((seg, i) => {
                    if (seg.type === 'text') {
                      return <MessageResponse key={`t-${i}`}>{seg.content}</MessageResponse>;
                    }
                    if (seg.type === 'malformed_widget') {
                      return <MalformedWidgetNotice key={`mw-${i}`} reason={seg.reason} raw={seg.raw} />;
                    }
                    return <WidgetRenderer key={`w-${i}`} widgetCode={seg.data.widget_code} isStreaming={false} title={seg.data.title} />;
                  })}
                </>
              );
            }

            // Last fence is still being streamed.
            // Parse everything BEFORE it (completed fences + interleaved text).
            const beforePart = content.slice(0, lastFenceStart).trim();
            const hasCompletedFences = beforePart && /`{1,3}show-widget/.test(beforePart);
            const completedSegments = hasCompletedFences ? parseAllShowWidgets(beforePart) : [];

            // Extract partial widget_code from the open fence (skip marker)
            const markerEnd = afterLastFence.match(/^`{1,3}show-widget`{0,3}\s*(?:\n\s*`{3}(?:json)?\s*)?\n?/);
            const fenceBody = markerEnd ? afterLastFence.slice(markerEnd[0].length).trim() : afterLastFence.trim();
            let partialCode: string | null = null;
            const keyIdx = fenceBody.indexOf('"widget_code"');
            if (keyIdx !== -1) {
              const colonIdx = fenceBody.indexOf(':', keyIdx + 13);
              if (colonIdx !== -1) {
                const quoteIdx = fenceBody.indexOf('"', colonIdx + 1);
                if (quoteIdx !== -1) {
                  let raw = fenceBody.slice(quoteIdx + 1);
                  raw = raw.replace(/"\s*\}\s*$/, '');
                  if (raw.endsWith('\\')) raw = raw.slice(0, -1);
                  try {
                    partialCode = raw
                      .replace(/\\\\/g, '\x00BACKSLASH\x00')
                      .replace(/\\n/g, '\n')
                      .replace(/\\t/g, '\t')
                      .replace(/\\r/g, '\r')
                      .replace(/\\"/g, '"')
                      .replace(/\\u([0-9a-fA-F]{4})/g, (_: string, hex: string) => String.fromCharCode(parseInt(hex, 16)))
                      .replace(/\x00BACKSLASH\x00/g, '\\');
                  } catch { partialCode = null; }
                }
              }
            }

            // Truncate at any unclosed <script> to prevent script content
            // from showing as visible text during streaming preview.
            // Scripts always come last per guidelines, so truncating is safe.
            let scriptsTruncated = false;
            if (partialCode) {
              const lastScript = partialCode.lastIndexOf('<script');
              if (lastScript !== -1) {
                const afterScript = partialCode.slice(lastScript);
                if (!/<script[\s\S]*?<\/script>/i.test(afterScript)) {
                  partialCode = partialCode.slice(0, lastScript).trim() || null;
                  scriptsTruncated = true;
                }
              }
            }

            let partialTitle: string | undefined;
            const titleMatch = fenceBody.match(/"title"\s*:\s*"([^"]*?)"/);
            if (titleMatch) partialTitle = titleMatch[1];

            // Key must match the map-index key that parseAllShowWidgets will produce
            // once the fence closes, so React preserves the WidgetRenderer instance.
            // See computePartialWidgetKey() for the invariant explanation.
            const partialWidgetKey = computePartialWidgetKey(content);

            return (
              <>
                {/* Plain text before the first widget fence (no completed fences yet) */}
                {!hasCompletedFences && beforePart && (
                  <MessageResponse key="pre-text">{beforePart}</MessageResponse>
                )}
                {/* Completed widget fences + interleaved text */}
                {completedSegments.map((seg, i) => {
                  if (seg.type === 'text') {
                    return <MessageResponse key={`t-${i}`}>{seg.content}</MessageResponse>;
                  }
                  if (seg.type === 'malformed_widget') {
                    return <MalformedWidgetNotice key={`mw-${i}`} reason={seg.reason} raw={seg.raw} />;
                  }
                  return <WidgetRenderer key={`w-${i}`} widgetCode={seg.data.widget_code} isStreaming={false} title={seg.data.title} />;
                })}
                {partialCode && partialCode.length > 10 ? (
                  <WidgetRenderer key={partialWidgetKey} widgetCode={partialCode} isStreaming={true} title={partialTitle} showOverlay={scriptsTruncated} />
                ) : (
                  <Shimmer>{t('widget.loading')}</Shimmer>
                )}
              </>
            );
          }

          if (hasWidgetFence && !isStreaming) {
            // Non-streaming: all fences should be complete
            const widgetSegments = parseAllShowWidgets(content);
            if (widgetSegments.length > 0) {
              return (
                <>
                  {widgetSegments.map((seg, i) => {
                    if (seg.type === 'text') {
                      return <MessageResponse key={`t-${i}`}>{seg.content}</MessageResponse>;
                    }
                    if (seg.type === 'malformed_widget') {
                      return <MalformedWidgetNotice key={`mw-${i}`} reason={seg.reason} raw={seg.raw} />;
                    }
                    return <WidgetRenderer key={`w-${i}`} widgetCode={seg.data.widget_code} isStreaming={false} title={seg.data.title} />;
                  })}
                </>
              );
            }
          }

          // Try batch-plan (Image Agent batch mode)
          const batchPlanResult = parseBatchPlan(content);
          if (batchPlanResult) {
            return (
              <>
                {batchPlanResult.beforeText && <MessageResponse>{batchPlanResult.beforeText}</MessageResponse>}
                <BatchPlanInlinePreview plan={batchPlanResult.plan} messageId="streaming-preview" />
                {batchPlanResult.afterText && <MessageResponse>{batchPlanResult.afterText}</MessageResponse>}
              </>
            );
          }

          // Try image-gen-request
          const parsed = parseImageGenRequest(content);
          if (parsed) {
