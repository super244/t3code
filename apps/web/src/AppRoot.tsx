/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=10m; seat=antigravity; date=2026-10-09 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=29m; seat=codex; date=2026-10-09 */
import { RouterProvider } from "@tanstack/react-router";

import { ElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { PreviewAutomationHosts } from "./components/preview/PreviewAutomationHosts";
import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { EnterpriseThemeProvider } from "./enterpriseTheme";
import { AppAtomRegistryProvider } from "./rpc/atomRegistry";
import type { AppRouter } from "./router";

/**
 * Owns renderer-wide providers. The Electron browser host intentionally sits
 * outside the router so its webviews survive route transitions, but it must
 * share the same atom registry as routed UI.
 *
 * Global status surfaces must be backed by recorded environment state.
 */
export function AppRoot({ router }: { readonly router: AppRouter }) {
  return (
    <EnterpriseThemeProvider>
      <AppAtomRegistryProvider>
        <RouterProvider router={router} />
        <PreviewAutomationHosts />
        <ElectronBrowserHost />
        <QuitHoldOverlay />
      </AppAtomRegistryProvider>
    </EnterpriseThemeProvider>
  );
}
