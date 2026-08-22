import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';

import { languages } from '../../../i18n/languages';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../beui/BeuiSelect';

type LanguageSelectorProps = {
  compact?: boolean;
};

/**
 * Language Selector Component
 *
 * A dropdown component for selecting the application language.
 * Automatically updates the i18n language and persists to localStorage.
 *
 * Props:
 * @param {boolean} compact - If true, uses compact style (default: false)
 */
export default function LanguageSelector({ compact = false }: LanguageSelectorProps) {
  const { i18n, t } = useTranslation('settings');

  const handleLanguageChange = (newLanguage: string) => {
    i18n.changeLanguage(newLanguage);
  };

  const select = (
    <Select
      value={i18n.language}
      onValueChange={handleLanguageChange}
      className={compact ? 'w-40' : 'w-44'}
    >
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent listClassName="max-h-64 overflow-y-auto">
        {languages.map((lang) => (
          <SelectItem key={lang.value} value={lang.value}>
            {lang.nativeName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  // Compact style for QuickSettingsPanel
  if (compact) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-transparent bg-muted/50 p-3 transition-colors hover:border-border hover:bg-accent">
        <span className="flex items-center gap-2 text-sm text-foreground">
          <Languages className="h-4 w-4 text-muted-foreground" />
          {t('account.language')}
        </span>
        {select}
      </div>
    );
  }

  // Full style for Settings page
  return (
    <div className="flex items-center justify-between px-4 py-3.5">
      <div>
        <div className="text-sm font-medium text-foreground">
          {t('account.languageLabel')}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {t('account.languageDescription')}
        </div>
      </div>
      {select}
    </div>
  );
}
