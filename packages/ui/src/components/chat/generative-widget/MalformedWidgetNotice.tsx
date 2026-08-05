import React from 'react';

interface MalformedWidgetNoticeProps {
  reason: string;
  raw: string;
}

export const MalformedWidgetNotice: React.FC<MalformedWidgetNoticeProps> = ({
  reason,
  raw,
}) => (
  <div className="my-2 rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-muted)] p-3 text-sm">
    <div className="font-medium text-[var(--status-warning-foreground)]">
      Malformed show-widget block
    </div>
    <p className="mt-1 text-muted-foreground">{reason}</p>
    {raw ? (
      <pre className="mt-2 max-h-40 overflow-auto rounded-md border border-border/40 bg-background/60 p-2 text-xs">
        <code>{raw}</code>
      </pre>
    ) : null}
  </div>
);
