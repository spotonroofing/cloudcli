import { useEffect, useState } from 'react';

import LLMProviderLogo from '../../../llm-provider-logo/LLMProviderLogo';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../shared/view/beui/BeuiSelect';
import { Input, Skeleton } from '../../../../shared/view/ui';
import type { LLMProvider, ProviderModelsDefinition } from '../../../../types/app';
import { authenticatedFetch } from '../../../../utils/api';
import SettingsCard from '../SettingsCard';
import SettingsRow from '../SettingsRow';
import SettingsSection from '../SettingsSection';
import SettingsToggle from '../SettingsToggle';
import type { SettingsProject } from '../../types/types';

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

type UsageThresholdKey =
  | 'accountWarning'
  | 'accountUrgent'
  | 'fleetWarning'
  | 'fleetUrgent'
  | 'fleetSevenDay';

type UsageAlertSettings = {
  thresholds: Record<UsageThresholdKey, number>;
  defaults: Record<UsageThresholdKey, number>;
};

type ModelRole = 'planner' | 'worker';
type ModelSelection = { provider: LLMProvider; model: string; effort: string };
type ModelDefaults = { roles: Record<ModelRole, ModelSelection> };
type PlannerMcpSettings = {
  projectPath: string;
  enabled: string[];
  servers: string[];
  defaults: string[];
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

const usageThresholdRows: Array<{ key: UsageThresholdKey; label: string; description: string }> = [
  { key: 'accountWarning', label: 'Account warning', description: 'First per-account Claude 5h and ChatGPT window alert.' },
  { key: 'accountUrgent', label: 'Account urgent', description: 'Urgent per-account alert; exhaustion always alerts at 100%.' },
  { key: 'fleetWarning', label: 'Fleet warning', description: 'First fleet 5h and Fable aggregate alert.' },
  { key: 'fleetUrgent', label: 'Fleet urgent', description: 'Urgent fleet 5h and Fable aggregate alert.' },
  { key: 'fleetSevenDay', label: 'Fleet 7-day', description: 'Claude fleet 7-day aggregate alert.' },
];

/** Providers whose catalogs the Models section offers, in menu order. */
const MODEL_PROVIDERS: LLMProvider[] = ['claude', 'codex'];

const modelRoles: Array<{ key: ModelRole; label: string; description: string }> = [
  { key: 'planner', label: 'Planner sessions', description: 'Model and effort a new planner starts with when the project has no earlier planner.' },
  { key: 'worker', label: 'Direct worker sessions', description: 'Model and effort a new direct worker starts with when the project has no earlier worker.' },
];

const EFFORT_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra',
  max: 'Max',
  ultra: 'Ultra',
};

const effortLabelFor = (value: string): string => (
  EFFORT_LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1)
);

const modelKey = (provider: string, model: string): string => `${provider}:${model}`;

const projectPath = (project: SettingsProject): string => project.fullPath || project.path || '';

/** System tab: Willem-owned automation, planner MCP, and model defaults. */
export default function SystemSettingsTab({ projects = [] }: { projects?: SettingsProject[] }) {
  const [state, setState] = useState<WatchdogSettings | null>(null);
  const [saving, setSaving] = useState<Behavior | 'threshold' | `usage:${UsageThresholdKey}` | ModelRole | `mcp:${string}` | null>(null);
  const [thresholdDraft, setThresholdDraft] = useState('');
  const [usageAlerts, setUsageAlerts] = useState<UsageAlertSettings | null>(null);
  const [usageDrafts, setUsageDrafts] = useState<Partial<Record<UsageThresholdKey, string>>>({});
  const [models, setModels] = useState<ModelDefaults | null>(null);
  const [catalogs, setCatalogs] = useState<Partial<Record<LLMProvider, ProviderModelsDefinition>>>({});
  const [selectedMcpProject, setSelectedMcpProject] = useState(() => projectPath(projects[0] ?? {}));
  const [mcp, setMcp] = useState<PlannerMcpSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    void authenticatedFetch('/api/settings/watchdog')
      .then((response) => response.json())
      .then((body: WatchdogSettings) => {
        if (cancelled) return;
        setState(body);
        setThresholdDraft(String(body.plannerRotationThreshold));
      });
    void authenticatedFetch('/api/settings/models')
      .then((response) => response.json())
      .then((body: ModelDefaults) => {
        if (!cancelled) setModels(body);
      });
    void authenticatedFetch('/api/settings/usage-alerts')
      .then((response) => response.json())
      .then((body: UsageAlertSettings) => {
        if (cancelled) return;
        setUsageAlerts(body);
        setUsageDrafts(Object.fromEntries(
          (Object.keys(body.thresholds) as UsageThresholdKey[]).map((key) => [key, String(body.thresholds[key])]),
        ));
      });
    for (const provider of MODEL_PROVIDERS) {
      void authenticatedFetch(`/api/providers/${provider}/models`)
        .then((response) => response.json())
        .then((body: { data?: { models?: ProviderModelsDefinition } }) => {
          const catalog = body.data?.models;
          if (!cancelled && catalog) {
            setCatalogs((previous) => ({ ...previous, [provider]: catalog }));
          }
        });
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedMcpProject) {
      setMcp(null);
      return;
    }
    let cancelled = false;
    setMcp(null);
    void authenticatedFetch(`/api/settings/planner-mcp?projectPath=${encodeURIComponent(selectedMcpProject)}`)
      .then((response) => response.json())
      .then((body: PlannerMcpSettings) => {
        if (!cancelled) setMcp(body);
      });
    return () => { cancelled = true; };
  }, [selectedMcpProject]);

  const putWatchdog = async (
    key: Behavior | 'threshold',
    body: { settings?: Partial<Record<Behavior, boolean>>; plannerRotationThreshold?: number },
    optimistic: WatchdogSettings,
  ) => {
    const previous = state;
    setState(optimistic);
    setSaving(key);
    try {
      const response = await authenticatedFetch('/api/settings/watchdog', {
        method: 'PUT',
        body: JSON.stringify({ settings: {}, ...body }),
      });
      if (!response.ok) throw new Error('save failed');
      const saved = await response.json() as WatchdogSettings;
      setState(saved);
      setThresholdDraft(String(saved.plannerRotationThreshold));
    } catch {
      setState(previous);
      if (previous) setThresholdDraft(String(previous.plannerRotationThreshold));
    } finally {
      setSaving(null);
    }
  };

  const save = (key: Behavior, value: boolean) => {
    if (!state) return;
    void putWatchdog(key, { settings: { [key]: value } }, { ...state, settings: { ...state.settings, [key]: value } });
  };

  const commitThreshold = () => {
    if (!state) return;
    const next = Math.round(Number(thresholdDraft));
    if (!Number.isFinite(next) || next < 5 || next > 95) {
      setThresholdDraft(String(state.plannerRotationThreshold));
      return;
    }
    if (next === state.plannerRotationThreshold) return;
    void putWatchdog('threshold', { plannerRotationThreshold: next }, { ...state, plannerRotationThreshold: next });
  };

  const commitUsageThreshold = async (key: UsageThresholdKey) => {
    if (!usageAlerts) return;
    const next = Math.round(Number(usageDrafts[key]));
    if (!Number.isFinite(next) || next < 1 || next > 99 || next === usageAlerts.thresholds[key]) {
      setUsageDrafts((previous) => ({ ...previous, [key]: String(usageAlerts.thresholds[key]) }));
      return;
    }
    const previous = usageAlerts;
    const optimistic = { ...usageAlerts, thresholds: { ...usageAlerts.thresholds, [key]: next } };
    setUsageAlerts(optimistic);
    setSaving(`usage:${key}`);
    try {
      const response = await authenticatedFetch('/api/settings/usage-alerts', {
        method: 'PUT',
        body: JSON.stringify({ thresholds: { [key]: next } }),
      });
      if (!response.ok) throw new Error('save failed');
      const saved = await response.json() as UsageAlertSettings;
      setUsageAlerts(saved);
      setUsageDrafts(Object.fromEntries(
        (Object.keys(saved.thresholds) as UsageThresholdKey[]).map((thresholdKey) => [
          thresholdKey,
          String(saved.thresholds[thresholdKey]),
        ]),
      ));
    } catch {
      setUsageAlerts(previous);
      setUsageDrafts((current) => ({ ...current, [key]: String(previous.thresholds[key]) }));
    } finally {
      setSaving(null);
    }
  };

  const saveModel = async (role: ModelRole, selection: ModelSelection) => {
    if (!models) return;
    const previous = models;
    setModels({ ...models, roles: { ...models.roles, [role]: selection } });
    setSaving(role);
    try {
      const response = await authenticatedFetch('/api/settings/models', {
        method: 'PUT',
        body: JSON.stringify({ roles: { [role]: selection } }),
      });
      if (!response.ok) throw new Error('save failed');
      setModels(await response.json() as ModelDefaults);
    } catch {
      setModels(previous);
    } finally {
      setSaving(null);
    }
  };

  const saveMcpServer = async (server: string, enabled: boolean) => {
    if (!mcp) return;
    const previous = mcp;
    const nextEnabled = enabled
      ? [...new Set([...mcp.enabled, server])]
      : mcp.enabled.filter((candidate) => candidate !== server);
    setMcp({ ...mcp, enabled: nextEnabled });
    setSaving(`mcp:${server}`);
    try {
      const response = await authenticatedFetch('/api/settings/planner-mcp', {
        method: 'PUT',
        body: JSON.stringify({ projectPath: selectedMcpProject, enabled: nextEnabled }),
      });
      if (!response.ok) throw new Error('save failed');
      setMcp(await response.json() as PlannerMcpSettings);
    } catch {
      setMcp(previous);
    } finally {
      setSaving(null);
    }
  };

  const effortValuesFor = (selection: ModelSelection): string[] => {
    const option = catalogs[selection.provider]?.OPTIONS.find((candidate) => candidate.value === selection.model);
    return option?.effort?.values.map((value) => value.value) ?? [];
  };

  if (!state || !models || !usageAlerts) {
    return (
      <div className="space-y-5" aria-busy="true">
        {[0, 1, 2, 3].map((section) => (
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
              return (
                <SettingsRow
                  key={behavior.key}
                  label={behavior.label}
                  description={`${behavior.description} Default ${defaultLabel}.`}
                >
                  <SettingsToggle
                    checked={state.settings[behavior.key]}
                    onChange={(value) => { save(behavior.key, value); }}
                    ariaLabel={behavior.label}
                    disabled={saving === behavior.key}
                  />
                </SettingsRow>
              );
            })}
            {section === 'Sessions' && (
              <SettingsRow
                label="Rotation threshold"
                description="Context usage that triggers the handoff, as a percent of the model's window."
              >
                <Input
                  type="number"
                  inputMode="numeric"
                  min={5}
                  max={95}
                  aria-label="Rotation threshold"
                  className="h-7 w-16 px-2 text-xs md:text-xs"
                  value={thresholdDraft}
                  disabled={saving === 'threshold'}
                  onChange={(event) => setThresholdDraft(event.target.value)}
                  onBlur={commitThreshold}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
              </SettingsRow>
            )}
          </SettingsCard>
        </SettingsSection>
      ))}
      <SettingsSection title="Usage alerts">
        <SettingsCard divided>
          {usageThresholdRows.map((row) => (
            <SettingsRow
              key={row.key}
              label={row.label}
              description={`${row.description} Default ${usageAlerts.defaults[row.key]}%.`}
            >
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={99}
                aria-label={row.label}
                className="h-7 w-16 px-2 text-xs md:text-xs"
                value={usageDrafts[row.key] ?? String(usageAlerts.thresholds[row.key])}
                disabled={saving === `usage:${row.key}`}
                onChange={(event) => setUsageDrafts((previous) => ({ ...previous, [row.key]: event.target.value }))}
                onBlur={() => { void commitUsageThreshold(row.key); }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
            </SettingsRow>
          ))}
        </SettingsCard>
      </SettingsSection>
      {projects.length > 0 && (
        <SettingsSection title="Planner MCP">
          <SettingsCard divided>
            {projects.length > 1 && (
              <SettingsRow label="Project" description="MCP access is stored separately for each project.">
                <Select value={selectedMcpProject} onValueChange={setSelectedMcpProject} className="w-40">
                  <SelectTrigger className="h-7 px-2 py-0 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={projectPath(project)} value={projectPath(project)}>
                        {project.displayName || project.name || projectPath(project)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingsRow>
            )}
            {mcp ? mcp.servers.map((server) => (
              <SettingsRow
                key={server}
                label={server}
                description={`Available to planner turns for this project. Default ${mcp.defaults.includes(server) ? 'on' : 'off'}.`}
              >
                <SettingsToggle
                  checked={mcp.enabled.includes(server)}
                  onChange={(enabled) => { void saveMcpServer(server, enabled); }}
                  ariaLabel={`${server} planner MCP access`}
                  disabled={saving === `mcp:${server}`}
                />
              </SettingsRow>
            )) : (
              <SettingsRow label="Planner tools" description="Loading project MCP access…">
                <Skeleton className="h-5 w-9 rounded-full" />
              </SettingsRow>
            )}
          </SettingsCard>
        </SettingsSection>
      )}
      <SettingsSection title="Models">
        <SettingsCard divided>
          {modelRoles.map((role) => {
            const selection = models.roles[role.key];
            const efforts = effortValuesFor(selection);
            return (
              <SettingsRow key={role.key} label={role.label} description={role.description}>
                <div className="flex items-center gap-1.5" data-slot="model-default-pickers">
                  <Select
                    value={modelKey(selection.provider, selection.model)}
                    onValueChange={(value) => {
                      const [provider, ...rest] = value.split(':');
                      const model = rest.join(':');
                      const next = { provider: provider as LLMProvider, model };
                      const option = catalogs[next.provider]?.OPTIONS.find((candidate) => candidate.value === model);
                      const allowed = option?.effort?.values.map((entry) => entry.value) ?? [];
                      const effort = allowed.includes(selection.effort)
                        ? selection.effort
                        : option?.effort?.default ?? selection.effort;
                      void saveModel(role.key, { ...next, effort });
                    }}
                    disabled={saving === role.key}
                    className="w-40"
                  >
                    <SelectTrigger className="h-7 px-2 py-0 text-xs">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <LLMProviderLogo provider={selection.provider} className="h-3.5 w-3.5 shrink-0 opacity-60" />
                        <SelectValue />
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {MODEL_PROVIDERS.flatMap((provider) => (catalogs[provider]?.OPTIONS ?? []).map((option) => (
                        <SelectItem
                          key={modelKey(provider, option.value)}
                          value={modelKey(provider, option.value)}
                          textValue={option.label}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <LLMProviderLogo provider={provider} className="h-3.5 w-3.5 shrink-0 opacity-60" />
                            <span className="truncate">{option.label}</span>
                          </span>
                        </SelectItem>
                      )))}
                      {!MODEL_PROVIDERS.some((provider) => catalogs[provider]) && (
                        <SelectItem value={modelKey(selection.provider, selection.model)} textValue={selection.model}>
                          {selection.model}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <Select
                    value={selection.effort}
                    onValueChange={(effort) => { void saveModel(role.key, { ...selection, effort }); }}
                    disabled={saving === role.key || efforts.length === 0}
                    className="w-24"
                  >
                    <SelectTrigger className="h-7 px-2 py-0 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(efforts.length ? efforts : [selection.effort]).map((effort) => (
                        <SelectItem key={effort} value={effort} textValue={effortLabelFor(effort)}>
                          {effortLabelFor(effort)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </SettingsRow>
            );
          })}
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
