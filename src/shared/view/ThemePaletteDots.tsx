import { useTheme } from '../../contexts/ThemeContext';
import { COLOR_THEMES } from '../themes';

/**
 * Palette preview for the theme selector (ui10 phase 3): a row of four small
 * dots — surface, secondary, ink, accent — from the theme's mode-matching
 * palette in themes.ts. A custom accent replaces every theme's accent dot,
 * since it overrides whichever theme is active.
 */
export default function ThemePaletteDots({ themeId }: { themeId: string }) {
  const { isDarkMode, customAccent } = useTheme();
  const theme = COLOR_THEMES.find((t) => t.id === themeId);
  if (!theme) return null;
  const palette = isDarkMode ? theme.dots.dark : theme.dots.light;
  const dots = customAccent ? [...palette.slice(0, 3), customAccent] : palette;
  return (
    <span data-slot="theme-palette-dots" aria-hidden className="flex shrink-0 items-center gap-1">
      {dots.map((color, i) => (
        <span
          key={i}
          className="h-2 w-2 rounded-full border border-border"
          style={{ backgroundColor: color }}
        />
      ))}
    </span>
  );
}
