import React, { createContext, useContext, useState, useEffect } from 'react';

import { DEFAULT_COLOR_THEME, hexToHsl, isAccentHex, isColorTheme } from '../shared/themes';
import { onSettingChange, writeSetting } from '../utils/cloudSettings';

// The accent token family: every custom-accent override touches exactly these
// (light and dark instances both, derived from one picked hex).
const ACCENT_TOKENS = [
  '--primary',
  '--primary-foreground',
  '--ring',
  '--nav-tab-glow',
  '--nav-tab-ring',
  '--nav-input-focus-ring',
];

// Derive the mode's accent set from the picked hex: light mode uses the hex
// as-is; dark mode lifts lightness so the accent reads on dark surfaces
// (mirrors how every theme's dark primary sits lighter than its light one).
const applyCustomAccent = (root, hex, isDark) => {
  const { h, s, l } = hexToHsl(hex);
  const lift = isDark ? Math.max(l, 62) : l;
  const hsl = `${h} ${s}% ${lift}%`;
  root.style.setProperty('--primary', hsl);
  root.style.setProperty('--ring', hsl);
  root.style.setProperty('--primary-foreground', lift > 60 ? `${h} 25% 10%` : '0 0% 100%');
  root.style.setProperty('--nav-tab-glow', `${hsl} / ${isDark ? 0.25 : 0.18}`);
  root.style.setProperty('--nav-tab-ring', `${hsl} / ${isDark ? 0.15 : 0.1}`);
  root.style.setProperty('--nav-input-focus-ring', `${hsl} / ${isDark ? 0.25 : 0.22}`);
};

const clearCustomAccent = (root) => {
  ACCENT_TOKENS.forEach((token) => root.style.removeProperty(token));
};

const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export const ThemeProvider = ({ children }) => {
  const [themeMode, setThemeModeState] = useState(() => {
    const savedMode = localStorage.getItem('theme-mode');
    if (savedMode === 'system' || savedMode === 'light' || savedMode === 'dark') {
      return savedMode;
    }
    const legacyTheme = localStorage.getItem('theme');
    return legacyTheme === 'light' || legacyTheme === 'dark' ? legacyTheme : 'system';
  });

  // Resolve the selected mode to the concrete class used by the token system.
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const savedMode = localStorage.getItem('theme-mode');
    if (savedMode === 'light' || savedMode === 'dark') {
      return savedMode === 'dark';
    }
    const legacyTheme = localStorage.getItem('theme');
    if (!savedMode && (legacyTheme === 'light' || legacyTheme === 'dark')) {
      return legacyTheme === 'dark';
    }
    if (window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  // Named color theme (ui8 phase 4): a full token set selected in
  // Settings → Appearance, applied via data-theme on <html>.
  const [colorTheme, setColorTheme] = useState(() => {
    const saved = localStorage.getItem('color-theme');
    return isColorTheme(saved) ? saved : DEFAULT_COLOR_THEME;
  });

  // Custom accent (ui10 phase 3): a picked hex that overrides the active
  // theme's accent token family; null means the theme's own accent.
  const [customAccent, setCustomAccentState] = useState(() => {
    const saved = localStorage.getItem('custom-accent');
    return isAccentHex(saved) ? saved : null;
  });

  const setCustomAccent = (hex) => {
    setCustomAccentState(isAccentHex(hex) ? hex : null);
  };

  // Update document class/attribute and localStorage when theme changes
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', colorTheme);
    writeSetting('color-theme', colorTheme);
    writeSetting('theme-mode', themeMode);

    if (customAccent) {
      applyCustomAccent(root, customAccent, isDarkMode);
      writeSetting('custom-accent', customAccent);
    } else {
      clearCustomAccent(root);
      writeSetting('custom-accent', null);
    }

    if (isDarkMode) {
      root.classList.add('dark');
      writeSetting('theme', 'dark');
    } else {
      root.classList.remove('dark');
      writeSetting('theme', 'light');
    }

    // iOS status bar style follows light/dark
    const statusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (statusBarMeta) {
      statusBarMeta.setAttribute('content', isDarkMode ? 'black-translucent' : 'default');
    }

    // The browser theme color is whatever background the active theme resolves to
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
      const background = getComputedStyle(root).getPropertyValue('--background').trim();
      if (background) {
        themeColorMeta.setAttribute('content', `hsl(${background})`);
      }
    }
  }, [isDarkMode, themeMode, colorTheme, customAccent]);

  // Another tab or device changed the theme: apply it here live.
  useEffect(() => onSettingChange(['theme', 'theme-mode', 'color-theme', 'custom-accent'], (key, value) => {
    if (key === 'theme-mode') {
      if (value === 'system' || value === 'light' || value === 'dark') {
        setThemeModeState(value);
        setIsDarkMode(value === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
          : value === 'dark');
      }
    } else if (key === 'theme') {
      if (!localStorage.getItem('theme-mode') && (value === 'light' || value === 'dark')) {
        setThemeModeState(value);
        setIsDarkMode(value === 'dark');
      }
    } else if (key === 'color-theme') {
      if (isColorTheme(value)) setColorTheme(value);
    } else {
      setCustomAccentState(isAccentHex(value) ? value : null);
    }
  }), []);

  // Listen for system theme changes
  useEffect(() => {
    if (!window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e) => {
      if (themeMode === 'system') {
        setIsDarkMode(e.matches);
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [themeMode]);

  const setThemeMode = (mode) => {
    if (mode !== 'system' && mode !== 'light' && mode !== 'dark') return;
    setThemeModeState(mode);
    setIsDarkMode(mode === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : mode === 'dark');
  };

  const toggleDarkMode = () => {
    setIsDarkMode(prev => {
      const next = !prev;
      setThemeModeState(next ? 'dark' : 'light');
      return next;
    });
  };

  const value = {
    isDarkMode,
    toggleDarkMode,
    themeMode,
    setThemeMode,
    colorTheme,
    setColorTheme,
    customAccent,
    setCustomAccent,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};
