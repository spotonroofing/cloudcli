import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

import { authenticatedFetch } from '../../../../utils/api';

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

  if (!settings) {
    return null;
  }

  return (
    <div className="space-y-3 border-t border-border/60 pt-4">
      <div className="flex items-center gap-2">
        <RefreshCw className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-medium text-foreground">Planner auto-rotation</h3>
        {saving && <span className="text-[10px] text-muted-foreground">saving...</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        When a planner session's context usage crosses the threshold, the watchdog has it run /handoff
        and boots a fresh planner from STATE.md. The percentage applies against the session model's
        real context window.
      </p>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(event) => {
            void save({ ...settings, enabled: event.target.checked });
          }}
          className="h-4 w-4"
        />
        Rotate planners automatically
      </label>
      <label className="flex items-center gap-2 text-sm text-foreground">
        Threshold
        <input
          type="number"
          min={5}
          max={95}
          value={settings.thresholdPercent}
          disabled={!settings.enabled}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
              void save({ ...settings, thresholdPercent: value });
            }
          }}
          className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm"
        />
        <span className="text-xs text-muted-foreground">% of the model's context window (default 60)</span>
      </label>
    </div>
  );
}
