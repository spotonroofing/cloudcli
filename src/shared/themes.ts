// Named color themes (ui8 phase 4, layered in ui10 phase 3). Each id maps to
// a full token set in src/index.css: the base :root/.dark pair is Steel Blue;
// every other theme overrides the color tokens via [data-theme='<id>'] blocks.
// Labels are proper names and are not translated. `dots` is the palette
// preview shown in the theme selector — [surface, secondary, ink, accent] per
// mode, kept in lockstep with the CSS token values by hand.
export type ColorTheme = {
  id: string;
  label: string;
  dots: { light: [string, string, string, string]; dark: [string, string, string, string] };
};

export const COLOR_THEMES: ColorTheme[] = [
  {
    id: 'steel-blue',
    label: 'Steel Blue',
    dots: {
      light: ['hsl(44 22% 96%)', 'hsl(44 15% 91%)', 'hsl(36 25% 4%)', 'hsl(211 20% 45%)'],
      dark: ['hsl(0 0% 8%)', 'hsl(0 0% 17%)', 'hsl(40 8% 93%)', 'hsl(211 22% 64%)'],
    },
  },
  {
    id: 'graphite',
    label: 'Graphite',
    dots: {
      light: ['hsl(0 0% 96.5%)', 'hsl(0 0% 90.5%)', 'hsl(0 0% 8%)', 'hsl(0 0% 26%)'],
      dark: ['hsl(0 0% 8%)', 'hsl(0 0% 17%)', 'hsl(0 0% 93%)', 'hsl(0 0% 78%)'],
    },
  },
  {
    id: 'ink',
    label: 'Ink',
    dots: {
      light: ['hsl(40 28% 95.5%)', 'hsl(40 20% 89.5%)', 'hsl(228 25% 9%)', 'hsl(226 45% 35%)'],
      dark: ['hsl(228 18% 8%)', 'hsl(228 12% 16%)', 'hsl(40 18% 90%)', 'hsl(224 42% 72%)'],
    },
  },
  {
    id: 'moss',
    label: 'Moss',
    dots: {
      light: ['hsl(210 12% 95.5%)', 'hsl(210 10% 89.5%)', 'hsl(25 18% 9%)', 'hsl(146 30% 33%)'],
      dark: ['hsl(200 10% 7.5%)', 'hsl(200 7% 15.5%)', 'hsl(40 12% 90%)', 'hsl(146 24% 60%)'],
    },
  },
  {
    id: 'copper',
    label: 'Copper',
    dots: {
      light: ['hsl(215 16% 95.5%)', 'hsl(215 13% 90%)', 'hsl(20 18% 9%)', 'hsl(18 55% 42%)'],
      dark: ['hsl(215 12% 8%)', 'hsl(215 8% 15.5%)', 'hsl(30 18% 90%)', 'hsl(20 48% 65%)'],
    },
  },
  {
    id: 'dune',
    label: 'Dune',
    dots: {
      light: ['hsl(42 34% 93.5%)', 'hsl(42 26% 87.5%)', 'hsl(28 28% 9%)', 'hsl(188 55% 28%)'],
      dark: ['hsl(36 14% 8%)', 'hsl(36 10% 15.5%)', 'hsl(42 20% 90%)', 'hsl(185 38% 58%)'],
    },
  },
  {
    id: 'glacier',
    label: 'Glacier',
    dots: {
      light: ['hsl(205 28% 95.5%)', 'hsl(205 20% 89.5%)', 'hsl(24 14% 9%)', 'hsl(197 52% 34%)'],
      dark: ['hsl(218 16% 8%)', 'hsl(218 11% 16%)', 'hsl(34 12% 91%)', 'hsl(197 46% 62%)'],
    },
  },
  {
    id: 'plum',
    label: 'Plum',
    dots: {
      light: ['hsl(330 18% 96%)', 'hsl(330 14% 90.5%)', 'hsl(286 22% 9%)', 'hsl(42 70% 31%)'],
      dark: ['hsl(287 15% 8%)', 'hsl(287 10% 16%)', 'hsl(35 18% 91%)', 'hsl(44 56% 62%)'],
    },
  },
  {
    id: 'marine',
    label: 'Marine',
    dots: {
      light: ['hsl(168 18% 95%)', 'hsl(168 14% 89%)', 'hsl(219 30% 9%)', 'hsl(8 62% 38%)'],
      dark: ['hsl(205 20% 7.5%)', 'hsl(205 14% 15.5%)', 'hsl(45 15% 91%)', 'hsl(10 65% 65%)'],
    },
  },
  {
    id: 'lichen',
    label: 'Lichen',
    dots: {
      light: ['hsl(62 18% 94.5%)', 'hsl(75 12% 88.5%)', 'hsl(214 20% 10%)', 'hsl(88 38% 31%)'],
      dark: ['hsl(72 9% 7.5%)', 'hsl(72 7% 15.5%)', 'hsl(205 12% 90%)', 'hsl(84 34% 59%)'],
    },
  },
  {
    id: 'berry',
    label: 'Berry',
    dots: {
      light: ['hsl(218 18% 95.5%)', 'hsl(218 14% 89.5%)', 'hsl(20 20% 9%)', 'hsl(328 48% 38%)'],
      dark: ['hsl(225 15% 8%)', 'hsl(225 10% 16%)', 'hsl(32 16% 91%)', 'hsl(330 45% 66%)'],
    },
  },
  {
    id: 'sienna',
    label: 'Sienna',
    dots: {
      light: ['hsl(150 12% 95%)', 'hsl(150 9% 89.5%)', 'hsl(272 15% 9%)', 'hsl(25 58% 38%)'],
      dark: ['hsl(255 10% 8%)', 'hsl(255 7% 16%)', 'hsl(42 16% 91%)', 'hsl(28 52% 63%)'],
    },
  },
];

export const DEFAULT_COLOR_THEME = 'steel-blue';

export const isColorTheme = (value: unknown): boolean =>
  COLOR_THEMES.some((theme) => theme.id === value);

// Custom accent (ui10 phase 3): a #rrggbb hex the user picks in Appearance,
// persisted in localStorage 'custom-accent' and applied by ThemeContext as
// inline overrides of the accent token family on <html>.
export const isAccentHex = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);

export const hexToHsl = (hex: string): { h: number; s: number; l: number } => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = d / (l > 0.5 ? 2 - max - min : max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: Math.round(h * 60), s: Math.round(s * 100), l: Math.round(l * 100) };
};

// Converts a token-format HSL string ("211 20% 45%") to #rrggbb, e.g. to seed
// the accent picker from the active theme's computed --primary.
export const hslTokenToHex = (token: string): string | null => {
  const m = token.trim().match(/^([\d.]+)[,\s]+([\d.]+)%[,\s]+([\d.]+)%$/);
  if (!m) return null;
  const h = parseFloat(m[1]);
  const s = parseFloat(m[2]) / 100;
  const l = parseFloat(m[3]) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};
