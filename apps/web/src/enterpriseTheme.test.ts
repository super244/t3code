/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=10m; seat=antigravity; date=2026-10-09 */
import { describe, it, expect } from "vite-plus/test";
import {
  ENTERPRISE_THEME_ID,
  ENTERPRISE_THEME_TOKENS,
  ENTERPRISE_OBSIDIAN_THEME,
  injectEnterpriseThemeStyles,
  ENTERPRISE_CSS_STYLES,
} from "./enterpriseTheme";
import { THEME_COLOR_ROLES } from "@t3tools/shared/themePalettes";

describe("enterpriseTheme", () => {
  it("defines the canonical enterprise theme id", () => {
    expect(ENTERPRISE_THEME_ID).toBe("enterprise-obsidian-neon");
  });

  it("exports comprehensive tokens for obsidian slate, neon blue, typography, and glows", () => {
    expect(ENTERPRISE_THEME_TOKENS.colors.obsidian[950]).toBe("#06070a");
    expect(ENTERPRISE_THEME_TOKENS.colors.neon.cyan).toBe("#00f0ff");
    expect(ENTERPRISE_THEME_TOKENS.colors.neon.blue).toBe("#0070f3");
    expect(ENTERPRISE_THEME_TOKENS.typography.fontSans).toContain("Inter");
    expect(ENTERPRISE_THEME_TOKENS.glows.agentPulse).toContain("rgba(0, 240, 255");
    expect(ENTERPRISE_THEME_TOKENS.glassmorphism.backdropFilter).toContain("blur");
  });

  it("fulfills all 53 canonical ThemeColorRole properties for the obsidian theme", () => {
    expect(ENTERPRISE_OBSIDIAN_THEME.id).toBe(ENTERPRISE_THEME_ID);
    expect(ENTERPRISE_OBSIDIAN_THEME.appearance).toBe("dark");

    for (const role of THEME_COLOR_ROLES) {
      expect(ENTERPRISE_OBSIDIAN_THEME.colors[role]).toBeDefined();
      expect(typeof ENTERPRISE_OBSIDIAN_THEME.colors[role]).toBe("string");
    }
  });

  it("contains luxury glassmorphism and neon styles in CSS payload", () => {
    expect(ENTERPRISE_CSS_STYLES).toContain("enterprise-glass");
    expect(ENTERPRISE_CSS_STYLES).toContain("enterprise-glow-cyan");
    expect(ENTERPRISE_CSS_STYLES).toContain("enterprise-pulse-ring");
  });

  it("injects styles cleanly when document is present and safely no-ops when undefined", () => {
    // When document is undefined, no-ops safely
    expect(() => injectEnterpriseThemeStyles()).not.toThrow();

    // When mocked document is present
    const appendedElements: any[] = [];
    const elementsById = new Map<string, any>();

    const mockDocument = {
      getElementById: (id: string) => elementsById.get(id) || null,
      createElement: (tag: string) => ({
        id: "",
        textContent: "",
        tagName: tag.toUpperCase(),
      }),
      head: {
        appendChild: (el: any) => {
          appendedElements.push(el);
          if (el.id) elementsById.set(el.id, el);
        },
      },
    };

    (globalThis as any).document = mockDocument;
    try {
      injectEnterpriseThemeStyles();
      expect(appendedElements.length).toBe(1);
      expect(appendedElements[0].id).toBe("t3-enterprise-theme-styles");
      expect(appendedElements[0].textContent).toContain("enterprise-glass");

      // Calling again should not duplicate
      injectEnterpriseThemeStyles();
      expect(appendedElements.length).toBe(1);
    } finally {
      delete (globalThis as any).document;
    }
  });
});
