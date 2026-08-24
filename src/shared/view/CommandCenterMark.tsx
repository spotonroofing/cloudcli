/**
 * The Command Center mark: the command bracket — a caret held between two
 * square brackets, the console frame around the prompt. Geometry mirrors
 * public/generate-icons.js (the single source of truth for the generated
 * assets — keep the two in sync if the shape changes). Stroke is
 * currentColor so the mark recolors with the active theme.
 */
export default function CommandCenterMark({
  className,
  strokeWidth = 4,
}: {
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className={className}>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M25 13 L15 13 L15 51 L25 51" />
        <path d="M39 13 L49 13 L49 51 L39 51" />
        <path d="M26.5 22.5 L38 32 L26.5 41.5" />
      </g>
    </svg>
  );
}
