import React from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import type { InteractiveUIFailureState } from '@/lib/interactive-ui/state';
import { NativeNotice } from './NativeUIKit';

export const InteractiveUIStateNotice: React.FC<{
  state: InteractiveUIFailureState;
  onRetry?: () => void;
}> = ({ state, onRetry }) => {
  const { t } = useI18n();
  const tone = state === 'unconfigured' || state === 'stale' ? 'warning' : 'error';
  return (
    <NativeNotice
      tone={tone}
      heading={t(`interactiveUI.state.${state}.title`)}
      action={onRetry ? (
        <Button type="button" variant="outline" size="xs" onClick={onRetry}>
          <Icon name="refresh" className="size-3.5" />
          {t('interactiveUI.state.retry')}
        </Button>
      ) : undefined}
    >
      {t(`interactiveUI.state.${state}.description`)}
    </NativeNotice>
  );
};
