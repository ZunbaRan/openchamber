import React from 'react';
import {
  computePartialWidgetKey,
  parseAllShowWidgets,
  textContainsShowWidget,
  type ShowWidgetData,
} from '@/lib/generative-widget';
import { MarkdownRenderer } from '../MarkdownRenderer';
import type { StreamPhase, ToolPopupContent } from '../message/types';
import type { Part } from '@opencode-ai/sdk/v2';
import { MalformedWidgetNotice } from './MalformedWidgetNotice';
import { WidgetRenderer } from './WidgetRenderer';

const SHOW_WIDGET_MARKER = /`{1,3}show-widget/;

const findJsonClosed = (afterMarkerSlice: string): boolean => {
  const jsonStart = afterMarkerSlice.indexOf('{');
  if (jsonStart === -1) return false;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = jsonStart; i < afterMarkerSlice.length; i += 1) {
    const ch = afterMarkerSlice[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === '\\' && inStr) {
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return true;
    }
  }
  return false;
};

const extractPartialWidgetCode = (
  content: string,
): { code: string | null; title?: string; scriptsTruncated: boolean } => {
  const lastMarkerMatch = [...content.matchAll(/`{1,3}show-widget/g)].pop();
  if (!lastMarkerMatch || lastMarkerMatch.index === undefined) {
    return { code: null, scriptsTruncated: false };
  }
  const afterLastFence = content.slice(lastMarkerMatch.index);
  const markerEnd = afterLastFence.match(
    /^`{1,3}show-widget`{0,3}\s*(?:\n\s*`{3}(?:json)?\s*)?\n?/,
  );
  const fenceBody = markerEnd
    ? afterLastFence.slice(markerEnd[0].length).trim()
    : afterLastFence.trim();

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
          const nul = String.fromCharCode(0);
          partialCode = raw
            .replace(/\\\\/g, `${nul}BACKSLASH${nul}`)
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\r/g, '\r')
            .replace(/\\"/g, '"')
            .replace(/\\u([0-9a-fA-F]{4})/g, (_: string, hex: string) =>
              String.fromCharCode(Number.parseInt(hex, 16)),
            )
            .replaceAll(`${nul}BACKSLASH${nul}`, '\\');
        } catch {
          partialCode = null;
        }
      }
    }
  }

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

  let title: string | undefined;
  const titleMatch = fenceBody.match(/"title"\s*:\s*"([^"]*?)"/);
  if (titleMatch) title = titleMatch[1];

  return { code: partialCode, title, scriptsTruncated };
};

const MarkdownChunk: React.FC<{
  content: string;
  part: Part;
  messageId: string;
  isStreaming: boolean;
  chatRenderMode?: 'sorted' | 'live';
  isFinalized: boolean;
  onShowPopup?: (content: ToolPopupContent) => void;
  chunkKey: string;
}> = ({
  content,
  part,
  messageId,
  isStreaming,
  chatRenderMode,
  isFinalized,
  onShowPopup,
  chunkKey,
}) => (
  <MarkdownRenderer
    key={chunkKey}
    content={content}
    part={part}
    messageId={messageId}
    isAnimated={false}
    isStreaming={isStreaming}
    disableStreamAnimation={chatRenderMode === 'sorted'}
    variant={part.type === 'reasoning' ? 'reasoning' : 'assistant'}
    enableFileReferences={isFinalized}
    onShowPopup={onShowPopup}
  />
);

export interface RenderAssistantTextWithWidgetsProps {
  text: string;
  part: Part;
  messageId: string;
  streamPhase: StreamPhase;
  chatRenderMode?: 'sorted' | 'live';
  isFinalized: boolean;
  onShowPopup?: (content: ToolPopupContent) => void;
}

export const RenderAssistantTextWithWidgets: React.FC<RenderAssistantTextWithWidgetsProps> = ({
  text,
  part,
  messageId,
  streamPhase,
  chatRenderMode = 'live',
  isFinalized,
  onShowPopup,
}) => {
  const isStreaming =
    chatRenderMode === 'live' && (streamPhase === 'streaming' || streamPhase === 'cooldown');

  if (!textContainsShowWidget(text)) {
    return (
      <MarkdownChunk
        content={text}
        part={part}
        messageId={messageId}
        isStreaming={isStreaming}
        chatRenderMode={chatRenderMode}
        isFinalized={isFinalized}
        onShowPopup={onShowPopup}
        chunkKey="md-only"
      />
    );
  }

  if (isStreaming) {
    const lastMarkerMatch = [...text.matchAll(/`{1,3}show-widget/g)].pop();
    if (!lastMarkerMatch || lastMarkerMatch.index === undefined) {
      return (
        <MarkdownChunk
          content={text}
          part={part}
          messageId={messageId}
          isStreaming={isStreaming}
          chatRenderMode={chatRenderMode}
          isFinalized={isFinalized}
          onShowPopup={onShowPopup}
          chunkKey="md-stream"
        />
      );
    }

    const lastFenceStart = lastMarkerMatch.index;
    const afterLastFence = text.slice(lastFenceStart);
    const lastFenceClosed = findJsonClosed(afterLastFence);

    if (lastFenceClosed) {
      const segments = parseAllShowWidgets(text);
      return (
        <>
          {segments.map((seg, i) => {
            if (seg.type === 'text') {
              return (
                <MarkdownChunk
                  key={`t-${i}`}
                  content={seg.content}
                  part={part}
                  messageId={messageId}
                  isStreaming={false}
                  chatRenderMode={chatRenderMode}
                  isFinalized={isFinalized}
                  onShowPopup={onShowPopup}
                  chunkKey={`t-${i}`}
                />
              );
            }
            if (seg.type === 'malformed_widget') {
              return <MalformedWidgetNotice key={`mw-${i}`} reason={seg.reason} raw={seg.raw} />;
            }
            return (
              <WidgetRenderer
                key={`w-${i}`}
                widgetCode={seg.data.widget_code}
                isStreaming={false}
                title={seg.data.title}
              />
            );
          })}
        </>
      );
    }

    const beforePart = text.slice(0, lastFenceStart).trim();
    const hasCompletedFences = Boolean(beforePart && SHOW_WIDGET_MARKER.test(beforePart));
    const completedSegments = hasCompletedFences ? parseAllShowWidgets(beforePart) : [];
    const partial = extractPartialWidgetCode(text);
    const partialKey = computePartialWidgetKey(text);

    return (
      <>
        {!hasCompletedFences && beforePart ? (
          <MarkdownChunk
            content={beforePart}
            part={part}
            messageId={messageId}
            isStreaming={isStreaming}
            chatRenderMode={chatRenderMode}
            isFinalized={false}
            onShowPopup={onShowPopup}
            chunkKey="pre-text"
          />
        ) : null}
        {completedSegments.map((seg, i) => {
          if (seg.type === 'text') {
            return (
              <MarkdownChunk
                key={`t-${i}`}
                content={seg.content}
                part={part}
                messageId={messageId}
                isStreaming={false}
                chatRenderMode={chatRenderMode}
                isFinalized={isFinalized}
                onShowPopup={onShowPopup}
                chunkKey={`ct-${i}`}
              />
            );
          }
          if (seg.type === 'malformed_widget') {
            return <MalformedWidgetNotice key={`mw-${i}`} reason={seg.reason} raw={seg.raw} />;
          }
          return (
            <WidgetRenderer
              key={`w-${i}`}
              widgetCode={seg.data.widget_code}
              isStreaming={false}
              title={seg.data.title}
            />
          );
        })}
        {partial.code && partial.code.length > 10 ? (
          <WidgetRenderer
            key={partialKey}
            widgetCode={partial.code}
            isStreaming
            title={partial.title}
            showOverlay={partial.scriptsTruncated}
          />
        ) : (
          <div className="my-2 text-sm text-muted-foreground">Building visualization…</div>
        )}
      </>
    );
  }

  const segments = parseAllShowWidgets(text);
  if (segments.length === 0) {
    return (
      <MarkdownChunk
        content={text}
        part={part}
        messageId={messageId}
        isStreaming={false}
        chatRenderMode={chatRenderMode}
        isFinalized={isFinalized}
        onShowPopup={onShowPopup}
        chunkKey="md-fallback"
      />
    );
  }

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          return (
            <MarkdownChunk
              key={`t-${i}`}
              content={seg.content}
              part={part}
              messageId={messageId}
              isStreaming={false}
              chatRenderMode={chatRenderMode}
              isFinalized={isFinalized}
              onShowPopup={onShowPopup}
              chunkKey={`ft-${i}`}
            />
          );
        }
        if (seg.type === 'malformed_widget') {
          return <MalformedWidgetNotice key={`mw-${i}`} reason={seg.reason} raw={seg.raw} />;
        }
        const data: ShowWidgetData = seg.data;
        return (
          <WidgetRenderer
            key={`w-${i}`}
            widgetCode={data.widget_code}
            isStreaming={false}
            title={data.title}
          />
        );
      })}
    </>
  );
};
