import React, { useState, useCallback, useRef, useEffect, useId } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { PermissionPanelProps } from '../../configs/permissionPanelRegistry';
import type { Question } from '../../../types/types';
import { RadioDot } from '../../../../../shared/view/beui/BeuiRadio';
import { EASE_OUT_CSS, SPRING_PRESS } from '../../../../../shared/view/beui/ease';
import { Tooltip } from '../../../../../shared/view/ui';

/**
 * The AskUserQuestion decision card, merged with the beautifului.dev Approval
 * Card: quiet option rows on the card surface, a ring-dot pager with chevrons
 * in the footer, and a forward (arrow-up) button that advances questions and
 * sends on the last — answers never auto-send. Free-text "Other", radio vs
 * multi-select, keyboard control (1–9, 0, Enter, Esc), and the decision
 * wiring are this app's own, preserved from the previous panel.
 */
export const AskUserQuestionPanel: React.FC<PermissionPanelProps> = ({
  request,
  onDecision,
}) => {
  const input = request.input as { questions?: Question[] } | undefined;
  const questions: Question[] = input?.questions || [];

  const [currentStep, setCurrentStep] = useState(0);
  const [selections, setSelections] = useState<Map<number, Set<string>>>(() => new Map());
  const [otherTexts, setOtherTexts] = useState<Map<number, string>>(() => new Map());
  const [otherActive, setOtherActive] = useState<Map<number, boolean>>(() => new Map());
  const [mounted, setMounted] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const otherInputRef = useRef<HTMLInputElement>(null);
  const reduce = useReducedMotion();
  // Unique per panel + step so the beUI radio dot glides only within the
  // current question's options.
  const radioLayoutBase = useId();

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  // Focus the container for keyboard events when step changes
  useEffect(() => {
    if (!otherActive.get(currentStep)) {
      containerRef.current?.focus();
    }
  }, [currentStep, otherActive]);

  useEffect(() => {
    if (otherActive.get(currentStep)) {
      otherInputRef.current?.focus();
    }
  }, [otherActive, currentStep]);

  const toggleOption = useCallback((qIdx: number, label: string, multiSelect: boolean) => {
    setSelections(prev => {
      const next = new Map(prev);
      const current = new Set(next.get(qIdx) || []);
      if (multiSelect) {
        if (current.has(label)) current.delete(label);
        else current.add(label);
      } else {
        current.clear();
        current.add(label);
        setOtherActive(p => { const n = new Map(p); n.set(qIdx, false); return n; });
      }
      next.set(qIdx, current);
      return next;
    });
  }, []);

  const toggleOther = useCallback((qIdx: number, multiSelect: boolean) => {
    setOtherActive(prev => {
      const next = new Map(prev);
      const wasActive = next.get(qIdx) || false;
      next.set(qIdx, !wasActive);
      if (!multiSelect && !wasActive) {
        setSelections(p => { const n = new Map(p); n.set(qIdx, new Set()); return n; });
      }
      return next;
    });
  }, []);

  const setOtherText = useCallback((qIdx: number, text: string) => {
    setOtherTexts(prev => { const next = new Map(prev); next.set(qIdx, text); return next; });
  }, []);

  const buildAnswers = useCallback(() => {
    const answers: Record<string, string> = {};
    questions.forEach((q, idx) => {
      const selected = Array.from(selections.get(idx) || []);
      const isOther = otherActive.get(idx) || false;
      const otherText = (otherTexts.get(idx) || '').trim();
      if (isOther && otherText) selected.push(otherText);
      if (selected.length > 0) answers[q.question] = selected.join(', ');
    });
    return answers;
  }, [questions, selections, otherActive, otherTexts]);

  const handleSubmit = useCallback(() => {
    onDecision(request.requestId, { allow: true, updatedInput: { ...input, answers: buildAnswers() } });
  }, [onDecision, request.requestId, input, buildAnswers]);

  const handleSkip = useCallback(() => {
    onDecision(request.requestId, { allow: true, updatedInput: { ...input, answers: {} } });
  }, [onDecision, request.requestId, input]);

  // Keyboard handler for number keys and navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Don't capture keys when typing in the "Other" input
    if (e.target instanceof HTMLInputElement) return;

    const q = questions[currentStep];
    if (!q) return;
    const multi = q.multiSelect || false;
    const optCount = q.options.length;

    // Number keys 1-9 for options
    const num = parseInt(e.key);
    if (!isNaN(num) && num >= 1 && num <= optCount) {
      e.preventDefault();
      toggleOption(currentStep, q.options[num - 1].label, multi);
      return;
    }

    // 0 for "Other"
    if (e.key === '0') {
      e.preventDefault();
      toggleOther(currentStep, multi);
      return;
    }

    // Enter to advance / submit
    if (e.key === 'Enter') {
      e.preventDefault();
      const isLast = currentStep === questions.length - 1;
      if (isLast) handleSubmit();
      else setCurrentStep(s => s + 1);
      return;
    }

    // Escape to skip
    if (e.key === 'Escape') {
      e.preventDefault();
      handleSkip();
      return;
    }
  }, [currentStep, questions, toggleOption, toggleOther, handleSubmit, handleSkip]);

  if (questions.length === 0) return null;

  const total = questions.length;
  const isSingle = total === 1;
  const q = questions[currentStep];
  const multi = q.multiSelect || false;
  const selected = selections.get(currentStep) || new Set<string>();
  const isOtherOn = otherActive.get(currentStep) || false;
  const isLast = currentStep === total - 1;
  const isFirst = currentStep === 0;
  const hasCurrentSelection = selected.size > 0 || (isOtherOn && (otherTexts.get(currentStep) || '').trim().length > 0);
  const forwardEnabled = isLast ? (hasCurrentSelection || Object.keys(buildAnswers()).length > 0) : true;

  const optionRowClass = (on: boolean) =>
    `group flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors duration-100 hover:bg-muted/60 ${
      on ? 'bg-muted/50' : ''
    }`;

  const kbdClass = (on: boolean) =>
    `flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-sm font-mono text-[10px] transition-colors duration-150 ${
      on
        ? 'bg-primary font-semibold text-primary-foreground'
        : 'border border-border bg-muted text-muted-foreground'
    }`;

  const checkSquare = (on: boolean) => (
    <span
      className={`ml-auto flex size-4 shrink-0 items-center justify-center rounded-sm transition-colors duration-200 ${
        on
          ? 'bg-primary text-primary-foreground'
          : 'text-transparent shadow-[inset_0_0_0_1.5px_hsl(var(--border))]'
      }`}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6L9 17l-5-5" />
      </svg>
    </span>
  );

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className={`w-full outline-none transition-all duration-300 ${
        mounted ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
      }`}
      data-slot="ask-user-question"
    >
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-lg">
        {/* Header + question */}
        <div key={currentStep} className="px-4 pb-1 pt-3" style={reduce ? undefined : { animation: `bui-fade-up 350ms ${EASE_OUT_CSS} both` }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Claude needs your input
                </span>
                {q.header && (
                  <span className="inline-flex items-center rounded-sm border border-primary/20 bg-primary/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-primary">
                    {q.header}
                  </span>
                )}
              </div>
              <p className="text-[14px] font-medium leading-snug text-foreground">
                {q.question}
              </p>
              {multi && (
                <span className="text-[10px] text-muted-foreground">Select all that apply</span>
              )}
            </div>
            <Tooltip content={isSingle ? 'Skip (Esc)' : 'Skip all questions (Esc)'}>
              <button
                type="button"
                aria-label={isSingle ? 'Skip' : 'Skip all questions'}
                onClick={handleSkip}
                className="relative touch-hit flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 hover:bg-muted hover:text-foreground"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Options */}
        <div className="scrollbar-thin max-h-52 overflow-y-auto px-2.5 pb-2" role={multi ? 'group' : 'radiogroup'} aria-label={q.question}>
          <div className="flex flex-col gap-0.5">
            {q.options.map((opt, optIdx) => {
              const isSelected = selected.has(opt.label);
              return (
                <motion.button
                  key={opt.label}
                  type="button"
                  aria-pressed={isSelected}
                  whileTap={multi || reduce ? undefined : { scale: 0.98 }}
                  transition={SPRING_PRESS}
                  onClick={() => toggleOption(currentStep, opt.label, multi)}
                  className={optionRowClass(isSelected)}
                >
                  <kbd className={kbdClass(isSelected)}>{optIdx + 1}</kbd>

                  <div className="min-w-0 flex-1">
                    <div className={`text-[13px] leading-tight transition-colors duration-150 ${
                      isSelected ? 'font-medium text-foreground' : 'text-muted-foreground'
                    }`}>
                      {opt.label}
                    </div>
                    {opt.description && (
                      <div className="text-[11px] leading-snug text-muted-foreground/70">
                        {opt.description}
                      </div>
                    )}
                  </div>

                  {/* Selection marker: beUI radio dot glides between rows for
                      single-select; multi-select keeps the check square. */}
                  {!multi ? (
                    <RadioDot
                      selected={isSelected}
                      layoutId={`${radioLayoutBase}-q${currentStep}`}
                      className="ml-auto"
                    />
                  ) : (
                    checkSquare(isSelected)
                  )}
                </motion.button>
              );
            })}

            {/* "Other" option */}
            <motion.button
              type="button"
              aria-pressed={isOtherOn}
              whileTap={multi || reduce ? undefined : { scale: 0.98 }}
              transition={SPRING_PRESS}
              onClick={() => toggleOther(currentStep, multi)}
              className={optionRowClass(isOtherOn)}
            >
              <kbd className={kbdClass(isOtherOn)}>0</kbd>
              <span className={`min-w-0 flex-1 text-left text-[13px] leading-tight transition-colors ${
                isOtherOn ? 'font-medium text-foreground' : 'text-muted-foreground'
              }`}>
                Other...
              </span>
              {!multi ? (
                <RadioDot
                  selected={isOtherOn}
                  layoutId={`${radioLayoutBase}-q${currentStep}`}
                  className="ml-auto"
                />
              ) : (
                checkSquare(isOtherOn)
              )}
            </motion.button>

            {/* Other text input — inline */}
            {isOtherOn && (
              <div className="pl-[30px] pr-1">
                <div className="relative">
                  <input
                    spellCheck={false}
                    autoCorrect="off"
                    ref={otherInputRef}
                    type="text"
                    value={otherTexts.get(currentStep) || ''}
                    onChange={(e) => setOtherText(currentStep, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (isLast) handleSubmit();
                        else setCurrentStep(s => s + 1);
                      }
                      // Prevent container keydown from firing
                      e.stopPropagation();
                    }}
                    placeholder="Type your answer..."
                    className="w-full rounded-md border-0 bg-muted/60 px-3 py-1.5 text-base text-foreground outline-none ring-1 ring-border transition-shadow duration-200 placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-ring md:text-[13px]"
                  />
                  <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm border border-border bg-muted px-1 py-0.5 font-mono text-[9px] text-muted-foreground/70">
                    Enter
                  </kbd>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer — ring-dot pager + forward button (beautifului Approval Card) */}
        <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/30 px-3 py-2">
          <span className="flex items-center gap-2">
            {!isSingle && (
              <>
                <button
                  type="button"
                  aria-label="Previous question"
                  disabled={isFirst}
                  onClick={() => setCurrentStep(s => Math.max(0, s - 1))}
                  className="relative touch-hit flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 enabled:hover:bg-muted enabled:hover:text-foreground disabled:opacity-35"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                </button>
                <span className="flex items-center gap-1">
                  {questions.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      aria-label={`Go to question ${i + 1}`}
                      aria-current={i === currentStep ? 'step' : undefined}
                      onClick={() => setCurrentStep(i)}
                      className="relative touch-hit rounded-full transition-all duration-300"
                      style={
                        i === currentStep
                          ? { width: 9, height: 9, border: '2.5px solid hsl(var(--foreground))' }
                          : i < currentStep
                            ? { width: 7, height: 7, background: 'hsl(var(--muted-foreground))' }
                            : { width: 7, height: 7, border: '1.5px solid hsl(var(--muted-foreground))' }
                      }
                    />
                  ))}
                </span>
                <button
                  type="button"
                  aria-label="Next question"
                  disabled={isLast}
                  onClick={() => setCurrentStep(s => Math.min(total - 1, s + 1))}
                  className="relative touch-hit flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 enabled:hover:bg-muted enabled:hover:text-foreground disabled:opacity-35"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                </button>
              </>
            )}
          </span>

          <motion.button
            type="button"
            aria-label={isLast ? 'Send answers' : 'Next question'}
            disabled={!forwardEnabled}
            whileTap={reduce || !forwardEnabled ? undefined : { scale: 0.96 }}
            transition={SPRING_PRESS}
            onClick={() => (isLast ? handleSubmit() : setCurrentStep(s => s + 1))}
            className={`relative touch-hit flex size-7 items-center justify-center rounded-md transition-colors duration-200 ${
              forwardEnabled
                ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
                : 'cursor-not-allowed bg-muted text-muted-foreground'
            }`}
            data-slot="approval-forward"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </motion.button>
        </div>
      </div>
    </div>
  );
};
