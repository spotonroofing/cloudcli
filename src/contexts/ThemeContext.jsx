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
  // Check for saved theme preference or default to system preference
  const [isDarkMode, setIsDarkMode] = useState(() => {
    // Check localStorage first
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
      return savedTheme === 'dark';
    }
    
    // Check system preference
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
  }, [isDarkMode, colorTheme, customAccent]);

  // Another tab or device changed the theme: apply it here live.
  useEffect(() => onSettingChange(['theme', 'color-theme', 'custom-accent'], (key, value) => {
    if (key === 'theme') {
      if (value) setIsDarkMode(value === 'dark');
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
      // Only update if user hasn't manually set a preference
      const savedTheme = localStorage.getItem('theme');
      if (!savedTheme) {
        setIsDarkMode(e.matches);
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const toggleDarkMode = () => {
    setIsDarkMode(prev => !prev);
  };

  const value = {
    isDarkMode,
    toggleDarkMode,
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
