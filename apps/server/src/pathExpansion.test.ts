// @effect-diagnostics nodeBuiltinImport:off
/* agent-watermark: model=opus-5; effort=high; duration=18m; seat=claude-code; date=2026-10-04 */
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { expandHomePath, isAbsoluteHomeRemainder } from "./pathExpansion.ts";

describe("expandHomePath", () => {
  it("returns an empty string unchanged", () => {
    expect(expandHomePath("")).toBe("");
  });

  it("returns paths without a leading tilde unchanged", () => {
    expect(expandHomePath("/absolute/path")).toBe("/absolute/path");
    expect(expandHomePath("relative/path")).toBe("relative/path");
    expect(expandHomePath("some~weird~path")).toBe("some~weird~path");
  });

  it("expands a lone tilde to the home directory", () => {
    expect(expandHomePath("~")).toBe(NodeOS.homedir());
  });

  it("expands ~/ to a subpath of the home directory", () => {
    expect(expandHomePath("~/.codex-work")).toBe(NodePath.join(NodeOS.homedir(), ".codex-work"));
  });

  it("expands a Windows-style ~\\ prefix", () => {
    expect(expandHomePath("~\\.codex")).toBe(NodePath.join(NodeOS.homedir(), ".codex"));
  });

  // The Add Project box opens on `~/`, so an absolute path pasted after it must
  // not become a second, invented directory under the home directory.
  it("keeps an absolute path pasted after the tilde prefix absolute", () => {
    expect(expandHomePath("~//private/tmp/race-demo")).toBe("/private/tmp/race-demo");
    expect(expandHomePath(`~/${NodeOS.homedir()}/.cache/race-demo`)).toBe(
      NodePath.join(NodeOS.homedir(), ".cache", "race-demo"),
    );
  });

  // A looser absolute test would strand real file names outside the home
  // directory: both of these are ordinary names on POSIX.
  it("keeps platform-relative names under the home directory", () => {
    expect(expandHomePath("~/notes:")).toBe(NodePath.join(NodeOS.homedir(), "notes:"));
    expect(expandHomePath("~/C:notes")).toBe(NodePath.join(NodeOS.homedir(), "C:notes"));
  });

  describe("isAbsoluteHomeRemainder", () => {
    it("treats only POSIX roots as absolute on POSIX", () => {
      expect(isAbsoluteHomeRemainder("/private/tmp/x", "darwin")).toBe(true);
      expect(isAbsoluteHomeRemainder("\\\\server\\share", "darwin")).toBe(false);
      expect(isAbsoluteHomeRemainder("\\foo", "darwin")).toBe(false);
      expect(isAbsoluteHomeRemainder("C:\\repos", "darwin")).toBe(false);
      expect(isAbsoluteHomeRemainder("x:", "linux")).toBe(false);
    });

    it("treats drive roots and UNC paths as absolute on Windows", () => {
      expect(isAbsoluteHomeRemainder("C:\\repos\\race-demo", "win32")).toBe(true);
      expect(isAbsoluteHomeRemainder("C:/repos/race-demo", "win32")).toBe(true);
      expect(isAbsoluteHomeRemainder("\\\\server\\share", "win32")).toBe(true);
      // Drive-relative, not absolute: `C:notes` means "notes on drive C".
      expect(isAbsoluteHomeRemainder("C:notes", "win32")).toBe(false);
      expect(isAbsoluteHomeRemainder("notes:", "win32")).toBe(false);
    });
  });

  it("does not expand ~user paths", () => {
    expect(expandHomePath("~alice/foo")).toBe("~alice/foo");
  });
});
