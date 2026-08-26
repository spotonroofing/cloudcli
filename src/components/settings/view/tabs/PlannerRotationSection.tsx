import { useEffect, useState } from 'react';

import { authenticatedFetch } from '../../../../utils/api';
import { Skeleton } from '../../../../shared/view/ui';
import SettingsCard from '../SettingsCard';
import SettingsRow from '../SettingsRow';
import SettingsSection from '../SettingsSection';
import SettingsToggle from '../SettingsToggle';

type RotationSettings = {
  enabled: boolean;
  thresholdPercent: number;
};

/**
 * Planner auto-rotation controls (spec B7): the watchdog runs /handoff on a
 * planner session when its context usage crosses the threshold, then boots a
 * fresh planner from STATE.md. Self-contained: reads and writes its own API.
 */
export default function PlannerRotationSection() {
  const [settings, setSettings] = useState<RotationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await authenticatedFetch('/api/settings/planner-rotation');
        if (!response.ok) {
          return;
        }
        const body = (await response.json()) as RotationSettings & { success?: boolean };
        if (!cancelled) {
          setSettings({ enabled: body.enabled, thresholdPercent: body.thresholdPercent });
        }
      } catch {
        // section stays hidden on load failure
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (next: RotationSettings) => {
    setSettings(next);
    setSaving(true);
    try {
      await authenticatedFetch('/api/settings/planner-rotation', {
        method: 'PUT',
        body: JSON.stringify(next),
      });
    } catch {
      // the watchdog keeps its last stored values on failure
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    // Section content still arriving: skeleton rows hold its space instead of
    // the section blinking in after the fetch (ui11 phase 11).
    return (
      <div className="space-y-1.5" aria-busy="true">
        <Skeleton className="ml-1 h-3 w-32 rounded-sm" />
        <div className="space-y-2 rounded-lg border border-border/60 px-3 py-2">
          <Skeleton className="h-4 w-3/5 rounded-sm" />
          <Skeleton className="h-4 w-2/5 rounded-sm" />
        </div>
      </div>
    );
  }

  if (!settings) {
    return null;
  }

  return (
    <SettingsSection title="Planner auto-rotation">
      <SettingsCard divided>
        <SettingsRow
          label="Rotate planners automatically"
          description="Runs /handoff at the threshold and boots a fresh planner from STATE.md."
        >
          <div className="flex items-center gap-2">
            {saving && <span className="text-[10px] text-muted-foreground">saving...</span>}
            <SettingsToggle
              checked={settings.enabled}
              onChange={(value) => {
                void save({ ...settings, enabled: value });
              }}
              ariaLabel="Rotate planners automatically"
            />
          </div>
        </SettingsRow>
        <SettingsRow label="Threshold" description="% of the model's context window (default 60)">
          <input
            type="number"
            min={5}
            max={95}
            value={settings.thresholdPercent}
            disabled={!settings.enabled}
            aria-label="Threshold"
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) {
                void save({ ...settings, thresholdPercent: value });
              }
            }}
            className="h-7 w-16 rounded-md border border-input bg-background px-2 text-xs tabular-nums text-foreground disabled:opacity-50"
          />
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}
