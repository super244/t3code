/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=10m; seat=antigravity; date=2026-10-09 */
import React, { createContext, useContext, useEffect, useState, useMemo, type ReactNode } from "react";
import type { ThemeDefinition, ThemeColors } from "@t3tools/shared/themePalettes";

export const ENTERPRISE_THEME_ID = "enterprise-obsidian-neon" as const;
export const ENTERPRISE_STORAGE_KEY = "t3code:enterprise-mode:v1" as const;

/**
 * Tier-1 Enterprise Design Tokens (Obsidian Dark Slate / Neon Cyan & Blue / Linear & Cursor Grade)
 */
export const ENTERPRISE_THEME_TOKENS = {
  colors: {
    obsidian: {
      950: "#06070a",
      900: "#090b10",
      850: "#0d0f16",
      800: "#121520",
      750: "#171c2b",
      700: "#1e2436",
      600: "#2d374d",
    },
    neon: {
      cyan: "#00f0ff",
      electric: "#00d2ff",
      blue: "#0070f3",
      sapphire: "#1d4ed8",
      sky: "#38bdf8",
      glowCyan: "rgba(0, 240, 255, 0.45)",
      glowBlue: "rgba(0, 112, 243, 0.35)",
    },
    status: {
      lspHealthy: "#10b981",
      agentActive: "#00f0ff",
      agentQueued: "#38bdf8",
      tokenWarning: "#f59e0b",
      danger: "#f43f5e",
      latencyOptimal: "#06b6d4",
    },
  },
  typography: {
    fontSans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontMono: "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
    letterSpacing: {
      ultraTight: "-0.035em",
      tight: "-0.02em",
      snug: "-0.01em",
      normal: "0",
      caps: "0.08em",
      microCaps: "0.14em",
    },
    weights: {
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
  },
  glows: {
    agentPulse: "0 0 16px rgba(0, 240, 255, 0.5), 0 0 32px rgba(0, 112, 243, 0.25)",
    agentPulseSubtle: "0 0 8px rgba(0, 240, 255, 0.35)",
    lspHealthy: "0 0 12px rgba(16, 185, 129, 0.4)",
    tokenWarning: "0 0 14px rgba(245, 158, 11, 0.45)",
    neonBorder: "0 0 8px rgba(0, 240, 255, 0.4), inset 0 0 4px rgba(0, 240, 255, 0.2)",
    ambientSheen: "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(0, 240, 255, 0.08), transparent 75%)",
  },
  glassmorphism: {
    backdropFilter: "blur(18px) saturate(190%)",
    surface: "rgba(9, 11, 16, 0.85)",
    surfaceRaised: "rgba(18, 21, 32, 0.90)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    highlight: "inset 0 1px 0 rgba(255, 255, 255, 0.12)",
    specularLine: "linear-gradient(90deg, transparent 0%, rgba(0, 240, 255, 0.6) 50%, transparent 100%)",
    gradientBorder: "linear-gradient(135deg, rgba(0, 240, 255, 0.35) 0%, rgba(255, 255, 255, 0.07) 50%, rgba(0, 112, 243, 0.25) 100%)",
  },
} as const;

/**
 * Enterprise Obsidian Neon Colors fulfilling T3 Code's canonical 53-role palette
 */
const ENTERPRISE_OBSIDIAN_COLORS: ThemeColors = {
  canvas: "oklch(0.12 0.015 255)", // Deep obsidian slate (#07080b)
  chrome: "oklch(0.14 0.018 255)", // #0b0d13
  toolbar: "oklch(0.14 0.018 255)",
  toolbarForeground: "oklch(0.96 0.02 240)",
  toolbarBorder: "oklch(0.24 0.04 250)",
  toolbarControl: "oklch(0.18 0.025 250)",
  toolbarControlForeground: "oklch(0.90 0.05 230)",
  toolbarControlHover: "oklch(0.25 0.06 245)",
  surface: "oklch(0.15 0.02 250)", // #0d0f16
  surfaceRaised: "oklch(0.18 0.025 250)", // #131722
  surfaceOverlay: "oklch(0.12 0.015 255)",
  text: "oklch(0.97 0.01 240)", // #f0f6fc
  textMuted: "oklch(0.68 0.03 245)", // #8b949e
  border: "oklch(0.24 0.035 250)", // #1f2430
  input: "oklch(0.16 0.022 250)",
  focus: "oklch(0.78 0.19 220)", // #00f0ff neon cyan
  accent: "oklch(0.65 0.22 245)", // #0070f3 neon blue
  accentForeground: "oklch(0.99 0.01 240)",
  secondary: "oklch(0.20 0.03 250)",
  secondaryForeground: "oklch(0.88 0.04 235)",
  muted: "oklch(0.22 0.025 250)",
  mutedForeground: "oklch(0.65 0.03 245)",
  placeholder: "oklch(0.50 0.025 245)",
  secondaryLabel: "oklch(0.68 0.03 245)",
  iconMuted: "oklch(0.62 0.04 245)",
  error: "oklch(0.62 0.22 25)", // #f43f5e
  errorForeground: "oklch(0.95 0.05 25)",
  errorSurface: "oklch(0.20 0.08 25)",
  warning: "oklch(0.75 0.18 70)", // #f59e0b
  warningForeground: "oklch(0.95 0.05 70)",
  warningSurface: "oklch(0.22 0.07 70)",
  update: "oklch(0.78 0.19 220)", // #00f0ff
  updateForeground: "oklch(0.98 0.02 220)",
  updateSurface: "oklch(0.20 0.07 220)",
  accentSurface: "oklch(0.22 0.07 245)",
  accentSurfaceForeground: "oklch(0.90 0.08 230)",
  messageSurface: "oklch(0.16 0.022 250)",
  messageForeground: "oklch(0.96 0.01 240)",
  messageAction: "oklch(0.65 0.22 245)",
  messageActionForeground: "oklch(0.99 0.01 240)",
  messageActionHover: "oklch(0.70 0.24 245)",
  codeBackground: "oklch(0.10 0.012 255)", // #050608
  codeForeground: "oklch(0.92 0.04 220)",
  sidebar: "oklch(0.11 0.015 255)", // #07080c
  sidebarForeground: "oklch(0.95 0.02 240)",
  sidebarMutedForeground: "oklch(0.65 0.03 245)",
  sidebarControlSurface: "oklch(0.16 0.025 250)",
  sidebarRowHover: "oklch(0.16 0.025 250)",
  sidebarRowActive: "oklch(0.19 0.035 250)",
  sidebarRowSelected: "oklch(0.20 0.04 245)",
  sidebarBorder: "oklch(0.22 0.03 250)",
  terminalBackground: "oklch(0.09 0.01 255)",
  terminalForeground: "oklch(0.95 0.02 240)",
  terminalCursor: "oklch(0.78 0.19 220)",
  terminalSelection: "oklch(0.28 0.08 245)",
  terminalScrollbar: "oklch(0.22 0.03 250)",
  terminalScrollbarHover: "oklch(0.32 0.04 250)",
};

/**
 * Enterprise Obsidian Theme Definition
 */
export const ENTERPRISE_OBSIDIAN_THEME: ThemeDefinition = {
  id: ENTERPRISE_THEME_ID,
  label: "Enterprise Obsidian Neon",
  appearance: "dark",
  colors: ENTERPRISE_OBSIDIAN_COLORS,
  sidebarArtwork: true,
  variants: {
    dark: ENTERPRISE_OBSIDIAN_COLORS,
  },
};

/**
 * Custom CSS rules for Tier-1 Enterprise styling (luxury glass, neon glows, typography tokens)
 */
export const ENTERPRISE_CSS_STYLES = `
/* Enterprise Obsidian / Neon Glow Utility Classes */
:root[data-enterprise-theme="true"] {
  --enterprise-cyan: ${ENTERPRISE_THEME_TOKENS.colors.neon.cyan};
  --enterprise-blue: ${ENTERPRISE_THEME_TOKENS.colors.neon.blue};
  --enterprise-electric: ${ENTERPRISE_THEME_TOKENS.colors.neon.electric};
  --enterprise-glow-cyan: ${ENTERPRISE_THEME_TOKENS.glows.agentPulse};
  --enterprise-glow-lsp: ${ENTERPRISE_THEME_TOKENS.glows.lspHealthy};
  --enterprise-glow-token: ${ENTERPRISE_THEME_TOKENS.glows.tokenWarning};
  --enterprise-glass-bg: ${ENTERPRISE_THEME_TOKENS.glassmorphism.surface};
  --enterprise-glass-raised: ${ENTERPRISE_THEME_TOKENS.glassmorphism.surfaceRaised};
  --enterprise-glass-border: ${ENTERPRISE_THEME_TOKENS.glassmorphism.border};
}

.enterprise-glass {
  background: rgba(9, 11, 16, 0.85);
  backdrop-filter: blur(18px) saturate(190%);
  -webkit-backdrop-filter: blur(18px) saturate(190%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.45), inset 0 1px 0 0 rgba(255, 255, 255, 0.12);
}

.enterprise-glass-subtle {
  background: rgba(14, 17, 26, 0.75);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.enterprise-specular-top {
  position: relative;
}
.enterprise-specular-top::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent 0%, rgba(0, 240, 255, 0.7) 50%, transparent 100%);
  pointer-events: none;
}

.enterprise-glow-cyan {
  box-shadow: 0 0 12px rgba(0, 240, 255, 0.4), 0 0 24px rgba(0, 112, 243, 0.2);
}

.enterprise-glow-emerald {
  box-shadow: 0 0 10px rgba(16, 185, 129, 0.45);
}

.enterprise-glow-amber {
  box-shadow: 0 0 10px rgba(245, 158, 11, 0.45);
}

.enterprise-micro-caps {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.enterprise-gradient-text {
  background: linear-gradient(135deg, #00f0ff 0%, #38bdf8 50%, #0070f3 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.enterprise-pulse-ring {
  animation: enterprise-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes enterprise-pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.4;
    transform: scale(1.15);
  }
}
`;

/**
 * Injects the enterprise stylesheet once into document.head
 */
export function injectEnterpriseThemeStyles(): void {
  if (typeof document === "undefined") return;
  const styleId = "t3-enterprise-theme-styles";
  if (document.getElementById(styleId)) return;

  const styleEl = document.createElement("style");
  styleEl.id = styleId;
  styleEl.textContent = ENTERPRISE_CSS_STYLES;
  document.head.appendChild(styleEl);
}

interface EnterpriseThemeContextValue {
  readonly isEnterpriseMode: boolean;
  readonly setEnterpriseMode: (active: boolean) => void;
  readonly toggleEnterpriseMode: () => void;
  readonly tokens: typeof ENTERPRISE_THEME_TOKENS;
  readonly palette: ThemeDefinition;
}

const EnterpriseThemeContext = createContext<EnterpriseThemeContextValue>({
  isEnterpriseMode: true,
  setEnterpriseMode: () => {},
  toggleEnterpriseMode: () => {},
  tokens: ENTERPRISE_THEME_TOKENS,
  palette: ENTERPRISE_OBSIDIAN_THEME,
});

export function EnterpriseThemeProvider({
  children,
  defaultActive = true,
}: {
  readonly children: ReactNode;
  readonly defaultActive?: boolean;
}) {
  const [isEnterpriseMode, setIsEnterpriseMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return defaultActive;
    try {
      const stored = window.localStorage.getItem(ENTERPRISE_STORAGE_KEY);
      if (stored !== null) {
        return stored === "true";
      }
    } catch {
      // Ignore storage errors
    }
    return defaultActive;
  });

  useEffect(() => {
    injectEnterpriseThemeStyles();
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    try {
      window.localStorage.setItem(ENTERPRISE_STORAGE_KEY, String(isEnterpriseMode));
    } catch {
      // Ignore storage errors
    }

    if (isEnterpriseMode) {
      document.documentElement.setAttribute("data-enterprise-theme", "true");
    } else {
      document.documentElement.removeAttribute("data-enterprise-theme");
    }
  }, [isEnterpriseMode]);

  const value = useMemo<EnterpriseThemeContextValue>(() => ({
    isEnterpriseMode,
    setEnterpriseMode: setIsEnterpriseMode,
    toggleEnterpriseMode: () => setIsEnterpriseMode((prev) => !prev),
    tokens: ENTERPRISE_THEME_TOKENS,
    palette: ENTERPRISE_OBSIDIAN_THEME,
  }), [isEnterpriseMode]);

  return React.createElement(EnterpriseThemeContext.Provider, { value }, children);
}

export function useEnterpriseTheme(): EnterpriseThemeContextValue {
  return useContext(EnterpriseThemeContext);
}
