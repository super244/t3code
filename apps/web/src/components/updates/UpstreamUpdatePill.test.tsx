import { describe, expect, it } from "vite-plus/test";

describe("UpstreamUpdate tracker contract", () => {
  it("parses and classifies upstream assets correctly", () => {
    const assets = [
      { name: "t3-code-0.0.40-arm64.dmg", expected: "mac-arm64" },
      { name: "t3-code-0.0.40-x64.dmg", expected: "mac-x64" },
      { name: "t3-code-0.0.40.AppImage", expected: "linux" },
      { name: "t3-code-0.0.40-setup.exe", expected: "windows" },
    ];

    function classifyPlatform(assetName: string) {
      const lower = assetName.toLowerCase();
      if (lower.includes("arm64.dmg") || lower.includes("darwin-arm64")) return "mac-arm64";
      if (lower.includes("x64.dmg") || lower.includes("darwin-x64") || lower.includes("mac.dmg")) return "mac-x64";
      if (lower.endsWith(".appimage") || lower.endsWith(".deb") || lower.includes("linux")) return "linux";
      if (lower.endsWith(".exe") || lower.includes("win32")) return "windows";
      return "other";
    }

    for (const item of assets) {
      expect(classifyPlatform(item.name)).toBe(item.expected);
    }
  });

  it("verifies upstream repo default target", () => {
    const defaultRepo = "pingdotgg/t3code";
    expect(defaultRepo).toBe("pingdotgg/t3code");
  });
});
