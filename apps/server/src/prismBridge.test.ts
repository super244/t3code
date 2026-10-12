/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-03 */
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { makePrismBridge } from "./prismBridge.ts";
const directories: string[] = [];
function fixture() {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-prism-test-"));
  directories.push(root);
  return {
    root,
    themes: NodePath.join(root, "themes"),
    settings: NodePath.join(root, "settings.json"),
  };
}
afterEach(() => {
  for (const directory of directories.splice(0))
    NodeFS.rmSync(directory, { recursive: true, force: true });
});
describe("Prism bridge", () => {
  it("does not write a fallback theme when Prism is absent", () => {
    const f = fixture();
    const bridge = makePrismBridge(f.themes, f.settings);
    expect(bridge.syncNow()).toMatchObject({
      synced: false,
      activeThemeId: null,
      lastSyncedAt: null,
    });
    expect(bridge.status().error).toContain("not found");
    expect(NodeFS.existsSync(f.themes)).toBe(false);
  });
  it("writes only to the configured home and keeps instances isolated", () => {
    const a = fixture();
    const b = fixture();
    NodeFS.writeFileSync(a.settings, JSON.stringify({ activeThemeID: "prism.tide" }));
    const first = makePrismBridge(a.themes, a.settings);
    const second = makePrismBridge(b.themes, b.settings);
    expect(first.syncNow()).toMatchObject({ synced: true, activeThemeId: "prism-tide" });
    expect(
      JSON.parse(NodeFS.readFileSync(NodePath.join(a.themes, "prism.json"), "utf8")).name,
    ).toBeTruthy();
    expect(second.status().synced).toBe(false);
    expect(NodeFS.existsSync(b.themes)).toBe(false);
  });
  it("preserves the existing theme and reports malformed or unsupported settings", () => {
    const f = fixture();
    const bridge = makePrismBridge(f.themes, f.settings);
    NodeFS.writeFileSync(f.settings, JSON.stringify({ activeThemeID: "prism.tide" }));
    bridge.syncNow();
    const before = NodeFS.readFileSync(NodePath.join(f.themes, "prism.json"), "utf8");
    for (const contents of ["broken", JSON.stringify({ activeThemeID: "unknown" })]) {
      NodeFS.writeFileSync(f.settings, contents);
      expect(bridge.syncNow().synced).toBe(false);
      expect(bridge.status().error).toBeTruthy();
      expect(NodeFS.readFileSync(NodePath.join(f.themes, "prism.json"), "utf8")).toBe(before);
    }
  });
  it("reports a destination write failure instead of claiming a successful sync", () => {
    const f = fixture();
    NodeFS.writeFileSync(f.themes, "a file, not a directory");
    NodeFS.writeFileSync(f.settings, JSON.stringify({ activeThemeID: "prism.tide" }));
    expect(makePrismBridge(f.themes, f.settings).syncNow()).toMatchObject({
      synced: false,
      lastSyncedAt: null,
    });
  });
});
