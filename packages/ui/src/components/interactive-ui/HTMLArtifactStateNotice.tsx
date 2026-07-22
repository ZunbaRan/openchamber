import React from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import type { HTMLArtifactFailureState } from '@/lib/interactive-ui/artifactState';
import { NativeNotice } from './NativeUIKit';

const warningStates = new Set<HTMLArtifactFailureState>(['unsupported', 'scripts-disabled', 'stopped', 'timed-out', 'corrupt']);

export const HTMLArtifactStateNotice: React.FC<{
  state: HTMLArtifactFailureState;
  onRetry?: () => void;
}> = ({ state, onRetry }) => {
  const { t } = useI18n();
  return (
    <NativeNotice
      tone={warningStates.has(state) ? 'warning' : 'error'}
      heading={t(`interactiveUI.artifact.state.${state}.title`)}
      data-ocix-artifact-failure={state}
      action={onRetry ? (
        <Button type="button" variant="outline" size="xs" onClick={onRetry}>
          <Icon name="refresh" className="size-3.5" />
          {t('interactiveUI.artifact.retry')}
        </Button>
      ) : undefined}
    >
      {t(`interactiveUI.artifact.state.${state}.description`)}
    </NativeNotice>
  );
};
