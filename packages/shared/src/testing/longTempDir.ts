/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=56m; seat=codex; date=2026-10-07 */
// @effect-diagnostics nodeBuiltinImport:off - runs once at test setup, outside any Effect runtime.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import { HostProcessPlatform } from "../hostProcess.ts";

// macOS exposes /var through /private/var; Windows can use short names.
// GitHub's Windows runners hand out the temp directory by its 8.3 short name
// (C:\Users\RUNNER~1\...). Anything that canonicalises a path, such as git or
// realpath, reports the long form, so equality checks between a temp path and
// its canonical form fail. Node reads TEMP/TMP on every os.tmpdir() call, so
// pointing them at the long form fixes every temp directory the suite makes.
if (
  HostProcessPlatform.defaultValue() === "win32" ||
  HostProcessPlatform.defaultValue() === "darwin"
) {
  try {
    const longForm = NodeFS.realpathSync.native(NodeOS.tmpdir());
    if (HostProcessPlatform.defaultValue() === "win32") {
      process.env.TEMP = longForm;
      process.env.TMP = longForm;
    } else {
      process.env.TMPDIR = longForm;
    }
  } catch {
    // Leave the host's value alone if it cannot be resolved.
  }
}
