import { writeSetting } from './cloudSettings';

const NOTIFICATION_SOUND_ENABLED_STORAGE_KEY = 'notificationSoundEnabled';
const COMPLETION_SOUND_STORAGE_KEYS = {
  planner: 'plannerCompletionSound',
  worker: 'workerCompletionSound',
} as const;

export type CompletionSoundRole = keyof typeof COMPLETION_SOUND_STORAGE_KEYS;
export type CompletionSoundId = 'soft-chime' | 'glass-ping' | 'warm-bloom' | 'clear-bell';

export const COMPLETION_SOUND_OPTIONS: ReadonlyArray<{ id: CompletionSoundId; label: string }> = [
  { id: 'soft-chime', label: 'Soft chime' },
  { id: 'glass-ping', label: 'Glass ping' },
  { id: 'warm-bloom', label: 'Warm bloom' },
  { id: 'clear-bell', label: 'Clear bell' },
];

const DEFAULT_COMPLETION_SOUNDS: Record<CompletionSoundRole, CompletionSoundId> = {
  planner: 'soft-chime',
  worker: 'glass-ping',
};

type Tone = {
  frequency: number;
  offset: number;
  duration: number;
  volume: number;
  wave?: OscillatorType;
};

const COMPLETION_TONES: Record<CompletionSoundId, Tone[]> = {
  'soft-chime': [
    { frequency: 659, offset: 0, duration: 0.11, volume: 0.05 },
    { frequency: 880, offset: 0.09, duration: 0.18, volume: 0.04 },
  ],
  'glass-ping': [
    { frequency: 1175, offset: 0, duration: 0.09, volume: 0.035, wave: 'triangle' },
    { frequency: 1568, offset: 0.055, duration: 0.13, volume: 0.025, wave: 'sine' },
  ],
  'warm-bloom': [
    { frequency: 392, offset: 0, duration: 0.16, volume: 0.045, wave: 'triangle' },
    { frequency: 523, offset: 0.08, duration: 0.2, volume: 0.04, wave: 'sine' },
    { frequency: 659, offset: 0.15, duration: 0.2, volume: 0.03, wave: 'sine' },
  ],
  'clear-bell': [
    { frequency: 784, offset: 0, duration: 0.12, volume: 0.045 },
    { frequency: 1319, offset: 0.04, duration: 0.19, volume: 0.03 },
  ],
};

const AudioContextConstructor =
  typeof window !== 'undefined'
    ? window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    : undefined;

let audioContext: AudioContext | null = null;

const isCompletionSoundId = (value: string | null): value is CompletionSoundId => (
  COMPLETION_SOUND_OPTIONS.some((option) => option.id === value)
);

export const isNotificationSoundEnabled = (): boolean => {
  if (typeof localStorage === 'undefined') {
    return true;
  }

  return localStorage.getItem(NOTIFICATION_SOUND_ENABLED_STORAGE_KEY) !== 'false';
};

export const setNotificationSoundEnabled = (enabled: boolean): void => {
  if (typeof localStorage === 'undefined') {
    return;
  }

  writeSetting(NOTIFICATION_SOUND_ENABLED_STORAGE_KEY, String(enabled));
};

export const getCompletionSound = (role: CompletionSoundRole): CompletionSoundId => {
  if (typeof localStorage === 'undefined') {
    return DEFAULT_COMPLETION_SOUNDS[role];
  }

  const stored = localStorage.getItem(COMPLETION_SOUND_STORAGE_KEYS[role]);
  return isCompletionSoundId(stored) ? stored : DEFAULT_COMPLETION_SOUNDS[role];
};

export const setCompletionSound = (role: CompletionSoundRole, sound: CompletionSoundId): void => {
  if (typeof localStorage === 'undefined' || !isCompletionSoundId(sound)) {
    return;
  }

  writeSetting(COMPLETION_SOUND_STORAGE_KEYS[role], sound);
};

export const completionSoundRoleFor = (
  sessionOrigin: string | null | undefined,
  paneOrigin: string | null | undefined,
): CompletionSoundRole => (
  sessionOrigin === 'planner' || paneOrigin === 'planner' ? 'planner' : 'worker'
);

const getAudioContext = (): AudioContext | null => {
  if (!AudioContextConstructor) {
    return null;
  }

  if (!audioContext) {
    audioContext = new AudioContextConstructor();
  }

  return audioContext;
};

const playTone = (context: AudioContext, tone: Tone, startsAt: number): void => {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = tone.wave ?? 'sine';
  oscillator.frequency.setValueAtTime(tone.frequency, startsAt);

  // Shape the volume so every synthesized tone starts and stops cleanly.
  gain.gain.setValueAtTime(0.0001, startsAt);
  gain.gain.exponentialRampToValueAtTime(tone.volume, startsAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + tone.duration);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startsAt);
  oscillator.stop(startsAt + tone.duration + 0.02);
};

const playTones = async (tones: Tone[], force: boolean): Promise<void> => {
  if (!force && !isNotificationSoundEnabled()) {
    return;
  }

  const context = getAudioContext();
  if (!context) {
    return;
  }

  try {
    if (context.state === 'suspended') {
      await context.resume();
    }

    const now = context.currentTime;
    tones.forEach((tone) => playTone(context, tone, now + tone.offset));
  } catch (error) {
    // Browsers may block audio until the page receives a user gesture.
    console.warn('Unable to play notification sound:', error);
  }
};

export const playNotificationSound = async ({ force = false } = {}): Promise<void> => playTones([
  { frequency: 740, offset: 0, duration: 0.1, volume: 0.055 },
  { frequency: 988, offset: 0.09, duration: 0.14, volume: 0.04 },
], force);

export const playCompletionSound = (
  role: CompletionSoundRole,
  { force = false, sound = getCompletionSound(role) }: { force?: boolean; sound?: CompletionSoundId } = {},
): Promise<void> => playTones(COMPLETION_TONES[sound], force);

/** Legacy completion entry point retained for consumers outside the pane-aware chat surface. */
export const playChatCompletionSound = ({ force = false } = {}): Promise<void> => (
  playCompletionSound('worker', { force })
);
