import type { ThemeColors, ThemeDefinition } from "./themePalettes.ts";

export type PrismThemeDefinition = ThemeDefinition;

interface PrismThemeSpec {
  readonly id: string;
  readonly label: string;
  readonly appearance: "light" | "dark";
  readonly canvas: string;
  readonly surface: string;
  readonly surfaceRaised: string;
  readonly accent: string;
  readonly secondary: string;
  readonly text: string;
  readonly textMuted: string;
  readonly border?: string;
  readonly error?: string;
  readonly warning?: string;
  readonly terminalBg?: string;
}

function makePrismTheme(spec: PrismThemeSpec): ThemeDefinition {
  const isDark = spec.appearance === "dark";
  const border = spec.border ?? (isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.12)");
  const error = spec.error ?? (isDark ? "#ff453a" : "#dc2626");
  const errorForeground = isDark ? "#ff857f" : "#991b1b";
  const errorSurface = isDark ? "#281216" : "#fee2e2";
  const warning = spec.warning ?? (isDark ? "#ff9f0a" : "#d97706");
  const warningForeground = isDark ? "#ffc066" : "#92400e";
  const warningSurface = isDark ? "#2c1e08" : "#fef3c7";
  const accentForeground = isDark ? "#06090e" : "#ffffff";
  const secondaryForeground = spec.text;
  const terminalBg = spec.terminalBg ?? spec.canvas;

  const colors: ThemeColors = {
    canvas: spec.canvas,
    chrome: spec.canvas,
    toolbar: spec.canvas,
    toolbarForeground: spec.text,
    toolbarBorder: border,
    toolbarControl: spec.surface,
    toolbarControlForeground: spec.text,
    toolbarControlHover: spec.surfaceRaised,
    surface: spec.surface,
    surfaceRaised: spec.surfaceRaised,
    surfaceOverlay: isDark ? "#06090e" : "#ffffff",
    text: spec.text,
    textMuted: spec.textMuted,
    border,
    input: spec.surfaceRaised,
    focus: spec.accent,
    accent: spec.accent,
    accentForeground,
    secondary: spec.secondary,
    secondaryForeground,
    muted: spec.surface,
    mutedForeground: spec.textMuted,
    placeholder: spec.textMuted,
    secondaryLabel: spec.textMuted,
    iconMuted: spec.textMuted,
    error,
    errorForeground,
    errorSurface,
    warning,
    warningForeground,
    warningSurface,
    update: spec.accent,
    updateForeground: accentForeground,
    updateSurface: isDark ? spec.surfaceRaised : spec.surface,
    accentSurface: isDark ? spec.surfaceRaised : spec.surface,
    accentSurfaceForeground: spec.accent,
    messageSurface: spec.surface,
    messageForeground: spec.text,
    messageAction: spec.accent,
    messageActionForeground: accentForeground,
    messageActionHover: spec.secondary,
    codeBackground: isDark ? "#06080c" : "#f1f3f5",
    codeForeground: spec.text,
    sidebar: isDark ? spec.canvas : spec.surface,
    sidebarForeground: spec.text,
    sidebarMutedForeground: spec.textMuted,
    sidebarControlSurface: spec.surface,
    sidebarRowHover: spec.surface,
    sidebarRowActive: spec.surfaceRaised,
    sidebarRowSelected: spec.surfaceRaised,
    sidebarBorder: border,
    terminalBackground: terminalBg,
    terminalForeground: spec.text,
    terminalCursor: spec.accent,
    terminalSelection: isDark ? "rgba(56, 189, 248, 0.25)" : "rgba(56, 189, 248, 0.3)",
    terminalScrollbar: spec.surfaceRaised,
    terminalScrollbarHover: spec.accent,
  };

  return {
    id: spec.id,
    label: spec.label,
    appearance: spec.appearance,
    collection: { id: "prism", label: "Prism" },
    sidebarArtwork: true,
    colors,
  };
}

/** Prism Tide - Ocean navy & electric sky blue (Luca's active theme) */
export const PRISM_TIDE_THEME = makePrismTheme({
  id: "prism-tide",
  label: "Prism Tide",
  appearance: "dark",
  canvas: "#08131f",
  surface: "#0e1c2b",
  surfaceRaised: "#142638",
  accent: "#38bdf8",
  secondary: "#2dd4bf",
  text: "#e6f1fa",
  textMuted: "#86a2ba",
  border: "#182a3d",
  terminalBg: "#08131f",
});

/** Prism Aurora - Emerald mint & soft violet over pine night */
export const PRISM_AURORA_THEME = makePrismTheme({
  id: "prism-aurora",
  label: "Prism Aurora",
  appearance: "dark",
  canvas: "#0b1216",
  surface: "#111b20",
  surfaceRaised: "#18252b",
  accent: "#30d5a0",
  secondary: "#a78bfa",
  text: "#ecfdf5",
  textMuted: "#8fb3aa",
  border: "#1d2e2b",
  terminalBg: "#0b1216",
});

/** Prism Solstice - Sunset warm amber, coral and magenta */
export const PRISM_SOLSTICE_THEME = makePrismTheme({
  id: "prism-solstice",
  label: "Prism Solstice",
  appearance: "dark",
  canvas: "#160e12",
  surface: "#21151a",
  surfaceRaised: "#2c1c22",
  accent: "#ff7a45",
  secondary: "#ff3d8b",
  text: "#fff4ed",
  textMuted: "#c29a8e",
  border: "#3a222c",
  terminalBg: "#160e12",
});

/** Prism Nocturne - OLED pitch black with warm amber glow */
export const PRISM_NOCTURNE_THEME = makePrismTheme({
  id: "prism-nocturne",
  label: "Prism Nocturne",
  appearance: "dark",
  canvas: "#000000",
  surface: "#0c0b0a",
  surfaceRaised: "#151311",
  accent: "#ffb454",
  secondary: "#ff8a5b",
  text: "#f3e9dc",
  textMuted: "#9a8c7c",
  border: "#241f1a",
  terminalBg: "#000000",
});

/** Prism Graphite - Neutral dark surfaces with clear blue accent */
export const PRISM_GRAPHITE_THEME = makePrismTheme({
  id: "prism-graphite",
  label: "Prism Graphite",
  appearance: "dark",
  canvas: "#161618",
  surface: "#1f1f22",
  surfaceRaised: "#2a2a2e",
  accent: "#0a84ff",
  secondary: "#64d2ff",
  text: "#f5f5f7",
  textMuted: "#9e9ea6",
  border: "#2f2f36",
  terminalBg: "#161618",
});

/** Prism Tokyo Night - Deep navy storm & electric neon */
export const PRISM_TOKYO_NIGHT_THEME = makePrismTheme({
  id: "prism-tokyo-night",
  label: "Prism Tokyo Night",
  appearance: "dark",
  canvas: "#1a1b26",
  surface: "#1f2335",
  surfaceRaised: "#24283b",
  accent: "#7aa2f7",
  secondary: "#bb9af7",
  text: "#c0caf5",
  textMuted: "#787c99",
  border: "#292e42",
  terminalBg: "#1a1b26",
});

/** Prism Cyberpunk - High-voltage neon yellow, hot magenta & obsidian */
export const PRISM_CYBERPUNK_THEME = makePrismTheme({
  id: "prism-cyberpunk",
  label: "Prism Cyberpunk",
  appearance: "dark",
  canvas: "#0b0c10",
  surface: "#14161d",
  surfaceRaised: "#1e212b",
  accent: "#ffe600",
  secondary: "#ff0055",
  text: "#fcee0a",
  textMuted: "#00f0ff",
  border: "#333118",
  terminalBg: "#0b0c10",
});

/** Prism Nord - Arctic ice cyan and calm boreal slate */
export const PRISM_NORD_THEME = makePrismTheme({
  id: "prism-nord",
  label: "Prism Nord",
  appearance: "dark",
  canvas: "#2e3440",
  surface: "#3b4252",
  surfaceRaised: "#434c5e",
  accent: "#88c0d0",
  secondary: "#81a1c1",
  text: "#eceff4",
  textMuted: "#d8dee9",
  border: "#4c566a",
  terminalBg: "#2e3440",
});

/** Prism Solarized - Ethan Schoonover's scientifically calculated palette */
export const PRISM_SOLARIZED_THEME = makePrismTheme({
  id: "prism-solarized",
  label: "Prism Solarized",
  appearance: "dark",
  canvas: "#002b36",
  surface: "#073642",
  surfaceRaised: "#0e4756",
  accent: "#b58900",
  secondary: "#2aa198",
  text: "#839496",
  textMuted: "#586e75",
  border: "#184e5e",
  terminalBg: "#002b36",
});

/** Prism Terminal - Phosphor green on deep black */
export const PRISM_TERMINAL_THEME = makePrismTheme({
  id: "prism-terminal",
  label: "Prism Terminal",
  appearance: "dark",
  canvas: "#050806",
  surface: "#0b110d",
  surfaceRaised: "#101913",
  accent: "#3dff8b",
  secondary: "#00d1ff",
  text: "#d7ffe4",
  textMuted: "#6fa284",
  border: "#132819",
  terminalBg: "#050806",
});

/** Prism Porcelain - Warm daylight and quiet reading (light) */
export const PRISM_PORCELAIN_THEME = makePrismTheme({
  id: "prism-porcelain",
  label: "Prism Porcelain",
  appearance: "light",
  canvas: "#f7f5f2",
  surface: "#ffffff",
  surfaceRaised: "#f0ece6",
  accent: "#4f46e5",
  secondary: "#0ea5e9",
  text: "#1c1b1a",
  textMuted: "#6e6a64",
  border: "#e5e0d8",
  terminalBg: "#ffffff",
});

/** Prism Sakura - Soft blossom pinks on warm paper (light) */
export const PRISM_SAKURA_THEME = makePrismTheme({
  id: "prism-sakura",
  label: "Prism Sakura",
  appearance: "light",
  canvas: "#fff7f9",
  surface: "#ffffff",
  surfaceRaised: "#fbe8ed",
  accent: "#e0457b",
  secondary: "#9b5de5",
  text: "#2a1a20",
  textMuted: "#8a6b75",
  border: "#f3d3dc",
  terminalBg: "#ffffff",
});

/** All flagship Prism themes */
export const PRISM_FLAGSHIP_THEMES: ReadonlyArray<ThemeDefinition> = [
  PRISM_TIDE_THEME,
  PRISM_AURORA_THEME,
  PRISM_SOLSTICE_THEME,
  PRISM_NOCTURNE_THEME,
  PRISM_GRAPHITE_THEME,
  PRISM_TOKYO_NIGHT_THEME,
  PRISM_CYBERPUNK_THEME,
  PRISM_NORD_THEME,
  PRISM_SOLARIZED_THEME,
  PRISM_TERMINAL_THEME,
  PRISM_PORCELAIN_THEME,
  PRISM_SAKURA_THEME,
];
