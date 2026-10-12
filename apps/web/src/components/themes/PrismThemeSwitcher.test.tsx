import { describe, expect, it } from "vite-plus/test";
import { PRISM_FLAGSHIP_THEMES } from "@t3tools/shared/themePalettes";

describe("PrismThemeSwitcher logic and theme definitions", () => {
  it("exposes all 12 flagship Prism themes with required properties", () => {
    expect(PRISM_FLAGSHIP_THEMES).toHaveLength(12);

    for (const theme of PRISM_FLAGSHIP_THEMES) {
      expect(theme.id).toMatch(/^prism-/);
      expect(theme.label).toBeTruthy();
      expect(["dark", "light"]).toContain(theme.appearance);
      expect(theme.colors.canvas).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(theme.colors.surface).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(theme.colors.accent).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("contains the primary Prism Tide and Aurora themes", () => {
    const tide = PRISM_FLAGSHIP_THEMES.find((t) => t.id === "prism-tide");
    expect(tide).toBeDefined();
    expect(tide?.appearance).toBe("dark");
    expect(tide?.colors.accent).toBe("#38bdf8");

    const aurora = PRISM_FLAGSHIP_THEMES.find((t) => t.id === "prism-aurora");
    expect(aurora).toBeDefined();
    expect(aurora?.colors.accent).toBe("#30d5a0");
  });
});
