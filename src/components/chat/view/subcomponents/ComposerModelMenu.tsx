import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';

import type { LLMProvider, ProviderModelOption } from '../../../../types/app';
import { prettifyModelId } from '../../../../utils/modelLabels';
import ProviderMark from '../../../llm-provider-logo/ProviderMark';
import { DEFAULT_EFFORT_VALUE } from '../../constants/providerEffort';
import { useComposerMenuAnchor } from '../../hooks/useComposerMenuAnchor';
import { Badge } from '../../../../shared/view/ui';
import { BeuiSwitch, SwapText } from '../../../../shared/view/beui';

import {
  ComposerMenuHeading,
  ComposerMenuItem,
  ComposerMenuSeparator,
  ComposerMenuSurface,
} from './ComposerMenuPrimitives';

type EffortOption = NonNullable<ProviderModelOption['effort']>['values'][number];

/** One provider's catalog as the switcher lists it, under that provider's mark. */
export type ProviderModelGroup = {
  provider: LLMProvider;
  options: ProviderModelOption[];
};

/**
 * Display labels for wire effort values, shared across providers. Labels
 * only — the wire format (low/medium/high/xhigh/max/…) sent to the server
 * and SDK is unchanged.
 */
const EFFORT_LABELS: Record<string, string> = {
  none: 'None',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra',
  max: 'Max',
  ultra: 'Ultra',
};

/** The wire value that carries the "Default" badge and renders for an unset effort. */
const DEFAULT_EFFORT_WIRE_VALUE = 'high';

const effortLabelFor = (value: string): string => (
  EFFORT_LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1)
);

const PROVIDER_GROUP_NAMES: Partial<Record<LLMProvider, string>> = {
  claude: 'Claude',
  codex: 'OpenAI',
};

interface ComposerModelMenuProps {
  effort: string;
  fastMode: boolean;
  /** Effort values the active provider/model actually accepts; empty hides the section. */
  effortOptions: EffortOption[];
  onSelectEffort: (effort: string) => void;
  onSelectFastMode: (enabled: boolean) => void;
  model: string;
  provider: LLMProvider;
  /** The catalogs the switcher lists; all empty (and not loading) hides the section. */
  modelGroups: ProviderModelGroup[];
  onSelectModel: (provider: LLMProvider, model: string) => void;
  modelsLoading: boolean;
}

export default function ComposerModelMenu({
  effort,
  fastMode,
  effortOptions,
  onSelectEffort,
  onSelectFastMode,
  model,
  provider,
  modelGroups,
  onSelectModel,
  modelsLoading,
}: ComposerModelMenuProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  // Claude.ai-style switcher: the root view shows the current-model card plus
  // the Effort and More models rows; each row swaps in its submenu.
  const [view, setView] = useState<'root' | 'effort' | 'models'>('root');
  const close = useCallback(() => setIsOpen(false), []);
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen, close);

  useEffect(() => {
    if (!isOpen) {
      setView('root');
    }
  }, [isOpen]);

  const activeOptions = useMemo(
    () => modelGroups.find((group) => group.provider === provider)?.options ?? [],
    [modelGroups, provider],
  );

  const selectedModelOption = useMemo(() => {
    const exact = activeOptions.find((option) => option.value === model);
    if (exact) {
      return exact;
    }
    // Session-derived ids may carry a date suffix (e.g. claude-haiku-4-5-20251001);
    // match them to the catalog entry so the friendly name still renders.
    return activeOptions.find((option) => model.startsWith(`${option.value}-`)) ?? null;
  }, [activeOptions, model]);
  // Ids absent from the catalog render prettified (claude-opus-5 -> Opus 5),
  // never as the raw wire id.
  const modelLabel = selectedModelOption?.label || prettifyModelId(model);
  const selectedValue = selectedModelOption?.value ?? model;

  const hasEffortSection = effortOptions.length > 0;
  const hasFastMode = provider === 'codex';
  const hasModelSection = modelGroups.some((group) => group.options.length > 0) || modelsLoading;
  if (!hasEffortSection && !hasModelSection) {
    return null;
  }

  // An unset effort runs at the catalog default (high), so the pill and the
  // submenu check render it as High rather than a "Default" option.
  const isEffortSelected = (value: string): boolean => (
    value === effort || (effort === DEFAULT_EFFORT_VALUE && value === DEFAULT_EFFORT_WIRE_VALUE)
  );
  const currentEffortLabel = effortLabelFor(
    effort === DEFAULT_EFFORT_VALUE ? DEFAULT_EFFORT_WIRE_VALUE : effort,
  );

  const ariaLabel = t('composer.modelMenu', {
    defaultValue: 'Select model, reasoning effort, and speed',
  });

  const renderModelRow = (groupProvider: LLMProvider, option: ProviderModelOption) => (
    <ComposerMenuItem
      key={`${groupProvider}:${option.value}`}
      label={option.label || option.value}
      isSelected={false}
      onSelect={() => {
        onSelectModel(groupProvider, option.value);
        setIsOpen(false);
      }}
    />
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          updateAnchor();
          setIsOpen((current) => !current);
        }}
        className="touch-hit relative flex h-7 min-w-0 max-w-56 shrink items-center gap-1 rounded-lg px-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        data-slot="composer-model-switcher"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
      >
        {hasModelSection && (
          <span data-slot="model-trigger-mark" data-provider={provider} className="shrink-0 text-muted-foreground">
            <ProviderMark provider={provider} className="h-3.5 w-3.5" />
          </span>
        )}
        <span className="min-w-0 truncate">
          <SwapText value={hasModelSection ? modelLabel : currentEffortLabel}>
            {hasModelSection ? modelLabel : currentEffortLabel}
          </SwapText>
        </span>
        {/* Effort shows on every form factor (ui13 job 12): phones read it too.
            Below md it compacts to the same small tag the fast mark uses
            (ui17 job 8), so the model name keeps the room it needs at 390px. */}
        {hasModelSection && hasEffortSection && (
          <span
            data-slot="composer-effort-tag"
            className="shrink-0 rounded bg-muted px-1 py-px text-[9px] font-medium lowercase leading-none text-muted-foreground md:rounded-none md:bg-transparent md:p-0 md:text-xs md:normal-case md:leading-normal"
          >
            <SwapText value={currentEffortLabel}>{currentEffortLabel}</SwapText>
          </span>
        )}
        {hasFastMode && fastMode && (
          <span
            data-slot="composer-fast-tag"
            className="shrink-0 rounded bg-muted px-1 py-px text-[9px] font-medium lowercase leading-none text-muted-foreground"
          >
            fast
          </span>
        )}
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
      </button>

      {isOpen && anchor && createPortal(
        <ComposerMenuSurface anchor={anchor} menuRef={menuRef} ariaLabel={ariaLabel}>
          {view === 'root' && (
            <>
              <ComposerMenuItem
                label={modelLabel}
                description={selectedModelOption?.description}
                isSelected
                onSelect={close}
              />

              {hasEffortSection && (
                <>
                  <ComposerMenuSeparator />
                  <ComposerMenuItem
                    role="menuitem"
                    label={t('composer.effort', { defaultValue: 'Effort' })}
                    isSelected={false}
                    onSelect={() => setView('effort')}
                    trailing={
                      <span className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
                        {currentEffortLabel}
                        <ChevronRight className="h-3.5 w-3.5" />
                      </span>
                    }
                  />
                  {hasFastMode && (
                    <div
                      role="none"
                      data-slot="composer-fast-mode-row"
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm text-foreground/90 transition-colors hover:bg-accent"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate leading-5">
                          {t('composer.fastMode', { defaultValue: 'Fast mode' })}
                        </span>
                        <span className="mt-0.5 block whitespace-nowrap text-xs leading-4 text-muted-foreground">
                          {t('composer.fastModeHint', { defaultValue: '1.5x speed, 2.5x usage' })}
                        </span>
                      </span>
                      <BeuiSwitch
                        checked={fastMode}
                        onCheckedChange={onSelectFastMode}
                        ariaLabel={t('composer.fastMode', { defaultValue: 'Fast mode' })}
                        className="shrink-0 scale-75"
                      />
                    </div>
                  )}
                </>
              )}

              {hasModelSection && (
                <>
                  {!hasEffortSection && <ComposerMenuSeparator />}
                  <ComposerMenuItem
                    role="menuitem"
                    label={t('composer.moreModels', { defaultValue: 'More models' })}
                    isSelected={false}
                    onSelect={() => setView('models')}
                    trailing={<ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                  />
                </>
              )}
            </>
          )}

          {view === 'effort' && (
            <>
              <p className="max-w-60 px-2.5 pb-1.5 pt-1.5 text-xs leading-4 text-muted-foreground">
                {t('composer.effortHint', {
                  defaultValue: 'Higher effort means more thorough responses, but takes longer and uses your limits faster.',
                })}
              </p>
              {effortOptions.map((option) => (
                <ComposerMenuItem
                  key={option.value}
                  label={
                    option.value === DEFAULT_EFFORT_WIRE_VALUE
                      ? (
                          <span className="inline-flex items-center gap-1.5">
                            {effortLabelFor(option.value)}
                            <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-medium">
                              {t('composer.effortDefaultBadge', { defaultValue: 'Default' })}
                            </Badge>
                          </span>
                        )
                      : effortLabelFor(option.value)
                  }
                  description={option.description}
                  isSelected={isEffortSelected(option.value)}
                  onSelect={() => {
                    onSelectEffort(option.value);
                    setIsOpen(false);
                  }}
                />
              ))}
            </>
          )}

          {view === 'models' && (
            <>
              {!modelGroups.some((group) => group.options.length > 0) && modelsLoading && (
                <p className="px-2.5 py-1.5 text-sm text-muted-foreground">
                  {t('composer.loadingModels', { defaultValue: 'Loading models…' })}
                </p>
              )}
              {modelGroups.filter((group) => group.options.length > 0).map((group, index) => {
                // The selected model renders as the checked card above, so its
                // group hides it; the rest keep catalog order, legacy models
                // (Claude) below a divider.
                const listed = group.options.filter((option) => option.value !== selectedValue);
                const current = listed.filter((option) => option.group !== 'legacy');
                const legacy = listed.filter((option) => option.group === 'legacy');
                return (
                  <div key={group.provider} data-slot="model-group" data-provider={group.provider}>
                    {index > 0 && <ComposerMenuSeparator />}
                    <ComposerMenuHeading>
                      <span className="inline-flex items-center gap-1.5">
                        <span data-slot="model-group-mark" data-provider={group.provider} className="text-muted-foreground">
                          <ProviderMark provider={group.provider} className="h-3.5 w-3.5" />
                        </span>
                        {PROVIDER_GROUP_NAMES[group.provider] ?? group.provider}
                      </span>
                    </ComposerMenuHeading>
                    {current.map((option) => renderModelRow(group.provider, option))}
                    {current.length > 0 && legacy.length > 0 && <ComposerMenuSeparator />}
                    {legacy.map((option) => renderModelRow(group.provider, option))}
                  </div>
                );
              })}
            </>
          )}
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  );
}
