// Named color themes (ui8 phase 4). Each id maps to a full token set in
// src/index.css: the base :root/.dark pair is Steel Blue; every other theme
// overrides the color tokens via [data-theme='<id>'] blocks. Labels are
// proper names and are not translated.
export type ColorTheme = {
  id: string;
  label: string;
};

export const COLOR_THEMES: ColorTheme[] = [
  { id: 'steel-blue', label: 'Steel Blue' },
  { id: 'graphite', label: 'Graphite' },
  { id: 'ink', label: 'Ink' },
  { id: 'moss', label: 'Moss' },
  { id: 'copper', label: 'Copper' },
  { id: 'dune', label: 'Dune' },
];

export const DEFAULT_COLOR_THEME = 'steel-blue';

export const isColorTheme = (value: unknown): boolean =>
  COLOR_THEMES.some((theme) => theme.id === value);
