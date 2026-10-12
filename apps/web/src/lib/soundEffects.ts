/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=7m; seat=codex; date=2026-10-03 */
import * as Schema from "effect/Schema";
import { getSoundRecipe, type SoundCue, type TonePartial } from "@t3tools/shared/soundDesign";

export const SoundSettingsSchema = Schema.Struct({
  enabled: Schema.Boolean,
  volume: Schema.Finite,
  pack: Schema.Literals(["prism-harmonic", "minimal-pure", "mechanical-click", "off"]),
});

export type SoundSettings = typeof SoundSettingsSchema.Type;
const decodeSoundSettings = Schema.decodeUnknownSync(SoundSettingsSchema);

export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  enabled: true,
  volume: 45,
  pack: "prism-harmonic",
};

let sharedAudioContext: AudioContext | null = null;

export function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    try {
      sharedAudioContext = new AudioCtx();
    } catch {
      return null;
    }
  }
  return sharedAudioContext;
}

export function playPartial(
  ctx: AudioContext,
  masterGain: GainNode,
  partial: TonePartial,
  baseTime: number,
  onEnded: () => void = () => {},
): () => void {
  const osc = ctx.createOscillator();
  let gain: GainNode;
  try {
    gain = ctx.createGain();
  } catch (cause) {
    osc.disconnect();
    throw cause;
  }

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    osc.removeEventListener("ended", finish);
    osc.disconnect();
    gain.disconnect();
    onEnded();
  };
  osc.addEventListener("ended", finish, { once: true });
  try {
    osc.type = "sine";
    osc.frequency.setValueAtTime(partial.frequency, baseTime);

    const onset = baseTime + (partial.delay ?? 0);
    const attack = Math.max(partial.attack ?? 0.005, 0.002);
    const decay = Math.max(partial.decay, 0.01);
    const peakAmp = Math.max(partial.amplitude, 0.0001);

    gain.gain.setValueAtTime(0.00001, onset);
    gain.gain.exponentialRampToValueAtTime(peakAmp, onset + attack);
    gain.gain.exponentialRampToValueAtTime(0.00001, onset + attack + decay * 3.5);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start(onset);
    osc.stop(onset + attack + decay * 3.5 + 0.05);
  } catch (cause) {
    finish();
    throw cause;
  }
  return () => {
    try {
      osc.stop();
    } catch {
      /* Already stopped. */
    }
    finish();
  };
}

const SETTINGS_KEY = "t3-sound-settings";
const listeners = new Set<() => void>();
let currentSettings: SoundSettings | null = null;
let sessionOnlySettings = false;

function normalizeSettings(settings: SoundSettings): SoundSettings {
  return { ...settings, volume: Math.max(0, Math.min(100, settings.volume)) };
}

function loadStoredSoundSettings(): SoundSettings {
  if (typeof window === "undefined") return DEFAULT_SOUND_SETTINGS;
  const raw = window.localStorage.getItem(SETTINGS_KEY);
  if (!raw) return DEFAULT_SOUND_SETTINGS;
  return normalizeSettings(decodeSoundSettings(JSON.parse(raw)));
}
export function readStoredSoundSettings(): SoundSettings {
  try {
    return loadStoredSoundSettings();
  } catch {
    return DEFAULT_SOUND_SETTINGS;
  }
}

export function getSoundSettingsSnapshot(): SoundSettings {
  return (currentSettings ??= readStoredSoundSettings());
}
function publish(settings: SoundSettings): void {
  const previous = getSoundSettingsSnapshot();
  if (
    previous.enabled === settings.enabled &&
    previous.volume === settings.volume &&
    previous.pack === settings.pack
  )
    return;
  currentSettings = settings;
  for (const listener of listeners) listener();
}
function onStorage(event: StorageEvent): void {
  if (event.key === SETTINGS_KEY || event.key === null) {
    sessionOnlySettings = false;
    publish(readStoredSoundSettings());
  }
}
export function subscribeSoundSettings(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== "undefined") {
    if (!sessionOnlySettings) {
      try {
        publish(loadStoredSoundSettings());
      } catch {
        /* Preserve this session's controls. */
      }
    }
    window.addEventListener("storage", onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined")
      window.removeEventListener("storage", onStorage);
  };
}
export function writeStoredSoundSettings(settings: SoundSettings): void {
  const normalized = normalizeSettings(decodeSoundSettings(settings));
  // Keep controls and playback synchronized even when persistence is unavailable.
  publish(normalized);
  try {
    if (typeof window !== "undefined")
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
    sessionOnlySettings = false;
  } catch {
    sessionOnlySettings = true;
  }
}
export function updateSoundSettings(next: Partial<SoundSettings>): void {
  writeStoredSoundSettings({ ...getSoundSettingsSnapshot(), ...next });
}

let activeCues = 0;
const MAX_ACTIVE_CUES = 8;
export function playSound(cue: SoundCue, customSettings?: SoundSettings): boolean {
  const settings = customSettings ?? getSoundSettingsSnapshot();
  if (
    !settings.enabled ||
    settings.pack === "off" ||
    !Number.isFinite(settings.volume) ||
    settings.volume <= 0
  )
    return false;
  const recipe = getSoundRecipe(settings.pack, cue);
  if (!recipe || recipe.partials.length === 0 || activeCues >= MAX_ACTIVE_CUES) return false;
  const ctx = getAudioContext();
  if (!ctx) return false;

  const schedule = (): boolean => {
    if (ctx.state !== "running" || activeCues >= MAX_ACTIVE_CUES) return false;
    const masterGain = ctx.createGain();
    const cancels: Array<() => void> = [];
    let remaining = recipe.partials.length;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      masterGain.disconnect();
      activeCues -= 1;
    };
    activeCues += 1;
    try {
      masterGain.gain.setValueAtTime(
        (Math.max(0, Math.min(100, settings.volume)) / 100) * 0.7,
        ctx.currentTime,
      );
      masterGain.connect(ctx.destination);
      const now = ctx.currentTime;
      for (const partial of recipe.partials) {
        cancels.push(
          playPartial(ctx, masterGain, partial, now, () => {
            remaining -= 1;
            if (remaining === 0) finish();
          }),
        );
      }
      return true;
    } catch {
      for (const cancel of cancels) cancel();
      finish();
      return false;
    }
  };
  try {
    if (ctx.state === "suspended") {
      // Autoplay denial must not become an unhandled promise rejection.
      void ctx
        .resume()
        .then(schedule)
        .catch(() => {});
      return true;
    }
    return schedule();
  } catch {
    return false;
  }
}
