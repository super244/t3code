/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=7m; seat=codex; date=2026-10-03 */
import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_SOUND_SETTINGS,
  getSoundSettingsSnapshot,
  subscribeSoundSettings,
  playSound,
  updateSoundSettings,
} from "../lib/soundEffects";
import type { SoundCue } from "@t3tools/shared/soundDesign";

export function useSoundEffects() {
  const settings = useSyncExternalStore(
    subscribeSoundSettings,
    getSoundSettingsSnapshot,
    () => DEFAULT_SOUND_SETTINGS,
  );
  const play = useCallback((cue: SoundCue) => playSound(cue), []);
  const testCue = useCallback((cue: SoundCue) => {
    return playSound(cue, { ...getSoundSettingsSnapshot(), enabled: true });
  }, []);
  return { settings, updateSettings: updateSoundSettings, play, testCue };
}
