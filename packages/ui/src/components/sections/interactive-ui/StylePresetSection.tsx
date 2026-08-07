import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { SettingsSection } from '@/components/sections/shared/SettingsSection';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { OCIX_STYLE_PRESETS, type OcixStylePreset } from '@/lib/interactive-ui/stylePresets';
import { useUIStore } from '@/stores/useUIStore';

/**
 * Host-level OCIX style preset picker (Style v2). Each preview card is an
 * `.ocix-scope` carrying its own `data-ocix-preset`, so the swatches render
 * with the preset's real tokens in the current light/dark mode — no
 * duplicated palette data.
 */
export const StylePresetSection: React.FC = () => {
  const { t } = useI18n();
  const preset = useUIStore((state) => state.ocixStylePreset);
  const setPreset = useUIStore((state) => state.setOcixStylePreset);

  const handleSelect = (id: OcixStylePreset) => {
    if (id !== preset) setPreset(id);
  };

  return (
    <SettingsSection
      divider={false}
      settingsItem="interactive-ui.stylePreset"
      title={t('settings.interactiveUI.stylePreset.title')}
      description={t('settings.interactiveUI.stylePreset.description')}
    >
      <div role="radiogroup" aria-label={t('settings.interactiveUI.stylePreset.title')} className="grid grid-cols-2 gap-3 @xl:grid-cols-4">
        {OCIX_STYLE_PRESETS.map((meta) => {
          const selected = meta.id === preset;
          return (
            <button
              key={meta.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => handleSelect(meta.id)}
              className={cn(
                'ocix-scope group rounded-xl border border-[var(--ocix-border)] bg-[var(--ocix-surface)] p-3 text-left transition-colors',
                'hover:border-[var(--ocix-primary-tint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ocix-focus-ring)]',
                selected && 'border-[var(--ocix-primary)] ring-1 ring-[var(--ocix-primary)]',
              )}
              data-ocix-preset={meta.id}
              data-testid={`ocix-preset-${meta.id}`}
            >
              <span className="mb-2 block h-10 overflow-hidden rounded-lg border border-[var(--ocix-border)] bg-[var(--ocix-surface-muted)] p-1.5">
                <span className="flex h-full items-center gap-1">
                  <span className="h-full w-6 rounded-md bg-[var(--ocix-primary)]" aria-hidden="true" />
                  <span className="flex flex-1 flex-col gap-1">
                    <span className="h-1.5 w-3/4 rounded-full bg-[var(--ocix-foreground)] opacity-70" aria-hidden="true" />
                    <span className="h-1.5 w-1/2 rounded-full bg-[var(--ocix-muted-foreground)] opacity-60" aria-hidden="true" />
                  </span>
                </span>
              </span>
              <span className="flex items-center justify-between gap-2">
                <span className="typography-meta font-medium text-[var(--ocix-foreground)]">
                  {t(`settings.interactiveUI.stylePreset.preset.${meta.id}`)}
                </span>
                {selected ? <Icon name="check" className="size-3.5 shrink-0 text-[var(--ocix-primary)]" aria-hidden="true" /> : null}
              </span>
              <span className="mt-1 flex items-center gap-1.5">
                {[1, 2, 3, 4].map((index) => (
                  <span
                    key={index}
                    className="size-2 rounded-full"
                    style={{ backgroundColor: `var(--ocix-chart-${index})` }}
                    aria-hidden="true"
                  />
                ))}
                <span className="typography-micro text-[var(--ocix-muted-foreground)]">
                  {t(`settings.interactiveUI.stylePreset.character.${meta.character}`)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 typography-micro text-muted-foreground">
        {t('settings.interactiveUI.stylePreset.trademark')}
      </p>
    </SettingsSection>
  );
};
