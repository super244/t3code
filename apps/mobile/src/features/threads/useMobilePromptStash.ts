/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=10m; seat=codex; date=2026-10-03 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=5m; seat=antigravity; date=2026-10-02 */
import { useAtomValue } from "@effect/atom-react";
import {
  CURATED_PROMPT_PRESETS,
  filterPromptPresets,
  type PromptPresetCategory,
} from "@t3tools/client-runtime/promptPresets";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useMemo } from "react";

import type { MobileStashedPrompt } from "../../persistence/mobile-preferences";
import { mobilePreferencesAtom, transformMobilePreferencesCommand } from "../../state/preferences";

import { useAtomCommand } from "../../state/use-atom-command";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { uuidv4 } from "../../lib/uuid";

export const MAX_MOBILE_STASH_ENTRIES = 30;

export function useMobilePromptStash() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const transformPreferences = useAtomCommand(transformMobilePreferencesCommand, {
    reportFailure: false,
  });

  const stashedPrompts = useMemo<ReadonlyArray<MobileStashedPrompt>>(() => {
    if (!AsyncResult.isSuccess(preferences)) return [];
    return preferences.value.stashedPrompts ?? [];
  }, [preferences]);

  const stashPrompt = useCallback(
    async (promptText: string, title?: string): Promise<boolean> => {
      const trimmed = promptText.trim();
      if (!trimmed) return false;

      const newEntry: MobileStashedPrompt = {
        id: uuidv4(),
        prompt: trimmed,
        createdAt: new Date().toISOString(),
        ...(title?.trim() ? { title: title.trim() } : {}),
      };

      const result = await transformPreferences((current) => ({
        stashedPrompts: [
          newEntry,
          ...(current.stashedPrompts ?? []).filter((item) => item.prompt !== trimmed),
        ].slice(0, MAX_MOBILE_STASH_ENTRIES),
      }));
      if (!AsyncResult.isSuccess(result)) throw squashAtomCommandFailure(result);
      return true;
    },
    [transformPreferences],
  );

  const deleteStash = useCallback(
    async (id: string) => {
      const result = await transformPreferences((current) => ({
        stashedPrompts: (current.stashedPrompts ?? []).filter((item) => item.id !== id),
      }));
      if (!AsyncResult.isSuccess(result)) throw squashAtomCommandFailure(result);
    },
    [transformPreferences],
  );

  const clearAllStashes = useCallback(async () => {
    const result = await transformPreferences(() => ({ stashedPrompts: [] }));
    if (!AsyncResult.isSuccess(result)) throw squashAtomCommandFailure(result);
  }, [transformPreferences]);

  const getFilteredPresets = useCallback(
    (options: { readonly category?: PromptPresetCategory | "all"; readonly query?: string }) => {
      return filterPromptPresets(CURATED_PROMPT_PRESETS, options);
    },
    [],
  );

  return {
    stashedPrompts,
    stashCount: stashedPrompts.length,
    stashPrompt,
    deleteStash,
    clearAllStashes,
    curatedPresets: CURATED_PROMPT_PRESETS,
    getFilteredPresets,
  };
}
