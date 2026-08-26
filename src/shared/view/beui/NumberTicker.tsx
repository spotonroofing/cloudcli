import { animate, motion, useInView, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { cn } from '../../../lib/utils';

import { EASE_OUT } from './ease';

// beUI NumberTicker (beui.dev/components/motion/number), vendored per the
// fidelity law: rolling digit columns keyed by place value so a changing digit
// rolls to its new value instead of remounting. Used for live counts on the
// chat surface (composer character counter, usage numbers).

export interface NumberTickerProps {
  value: number;
  /** Digits to pad to (left). */
  pad?: number;
  /** Per-digit roll duration in seconds. */
  duration?: number;
  /** Stagger between digits. */
  stagger?: number;
  /** Render only after the element enters the viewport. */
  startOnView?: boolean;
  prefix?: string;
  suffix?: string;
  /** Add a small blur during digit rolls. */
  blur?: boolean;
  className?: string;
  digitClassName?: string;
  /** Insert locale group separators (commas). */
  locale?: boolean;
  /** Custom formatter. */
  format?: (value: number) => string;
}

const DIGIT_HEIGHT_EM = 1.1;
const DIGITS = Array.from({ length: 10 }, (_, n) => n);

export function NumberTicker({
  value,
  pad,
  duration = 0.9,
  stagger = 0.04,
  startOnView = true,
  prefix,
  suffix,
  blur = false,
  className,
  digitClassName,
  locale,
  format,
}: NumberTickerProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const inView = useInView(containerRef, { once: true, amount: 0.6 });
  const [armed, setArmed] = useState(!startOnView);

  // The rolling columns translate by whole multiples of the digit-box height
  // on a composited layer, and browsers pixel-snap each column's layer
  // independently. A fractional box height (1.1em is fractional at most
  // font sizes, zooms, and DPRs) snaps every column a different subpixel
  // amount, so digits visibly ride high or low relative to each other.
  // Snapping the step to whole device pixels keeps every column on the grid.
  const [stepPx, setStepPx] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const fontSize = parseFloat(getComputedStyle(el).fontSize);
    const dpr = window.devicePixelRatio || 1;
    setStepPx(Math.round(fontSize * DIGIT_HEIGHT_EM * dpr) / dpr);
  }, []);
  const step = stepPx === null ? `${DIGIT_HEIGHT_EM}em` : `${stepPx}px`;

  // Non-digit glyphs (k, M, %, separators, prefix/suffix) get the same box
  // as the rolling digit columns, with a matching line-height so every glyph
  // shares one baseline. Without this the plain spans inherit the surrounding
  // line-height and sit a pixel or two off the digits.
  const glyphBoxStyle = { height: step, lineHeight: step };

  useEffect(() => {
    if (startOnView && inView) setArmed(true);
  }, [startOnView, inView]);

  const text = useMemo(() => {
    const rounded = Math.round(value);
    const formatted = format
      ? format(rounded)
      : locale
        ? rounded.toLocaleString()
        : rounded.toString();
    return pad ? formatted.padStart(pad, '0') : formatted;
  }, [value, pad, format, locale]);
  const glyphs = useMemo(() => {
    const chars = text.split('');
    // Key by place value (position from the right): a changing digit keeps its
    // identity and rolls to the new value instead of remounting and replaying
    // from 0. Growing numbers add glyphs on the left without re-keying the
    // ones, tens, hundreds already on screen.
    return chars.map((char, i) => ({ char, id: `g-${chars.length - 1 - i}` }));
  }, [text]);
  const readableText = `${prefix ?? ''}${text}${suffix ?? ''}`;

  // Stagger is an entrance flourish. Once the reveal has played, value
  // changes roll every digit immediately — a per-digit delay on live updates
  // reads as lag.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (!armed || entered) return;
    const total = (duration + glyphs.length * stagger) * 1000;
    const t = window.setTimeout(() => setEntered(true), total);
    return () => window.clearTimeout(t);
  }, [armed, entered, duration, stagger, glyphs.length]);

  return (
    <span
      ref={containerRef}
      className={cn('inline-flex items-center tabular-nums', className)}
    >
      <span className="sr-only">{readableText}</span>
      <span aria-hidden="true" className="inline-flex items-center">
        {/* Zero-width baseline anchor. The digit columns are overflow-hidden
            inline-blocks, whose CSS baseline is their bottom edge — when a
            digit is the first flex item the whole ticker aligns its bottom
            edge to the surrounding text baseline and the digits float high.
            A real text glyph first gives the ticker the true 1.1em-box
            baseline, so it sits on the line like plain text. */}
        <span className="inline-block w-0" style={glyphBoxStyle}>
          {'\u200B'}
        </span>
        {prefix ? <span className="inline-block" style={glyphBoxStyle}>{prefix}</span> : null}
        {glyphs.map(({ char, id }, i) => {
          const isDigit = /\d/.test(char);
          if (!isDigit) {
            return (
              <span key={id} className="inline-block" style={glyphBoxStyle}>
                {/* An inline-block whose only content is a collapsible space
                    renders zero width ("1m 21s" became "1m21s"); NBSP keeps
                    the same mono advance width without collapsing. */}
                {char === ' ' ? '\u00A0' : char}
              </span>
            );
          }
          const digit = Number(char);
          return (
            <Digit
              key={id}
              digit={armed ? digit : 0}
              delay={entered ? 0 : i * stagger}
              duration={duration}
              blur={blur}
              stepPx={stepPx}
              className={digitClassName}
            />
          );
        })}
        {suffix ? <span className="inline-block" style={glyphBoxStyle}>{suffix}</span> : null}
      </span>
    </span>
  );
}

function Digit({
  digit,
  delay,
  duration,
  blur,
  stepPx,
  className,
}: {
  digit: number;
  delay: number;
  duration: number;
  blur: boolean;
  stepPx: number | null;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const columnRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (reduce || !blur || !columnRef.current || !Number.isFinite(digit)) {
      return;
    }

    const node = columnRef.current;
    const controls = animate(
      node,
      { filter: ['blur(10px)', 'blur(0px)'] },
      {
        duration: Math.min(duration * 0.75, 0.32),
        delay,
        ease: EASE_OUT,
      },
    );

    return () => {
      controls.stop();
      node.style.filter = 'blur(0px)';
    };
  }, [blur, delay, digit, duration, reduce]);

  const boxHeight = stepPx === null ? `${DIGIT_HEIGHT_EM}em` : `${stepPx}px`;
  return (
    <span
      className={cn('relative inline-block overflow-hidden', className)}
      style={{ height: boxHeight, width: '1ch' }}
    >
      <motion.span
        ref={columnRef}
        initial={{ y: 0 }}
        animate={{ y: stepPx === null ? `-${digit * DIGIT_HEIGHT_EM}em` : `-${digit * stepPx}px` }}
        transition={
          reduce
            ? { duration: 0 }
            : { duration, delay, ease: EASE_OUT }
        }
        className="absolute inset-x-0 top-0 flex flex-col items-center will-change-[transform,filter]"
      >
        {DIGITS.map((n) => (
          <span
            key={n}
            className="flex items-center justify-center leading-none"
            style={{ height: boxHeight }}
          >
            {n}
          </span>
        ))}
      </motion.span>
    </span>
  );
}
