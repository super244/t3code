/**
 * Pure mathematical recipes for synthesized harmonic sound cues,
 * modeled after Prism's ToneSynthesis architecture.
 *
 * All cues are pure sine partials with raised-cosine attacks and
 * exponential decays, requiring zero external audio assets.
 */

export type SoundCue =
  | "turn-started"
  | "turn-completed"
  | "approval-requested"
  | "action-error"
  | "theme-switched"
  | "mission-launched";

export type SoundPack = "prism-harmonic" | "minimal-pure" | "mechanical-click" | "off";

export interface TonePartial {
  readonly frequency: number;
  readonly amplitude: number;
  readonly decay: number; // e-folding decay time in seconds
  readonly delay?: number; // onset offset in seconds
  readonly attack?: number; // raised cosine attack in seconds
}

export interface SoundRecipe {
  readonly cue: SoundCue;
  readonly label: string;
  readonly partials: ReadonlyArray<TonePartial>;
}

export const PRISM_HARMONIC_RECIPES: Record<SoundCue, SoundRecipe> = {
  "turn-started": {
    cue: "turn-started",
    label: "Turn Started",
    partials: [
      { frequency: 523.25, amplitude: 0.18, decay: 0.25, attack: 0.008, delay: 0 },
      { frequency: 783.99, amplitude: 0.14, decay: 0.35, attack: 0.008, delay: 0.045 },
    ],
  },
  "turn-completed": {
    cue: "turn-completed",
    label: "Turn Completed",
    partials: [
      { frequency: 523.25, amplitude: 0.2, decay: 0.4, attack: 0.008, delay: 0 },
      { frequency: 659.25, amplitude: 0.2, decay: 0.45, attack: 0.008, delay: 0.04 },
      { frequency: 783.99, amplitude: 0.22, decay: 0.5, attack: 0.008, delay: 0.08 },
      { frequency: 1046.5, amplitude: 0.25, decay: 0.7, attack: 0.008, delay: 0.12 },
      // Inharmonic struck shimmer at 2.7x
      { frequency: 1046.5 * 2.71, amplitude: 0.04, decay: 0.18, attack: 0.004, delay: 0.12 },
    ],
  },
  "approval-requested": {
    cue: "approval-requested",
    label: "Approval Needed",
    partials: [
      { frequency: 880.0, amplitude: 0.22, decay: 0.28, attack: 0.006, delay: 0 },
      { frequency: 1318.51, amplitude: 0.24, decay: 0.42, attack: 0.006, delay: 0.06 },
      { frequency: 1318.51 * 2.71, amplitude: 0.05, decay: 0.15, attack: 0.004, delay: 0.06 },
    ],
  },
  "action-error": {
    cue: "action-error",
    label: "Action Error",
    partials: [
      { frequency: 293.66, amplitude: 0.22, decay: 0.2, attack: 0.01, delay: 0 },
      { frequency: 220.0, amplitude: 0.26, decay: 0.35, attack: 0.01, delay: 0.08 },
    ],
  },
  "theme-switched": {
    cue: "theme-switched",
    label: "Theme Switched",
    partials: [
      { frequency: 1200.0, amplitude: 0.12, decay: 0.02, attack: 0.002, delay: 0 },
      { frequency: 2400.0, amplitude: 0.04, decay: 0.01, attack: 0.002, delay: 0.003 },
    ],
  },
  "mission-launched": {
    cue: "mission-launched",
    label: "Mission Launched",
    partials: [
      { frequency: 440.0, amplitude: 0.15, decay: 0.3, attack: 0.008, delay: 0 },
      { frequency: 554.37, amplitude: 0.18, decay: 0.35, attack: 0.008, delay: 0.05 },
      { frequency: 659.25, amplitude: 0.2, decay: 0.4, attack: 0.008, delay: 0.1 },
      { frequency: 880.0, amplitude: 0.22, decay: 0.55, attack: 0.008, delay: 0.15 },
    ],
  },
};

export const MINIMAL_PURE_RECIPES: Record<SoundCue, SoundRecipe> = {
  "turn-started": {
    cue: "turn-started",
    label: "Turn Started",
    partials: [{ frequency: 600, amplitude: 0.12, decay: 0.15, attack: 0.005, delay: 0 }],
  },
  "turn-completed": {
    cue: "turn-completed",
    label: "Turn Completed",
    partials: [
      { frequency: 800, amplitude: 0.15, decay: 0.2, attack: 0.005, delay: 0 },
      { frequency: 1200, amplitude: 0.18, decay: 0.3, attack: 0.005, delay: 0.05 },
    ],
  },
  "approval-requested": {
    cue: "approval-requested",
    label: "Approval Needed",
    partials: [
      { frequency: 1000, amplitude: 0.2, decay: 0.2, attack: 0.005, delay: 0 },
      { frequency: 1000, amplitude: 0.2, decay: 0.25, attack: 0.005, delay: 0.08 },
    ],
  },
  "action-error": {
    cue: "action-error",
    label: "Action Error",
    partials: [{ frequency: 250, amplitude: 0.2, decay: 0.2, attack: 0.005, delay: 0 }],
  },
  "theme-switched": {
    cue: "theme-switched",
    label: "Theme Switched",
    partials: [{ frequency: 1400, amplitude: 0.08, decay: 0.015, attack: 0.002, delay: 0 }],
  },
  "mission-launched": {
    cue: "mission-launched",
    label: "Mission Launched",
    partials: [
      { frequency: 500, amplitude: 0.15, decay: 0.2, attack: 0.005, delay: 0 },
      { frequency: 1000, amplitude: 0.18, decay: 0.3, attack: 0.005, delay: 0.07 },
    ],
  },
};

export const MECHANICAL_CLICK_RECIPES: Record<SoundCue, SoundRecipe> = {
  "turn-started": {
    cue: "turn-started",
    label: "Turn Started",
    partials: [
      { frequency: 1800, amplitude: 0.2, decay: 0.015, attack: 0.001, delay: 0 },
      { frequency: 2400, amplitude: 0.15, decay: 0.012, attack: 0.001, delay: 0.02 },
    ],
  },
  "turn-completed": {
    cue: "turn-completed",
    label: "Turn Completed",
    partials: [
      { frequency: 1200, amplitude: 0.2, decay: 0.02, attack: 0.001, delay: 0 },
      { frequency: 2400, amplitude: 0.22, decay: 0.03, attack: 0.001, delay: 0.03 },
      { frequency: 3600, amplitude: 0.12, decay: 0.02, attack: 0.001, delay: 0.06 },
    ],
  },
  "approval-requested": {
    cue: "approval-requested",
    label: "Approval Needed",
    partials: [
      { frequency: 2800, amplitude: 0.25, decay: 0.02, attack: 0.001, delay: 0 },
      { frequency: 2800, amplitude: 0.25, decay: 0.025, attack: 0.001, delay: 0.07 },
    ],
  },
  "action-error": {
    cue: "action-error",
    label: "Action Error",
    partials: [
      { frequency: 400, amplitude: 0.25, decay: 0.05, attack: 0.002, delay: 0 },
      { frequency: 300, amplitude: 0.2, decay: 0.06, attack: 0.002, delay: 0.04 },
    ],
  },
  "theme-switched": {
    cue: "theme-switched",
    label: "Theme Switched",
    partials: [{ frequency: 2200, amplitude: 0.15, decay: 0.01, attack: 0.001, delay: 0 }],
  },
  "mission-launched": {
    cue: "mission-launched",
    label: "Mission Launched",
    partials: [
      { frequency: 1500, amplitude: 0.2, decay: 0.018, attack: 0.001, delay: 0 },
      { frequency: 3000, amplitude: 0.2, decay: 0.025, attack: 0.001, delay: 0.04 },
    ],
  },
};

export function getSoundRecipe(pack: SoundPack, cue: SoundCue): SoundRecipe | null {
  if (pack === "off") return null;
  switch (pack) {
    case "prism-harmonic":
      return PRISM_HARMONIC_RECIPES[cue];
    case "minimal-pure":
      return MINIMAL_PURE_RECIPES[cue];
    case "mechanical-click":
      return MECHANICAL_CLICK_RECIPES[cue];
  }
}
