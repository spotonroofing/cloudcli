import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, HTMLAttributes } from 'react';
import {
  BorderBeam as BeamEngine,
  type BorderBeamProps as BeamEngineProps,
} from 'border-beam';

import { cn } from '../../../lib/utils';

/**
 * BorderBeam — the sidebar activity shimmer, vendored per PUNCHLIST_ui7 phase 5
 * from spoton-core's border-beam wrapper (itself the npm `border-beam` v1.3
 * engine, beam.jakubantalik.com) and slimmed for this app: ROTATE mode and the
 * MONO colorway only, rethemed neutral silver — no SpotOn brand blue, no pulse
 * or palette machinery, no SSR shell (this is a Vite SPA).
 *
 * - Ink is `--beam-ink` (defined per theme in src/index.css): a quiet silver
 *   that leans graphite in light and pale silver in dark. Never the accent.
 * - Appearance/disappearance always fades: keep the component mounted and
 *   drive the `active` prop — the engine cross-fades and stamps
 *   `data-fading` during the out transition (the phase-5 "no hard cutoff" law).
 * - Corner-true rotate (carried from the spoton wrapper): the engine's stock
 *   rotate beam runs out of paint at corners and bakes a dark leading edge in
 *   light mode, so the three beam layers are re-declared per instance as one
 *   angular comet conic in the ink color, driven by the engine's own
 *   `--beam-angle-<id>`.
 * - Mono visibility gains (proven values from spoton-core's token pipeline):
 *   the engine's opacity bases land near-invisible without per-layer lifts.
 */

const AMBIENT_STRENGTH = 0.4;

const MONO_GAIN: Record<'light' | 'dark', { stroke: number; inner: number; bloom: number }> = {
  light: { stroke: 12, inner: 0.25, bloom: 0.3 },
  dark: { stroke: 5, inner: 1, bloom: 2.5 },
};

/** One angular comet conic in the ink color, phase-aligned with the engine's rotating mask. */
function rotateOverrideCss(id: string): string {
  const ink = 'hsl(var(--beam-ink))';
  const at = (pct: number) => `color-mix(in srgb, ${ink} ${pct}%, transparent)`;
  const comet = `conic-gradient(from var(--beam-angle-${id}), transparent 0%, transparent 46%, ${at(12)} 58%, ${at(36)} 68%, ${at(72)} 75%, ${ink} 78%, ${ink} 80%, ${at(26)} 86%, transparent 92%, transparent 100%)`;
  return `
[data-beam="${id}"][data-active]::after,
[data-beam="${id}"][data-fading]::after,
[data-beam="${id}"][data-active]::before,
[data-beam="${id}"][data-fading]::before,
[data-beam="${id}"] [data-beam-bloom] {
  background: ${comet};
}`;
}

/** Tracks the app's `.dark` root class so the engine tints for the live theme. */
function useAppTheme(): 'dark' | 'light' {
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(root.classList.contains('dark') ? 'dark' : 'light');
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

export interface BorderBeamProps
  extends Omit<BeamEngineProps, 'size' | 'colorVariant' | 'theme' | 'strength' | 'staticColors'> {
  /** 0-1 strength override; defaults to the ambient 0.4 ceiling. */
  strength?: number;
}

export const BorderBeam = forwardRef<HTMLDivElement, BorderBeamProps>(
  function BorderBeam({ strength, children, style, ...props }, ref) {
    const theme = useAppTheme();
    const hostRef = useRef<HTMLDivElement | null>(null);
    const setRefs = useCallback(
      (node: HTMLDivElement | null) => {
        hostRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      },
      [ref],
    );
    // Corner-true rotate: read the engine's per-instance id off the DOM and
    // inject the comet override after its stylesheet (document order wins).
    const [engineId, setEngineId] = useState<string | null>(null);
    useEffect(() => {
      setEngineId(hostRef.current?.getAttribute('data-beam') ?? null);
    }, []);
    const gain = MONO_GAIN[theme];
    const mergedStyle: CSSProperties = {
      '--beam-stroke-opacity': gain.stroke,
      '--beam-inner-opacity': gain.inner,
      '--beam-bloom-opacity': gain.bloom,
      ...style,
    } as CSSProperties;
    return (
      <>
        <BeamEngine
          ref={setRefs}
          size="md"
          strength={strength ?? AMBIENT_STRENGTH}
          colorVariant="mono"
          staticColors
          theme={theme}
          style={mergedStyle}
          {...props}
        >
          {children}
        </BeamEngine>
        {engineId ? <style>{rotateOverrideCss(engineId)}</style> : null}
      </>
    );
  },
);

/**
 * Presence for an on-demand beam: mounts the engine when `active` flips on
 * (it fades itself in) and keeps it mounted through the fade-out, unmounting
 * only when the engine reports `onDeactivate` — so idle rows carry no beam
 * DOM at all and no appearance or disappearance ever hard-cuts.
 */
export function useBeamPresence(active: boolean): {
  mounted: boolean;
  beamProps: { active: boolean; onDeactivate: () => void };
} {
  const [mounted, setMounted] = useState(active);
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (active) setMounted(true);
  }, [active]);
  // A reactivation mid-fade must not unmount the beam the engine is fading back in.
  const onDeactivate = useCallback(() => {
    if (!activeRef.current) setMounted(false);
  }, []);
  return useMemo(
    () => ({ mounted, beamProps: { active, onDeactivate } }),
    [mounted, active, onDeactivate],
  );
}

export interface BorderBeamOverlayProps extends Omit<BorderBeamProps, 'children'> {
  /** Radius classes for the beam frame when the host's radius lives elsewhere. */
  frameClassName?: string;
}

/**
 * Sibling-overlay composition: stretches the beam over a `relative` host
 * (a sidebar row) without re-wrapping its content. Decorative and
 * pointer-transparent; the frame inherits the host's computed radius so the
 * engine's radius auto-detection follows the row's corners.
 */
export function BorderBeamOverlay({ className, frameClassName, style, ...props }: BorderBeamOverlayProps) {
  return (
    <BorderBeam
      aria-hidden
      className={cn('pointer-events-none', className)}
      // Inline position: the engine stamps `position: relative` on its wrapper
      // via [data-beam] after our stylesheet, which would collapse the overlay
      // into a 0-width in-flow box. Inline style always wins.
      style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', ...style }}
      {...props}
    >
      <span
        className={cn('absolute inset-0 block', frameClassName)}
        style={frameClassName ? undefined : { borderRadius: 'inherit' }}
      />
    </BorderBeam>
  );
}
