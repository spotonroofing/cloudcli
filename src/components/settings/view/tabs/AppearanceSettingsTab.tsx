import { useTranslation } from 'react-i18next';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../shared/view/beui/BeuiSelect';
import type { CodeEditorSettingsState } from '../../types/types';
import ThemePaletteDots from '../../../../shared/view/ThemePaletteDots';
import { useUiPreferences } from '../../../../hooks/useUiPreferences';
import { useTheme } from '../../../../contexts/ThemeContext';
import { COLOR_THEMES, hslTokenToHex } from '../../../../shared/themes';
import SettingsCard from '../SettingsCard';
import SettingsRow from '../SettingsRow';
import SettingsSection from '../SettingsSection';
import SettingsToggle from '../SettingsToggle';

type AppearanceSettingsTabProps = {
  codeEditorSettings: CodeEditorSettingsState;
  onCodeEditorWordWrapChange: (value: boolean) => void;
  onCodeEditorShowMinimapChange: (value: boolean) => void;
  onCodeEditorLineNumbersChange: (value: boolean) => void;
  onCodeEditorFontSizeChange: (value: string) => void;
};

export default function AppearanceSettingsTab({
  codeEditorSettings,
  onCodeEditorWordWrapChange,
  onCodeEditorShowMinimapChange,
  onCodeEditorLineNumbersChange,
  onCodeEditorFontSizeChange,
}: AppearanceSettingsTabProps) {
  const { t } = useTranslation('settings');
  const { preferences, setPreference } = useUiPreferences();
  const { colorTheme, setColorTheme, isDarkMode, customAccent, setCustomAccent, themeMode, setThemeMode } = useTheme();

  // Seed the color input from the accent actually in effect: the custom hex,
  // or the active theme's own accent (last palette dot for the current mode).
  const activeTheme = COLOR_THEMES.find((theme) => theme.id === colorTheme) ?? COLOR_THEMES[0];
  const themeAccent = activeTheme.dots[isDarkMode ? 'dark' : 'light'][3];
  const accentValue =
    customAccent ?? hslTokenToHex(themeAccent.replace(/^hsl\(|\)$/g, '')) ?? '#000000';

  return (
    <div className="space-y-5">
      <SettingsSection title={t('appearanceSettings.theme.label')}>
        <SettingsCard divided>
          <SettingsRow
            label={t('appearanceSettings.theme.label')}
            description={t('appearanceSettings.theme.description')}
          >
            <Select
              value={colorTheme}
              onValueChange={setColorTheme}
              className="w-36"
            >
              <SelectTrigger className="h-7 px-2 py-0 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COLOR_THEMES.map((theme) => (
                  <SelectItem key={theme.id} value={theme.id} textValue={theme.label}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{theme.label}</span>
                      <ThemePaletteDots themeId={theme.id} />
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>
          <SettingsRow
            label={t('appearanceSettings.accent.label')}
            description={t('appearanceSettings.accent.description')}
          >
            <div className="flex items-center gap-2">
              {customAccent ? (
                <button
                  type="button"
                  onClick={() => setCustomAccent(null)}
                  className="touch-manipulation text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  {t('appearanceSettings.accent.reset')}
                </button>
              ) : null}
              <label
                className="relative block h-7 w-10 cursor-pointer rounded-md border border-input transition-colors hover:border-muted-foreground/40"
                style={{ backgroundColor: 'hsl(var(--primary))' }}
              >
                <input
                  type="color"
                  value={accentValue}
                  onChange={(event) => setCustomAccent(event.target.value)}
                  aria-label={t('appearanceSettings.accent.label')}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </label>
            </div>
          </SettingsRow>
          <SettingsRow
            label={t('appearanceSettings.themeMode.label')}
            description={t('appearanceSettings.themeMode.description')}
          >
            <Select value={themeMode} onValueChange={setThemeMode} className="w-28">
              <SelectTrigger className="h-7 px-2 py-0 text-xs" aria-label={t('appearanceSettings.themeMode.label')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">{t('appearanceSettings.themeMode.system')}</SelectItem>
                <SelectItem value="light">{t('appearanceSettings.themeMode.light')}</SelectItem>
                <SelectItem value="dark">{t('appearanceSettings.themeMode.dark')}</SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('quickSettings.sections.toolDisplay')}>
        <SettingsCard divided>
          <SettingsRow label={t('quickSettings.showRawParameters')}>
            <SettingsToggle
              checked={preferences.showRawParameters}
              onChange={(value) => setPreference('showRawParameters', value)}
              ariaLabel={t('quickSettings.showRawParameters')}
            />
          </SettingsRow>
          <SettingsRow label={t('quickSettings.showThinking')}>
            <SettingsToggle
              checked={preferences.showThinking}
              onChange={(value) => setPreference('showThinking', value)}
              ariaLabel={t('quickSettings.showThinking')}
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('quickSettings.sections.inputSettings')}>
        <SettingsCard>
          <SettingsRow
            label={t('quickSettings.sendByCtrlEnter')}
            description={t('quickSettings.sendByCtrlEnterDescription')}
          >
            <SettingsToggle
              checked={preferences.sendByCtrlEnter}
              onChange={(value) => setPreference('sendByCtrlEnter', value)}
              ariaLabel={t('quickSettings.sendByCtrlEnter')}
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearanceSettings.codeEditor.title')}>
        <SettingsCard divided>
          <SettingsRow
            label={t('appearanceSettings.codeEditor.wordWrap.label')}
            description={t('appearanceSettings.codeEditor.wordWrap.description')}
          >
            <SettingsToggle
              checked={codeEditorSettings.wordWrap}
              onChange={onCodeEditorWordWrapChange}
              ariaLabel={t('appearanceSettings.codeEditor.wordWrap.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.codeEditor.showMinimap.label')}
            description={t('appearanceSettings.codeEditor.showMinimap.description')}
          >
            <SettingsToggle
              checked={codeEditorSettings.showMinimap}
              onChange={onCodeEditorShowMinimapChange}
              ariaLabel={t('appearanceSettings.codeEditor.showMinimap.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.codeEditor.lineNumbers.label')}
            description={t('appearanceSettings.codeEditor.lineNumbers.description')}
          >
            <SettingsToggle
              checked={codeEditorSettings.lineNumbers}
              onChange={onCodeEditorLineNumbersChange}
              ariaLabel={t('appearanceSettings.codeEditor.lineNumbers.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.codeEditor.fontSize.label')}
            description={t('appearanceSettings.codeEditor.fontSize.description')}
          >
            <Select
              value={codeEditorSettings.fontSize}
              onValueChange={onCodeEditorFontSizeChange}
              className="w-20"
            >
              <SelectTrigger className="h-7 px-2 py-0 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent listClassName="max-h-64 overflow-y-auto">
                {['10', '11', '12', '13', '14', '15', '16', '18', '20'].map((size) => (
                  <SelectItem key={size} value={size}>
                    {`${size}px`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
