import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';

import type { ProviderModelOption } from '../../../../types/app';
import { prettifyModelId } from '../../../../utils/modelLabels';
import { DEFAULT_EFFORT_VALUE } from '../../constants/providerEffort';
import { useComposerMenuAnchor } from '../../hooks/useComposerMenuAnchor';
import { Badge } from '../../../../shared/view/ui';
import { SwapText } from '../../../../shared/view/beui';

import {
  ComposerMenuItem,
  ComposerMenuSeparator,
  ComposerMenuSurface,
} from './ComposerMenuPrimitives';

type EffortOption = NonNullable<ProviderModelOption['effort']>['values'][number];

/**
 * Display labels for wire effort values. Labels only — the wire format
 * (low/medium/high/xhigh/max/…) sent to the server and SDK is unchanged.
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

interface ComposerModelMenuProps {
  effort: string;
  /** Effort values the active provider/model actually accepts; empty hides the section. */
  effortOptions: EffortOption[];
  onSelectEffort: (effort: string) => void;
  model: string;
  /** Model catalog for the active provider; empty hides the section. */
  modelOptions: ProviderModelOption[];
  onSelectModel: (model: string) => void;
  modelsLoading: boolean;
}

export default function ComposerModelMenu({
  effort,
  effortOptions,
  onSelectEffort,
  model,
  modelOptions,
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

  const selectedModelOption = useMemo(() => {
    const exact = modelOptions.find((option) => option.value === model);
    if (exact) {
      return exact;
    }
    // Session-derived ids may carry a date suffix (e.g. claude-haiku-4-5-20251001);
    // match them to the catalog entry so the friendly name still renders.
    return modelOptions.find((option) => model.startsWith(`${option.value}-`)) ?? null;
  }, [model, modelOptions]);
  // Ids absent from the catalog render prettified (claude-opus-5 -> Opus 5),
  // never as the raw wire id.
  const modelLabel = selectedModelOption?.label || prettifyModelId(model);

  // Claude.ai parity: the selected model renders as the checked card above, so
  // More models hides it and splits the rest into current / legacy groups
  // (ungrouped options count as current) in catalog order.
  const listedModelOptions = useMemo(() => {
    const selectedValue = selectedModelOption?.value ?? model;
    return modelOptions.filter((option) => option.value !== selectedValue);
  }, [model, modelOptions, selectedModelOption]);
  const currentModelOptions = listedModelOptions.filter((option) => option.group !== 'legacy');
  const legacyModelOptions = listedModelOptions.filter((option) => option.group === 'legacy');

  const hasEffortSection = effortOptions.length > 0;
  const hasModelSection = modelOptions.length > 0 || modelsLoading;
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
    defaultValue: 'Select model and reasoning effort',
  });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          updateAnchor();
          setIsOpen((current) => !current);
        }}
        className="flex h-7 max-w-20 shrink-0 items-center gap-1 rounded-lg px-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground sm:max-w-56"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        <span className="truncate">
          <SwapText value={hasModelSection ? modelLabel : currentEffortLabel}>
            {hasModelSection ? modelLabel : currentEffortLabel}
          </SwapText>
        </span>
        {hasModelSection && hasEffortSection && (
          <span className="hidden shrink-0 text-muted-foreground sm:inline">
            <SwapText value={currentEffortLabel}>{currentEffortLabel}</SwapText>
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
              {modelOptions.length === 0 && modelsLoading && (
                <p className="px-2.5 py-1.5 text-sm text-muted-foreground">
                  {t('composer.loadingModels', { defaultValue: 'Loading models…' })}
                </p>
              )}
              {currentModelOptions.map((option) => (
                <ComposerMenuItem
                  key={option.value}
                  label={option.label || option.value}
                  isSelected={false}
                  onSelect={() => {
                    onSelectModel(option.value);
                    setIsOpen(false);
                  }}
                />
              ))}
              {currentModelOptions.length > 0 && legacyModelOptions.length > 0 && (
                <ComposerMenuSeparator />
              )}
              {legacyModelOptions.map((option) => (
                <ComposerMenuItem
                  key={option.value}
                  label={option.label || option.value}
                  isSelected={false}
                  onSelect={() => {
                    onSelectModel(option.value);
                    setIsOpen(false);
                  }}
                />
              ))}
            </>
          )}
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  );
}
