import { describe, expect, it } from "vite-plus/test";
import {
  getSoundRecipe,
  PRISM_HARMONIC_RECIPES,
  type SoundCue,
  type TonePartial,
} from "./soundDesign.js";

describe("soundDesign", () => {
  const cues: SoundCue[] = [
    "turn-started",
    "turn-completed",
    "approval-requested",
    "action-error",
    "theme-switched",
    "mission-launched",
  ];

  it("returns null for sound pack 'off'", () => {
    for (const cue of cues) {
      expect(getSoundRecipe("off", cue)).toBeNull();
    }
  });

  it("provides valid recipes with partials for all cues in prism-harmonic", () => {
    for (const cue of cues) {
      const recipe = getSoundRecipe("prism-harmonic", cue);
      expect(recipe).not.toBeNull();
      expect(recipe?.partials.length).toBeGreaterThan(0);
      for (const partial of recipe!.partials) {
        expect(partial.frequency).toBeGreaterThan(20);
        expect(partial.frequency).toBeLessThan(20000);
        expect(partial.amplitude).toBeGreaterThan(0);
        expect(partial.decay).toBeGreaterThan(0);
      }
    }
  });

  it("verifies turn-completed includes inharmonic overtone for chime richness", () => {
    const recipe = PRISM_HARMONIC_RECIPES["turn-completed"];
    const hasInharmonic = recipe.partials.some((p: TonePartial) => p.frequency > 2000);
    expect(hasInharmonic).toBe(true);
  });
});
