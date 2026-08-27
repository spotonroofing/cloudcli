import { useEffect, useState } from 'react';

import { Skeleton } from '../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../utils/api';
import SettingsCard from '../SettingsCard';
import SettingsRow from '../SettingsRow';
import SettingsSection from '../SettingsSection';
import SettingsToggle from '../SettingsToggle';

type Behavior =
  | 'plannerRotation'
  | 'terminalWakes'
  | 'livenessSweep'
  | 'dispatchRunLiveness'
  | 'resourceAlerts'
  | 'weeklySelfTest'
  | 'weeklyMaintenance'
  | 'handoffAutomation'
  | 'punchlistWatching'
  | 'recoveryNotices';

type WatchdogSettings = {
  settings: Record<Behavior, boolean>;
  defaults: Record<Behavior, boolean>;
  plannerRotationThreshold: number;
};

const behaviors: Array<{
  key: Behavior;
  label: string;
  description: string;
  section: 'Sessions' | 'Dispatch' | 'Machine';
}> = [
  { key: 'plannerRotation', label: 'Planner auto-rotation', description: 'Runs a handoff and boots a new planner at the context threshold.', section: 'Sessions' },
  { key: 'terminalWakes', label: 'Terminal planner wakes', description: 'Wakes a planner after a dispatched chain completes, stops, or fails.', section: 'Sessions' },
  { key: 'handoffAutomation', label: 'Handoff follow-through', description: 'Checks the handoff push and boots the replacement planner.', section: 'Sessions' },
  { key: 'livenessSweep', label: 'Chain liveness sweep', description: 'Stops chains whose runner vanished or stayed silent past the wedge limit.', section: 'Dispatch' },
  { key: 'dispatchRunLiveness', label: 'Run silence checks', description: 'Raises a decision notice when a dispatched session is silent for 30 minutes.', section: 'Dispatch' },
  { key: 'punchlistWatching', label: 'Live punch-list progress', description: 'Watches active punch lists and refreshes checked task counts.', section: 'Dispatch' },
  { key: 'recoveryNotices', label: 'Recovery notices', description: 'Posts notifications and system rows for limit recovery, switches, and parking.', section: 'Dispatch' },
  { key: 'resourceAlerts', label: 'Resource alerts', description: 'Checks disk and memory pressure and reports threshold crossings.', section: 'Machine' },
  { key: 'weeklySelfTest', label: 'Weekly push self-test', description: 'Sends the Monday notification delivery self-test.', section: 'Machine' },
  { key: 'weeklyMaintenance', label: 'Weekly maintenance run', description: 'Spawns the Monday CloudCLI maintenance session.', section: 'Machine' },
];

/** System tab: Willem-owned switches for every automatic watchdog behavior. */
export default function SystemSettingsTab() {
  const [state, setState] = useState<WatchdogSettings | null>(null);
  const [saving, setSaving] = useState<Behavior | null>(null);

  useEffect(() => {
    let cancelled = false;
    void authenticatedFetch('/api/settings/watchdog')
      .then((response) => response.json())
      .then((body: WatchdogSettings) => {
        if (!cancelled) setState(body);
      });
    return () => { cancelled = true; };
  }, []);

  const save = async (key: Behavior, value: boolean) => {
    if (!state) return;
    const previous = state;
    const next = { ...state, settings: { ...state.settings, [key]: value } };
    setState(next);
    setSaving(key);
    try {
      const response = await authenticatedFetch('/api/settings/watchdog', {
        method: 'PUT',
        body: JSON.stringify({ settings: { [key]: value } }),
      });
      setState(await response.json() as WatchdogSettings);
    } catch {
      setState(previous);
    } finally {
      setSaving(null);
    }
  };

  if (!state) {
    return (
      <div className="space-y-5" aria-busy="true">
        {[0, 1, 2].map((section) => (
          <div key={section} className="space-y-1.5">
            <Skeleton className="ml-1 h-3 w-24 rounded-sm" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {(['Sessions', 'Dispatch', 'Machine'] as const).map((section) => (
        <SettingsSection key={section} title={section}>
          <SettingsCard divided>
            {behaviors.filter((behavior) => behavior.section === section).map((behavior) => {
              const defaultLabel = state.defaults[behavior.key] ? 'on' : 'off';
              const threshold = behavior.key === 'plannerRotation'
                ? ` Threshold ${state.plannerRotationThreshold}%.`
                : '';
              return (
                <SettingsRow
                  key={behavior.key}
                  label={behavior.label}
                  description={`${behavior.description}${threshold} Default ${defaultLabel}.`}
                >
                  <SettingsToggle
                    checked={state.settings[behavior.key]}
                    onChange={(value) => { void save(behavior.key, value); }}
                    ariaLabel={behavior.label}
                    disabled={saving === behavior.key}
                  />
                </SettingsRow>
              );
            })}
          </SettingsCard>
        </SettingsSection>
      ))}
    </div>
  );
}
