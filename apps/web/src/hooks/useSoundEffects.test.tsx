/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=7m; seat=codex; date=2026-10-03 */
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { useSoundEffects } from "./useSoundEffects";
import { DEFAULT_SOUND_SETTINGS, playSound, writeStoredSoundSettings } from "../lib/soundEffects";

vi.mock("../lib/soundEffects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/soundEffects")>()),
  playSound: vi.fn(() => true),
}));
function Control() {
  const { settings, updateSettings, testCue } = useSoundEffects();
  return (
    <button
      onClick={() => {
        updateSettings({ pack: "mechanical-click", volume: 25 });
        testCue("theme-switched");
      }}
    >
      {settings.pack}:{settings.volume}
    </button>
  );
}
let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("sound controls", () => {
  it("previews the new pack immediately and synchronizes multiple controls without storage", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const events = new EventTarget();
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("blocked");
      },
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    });
    writeStoredSoundSettings(DEFAULT_SOUND_SETTINGS);
    act(() => {
      renderer = create(
        <>
          <Control />
          <Control />
        </>,
      );
    });
    act(() => renderer!.root.findAllByType("button")[0]!.props.onClick());
    expect(playSound).toHaveBeenCalledWith("theme-switched", {
      enabled: true,
      volume: 25,
      pack: "mechanical-click",
    });
    for (const button of renderer!.root.findAllByType("button")) {
      expect(button.children.join("")).toBe("mechanical-click:25");
    }
  });
});
