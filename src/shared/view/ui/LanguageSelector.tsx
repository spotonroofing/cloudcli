import { useTranslation } from 'react-i18next';

import { languages } from '../../../i18n/languages';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../beui/BeuiSelect';

/**
 * Language Selector Component
 *
 * A dropdown component for selecting the application language.
 * Automatically updates the i18n language and persists to localStorage.
 */
export default function LanguageSelector() {
  const { i18n, t } = useTranslation('settings');

  const handleLanguageChange = (newLanguage: string) => {
    i18n.changeLanguage(newLanguage);
  };

  const select = (
    <Select
      value={i18n.language}
      onValueChange={handleLanguageChange}
      className="w-44"
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
