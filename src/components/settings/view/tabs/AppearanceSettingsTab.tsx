import { useTranslation } from 'react-i18next';
import { DarkModeToggle } from '../../../../shared/view/ui';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../shared/view/beui/BeuiSelect';
import type { CodeEditorSettingsState, ProjectSortOrder } from '../../types/types';
import LanguageSelector from '../../../../shared/view/ui/LanguageSelector';
import { useUiPreferences } from '../../../../hooks/useUiPreferences';
import SettingsCard from '../SettingsCard';
import SettingsRow from '../SettingsRow';
import SettingsSection from '../SettingsSection';
import SettingsToggle from '../SettingsToggle';

type AppearanceSettingsTabProps = {
  projectSortOrder: ProjectSortOrder;
  onProjectSortOrderChange: (value: ProjectSortOrder) => void;
  codeEditorSettings: CodeEditorSettingsState;
  onCodeEditorWordWrapChange: (value: boolean) => void;
  onCodeEditorShowMinimapChange: (value: boolean) => void;
  onCodeEditorLineNumbersChange: (value: boolean) => void;
  onCodeEditorFontSizeChange: (value: string) => void;
};

export default function AppearanceSettingsTab({
  projectSortOrder,
  onProjectSortOrderChange,
  codeEditorSettings,
  onCodeEditorWordWrapChange,
  onCodeEditorShowMinimapChange,
  onCodeEditorLineNumbersChange,
  onCodeEditorFontSizeChange,
}: AppearanceSettingsTabProps) {
  const { t } = useTranslation('settings');
  const { preferences, setPreference } = useUiPreferences();

  return (
    <div className="space-y-8">
      <SettingsSection title={t('appearanceSettings.darkMode.label')}>
        <SettingsCard>
          <SettingsRow
            label={t('appearanceSettings.darkMode.label')}
            description={t('appearanceSettings.darkMode.description')}
          >
            <DarkModeToggle ariaLabel={t('appearanceSettings.darkMode.label')} />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('mainTabs.appearance')}>
        <SettingsCard>
          <LanguageSelector />
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

      <SettingsSection title={t('appearanceSettings.projectSorting.label')}>
        <SettingsCard>
          <SettingsRow
            label={t('appearanceSettings.projectSorting.label')}
            description={t('appearanceSettings.projectSorting.description')}
          >
            <Select
              value={projectSortOrder}
              onValueChange={(value) => onProjectSortOrderChange(value as ProjectSortOrder)}
              className="w-full sm:w-44"
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">{t('appearanceSettings.projectSorting.alphabetical')}</SelectItem>
                <SelectItem value="date">{t('appearanceSettings.projectSorting.recentActivity')}</SelectItem>
              </SelectContent>
            </Select>
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
              className="w-full sm:w-28"
            >
              <SelectTrigger>
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
