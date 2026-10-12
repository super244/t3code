/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=7m; seat=codex; date=2026-10-03 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  DEFAULT_SOUND_SETTINGS,
  playSound,
  readStoredSoundSettings,
  writeStoredSoundSettings,
  getSoundSettingsSnapshot,
  subscribeSoundSettings,
  updateSoundSettings,
} from "./soundEffects";

const contexts: FakeAudioContext[] = [];
function audioParam() {
  return { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
}
function gainNode() {
  return { gain: audioParam(), connect: vi.fn(), disconnect: vi.fn() };
}
function oscillatorNode() {
  const events = new EventTarget();
  return {
    type: "sine",
    frequency: audioParam(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    end: () => events.dispatchEvent(new Event("ended")),
  };
}
class FakeAudioContext {
  state = "running";
  currentTime = 1;
  destination = {};
  resume = vi.fn(async () => {
    this.state = "running";
  });
  gains: Array<ReturnType<typeof gainNode>> = [];
  oscillators: Array<ReturnType<typeof oscillatorNode>> = [];
  constructor() {
    contexts.push(this);
  }
  createGain() {
    const node = gainNode();
    this.gains.push(node);
    return node;
  }
  createOscillator() {
    const node = oscillatorNode();
    this.oscillators.push(node);
    return node;
  }
}
let storage: Map<string, string>;
let events: EventTarget;
const settings = { enabled: true, volume: 80, pack: "minimal-pure" as const };
beforeEach(() => {
  storage = new Map();
  events = new EventTarget();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    AudioContext: FakeAudioContext,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  });
  writeStoredSoundSettings(DEFAULT_SOUND_SETTINGS);
});
afterEach(() => {
  for (const context of contexts) {
    for (const oscillator of context.oscillators) oscillator.end();
    context.state = "closed";
  }
  contexts.length = 0;
  vi.unstubAllGlobals();
});
describe("sound settings", () => {
  it("reads defaults and round-trips settings", () => {
    expect(readStoredSoundSettings()).toEqual(DEFAULT_SOUND_SETTINGS);
    writeStoredSoundSettings(settings);
    expect(readStoredSoundSettings()).toEqual(settings);
  });
  it("survives a blocked localStorage getter and keeps session updates", () => {
    Object.defineProperty(window, "localStorage", {
      get: () => {
        throw new Error("blocked");
      },
    });
    expect(readStoredSoundSettings()).toEqual(DEFAULT_SOUND_SETTINGS);
    expect(() => writeStoredSoundSettings(settings)).not.toThrow();
    expect(getSoundSettingsSnapshot()).toEqual(settings);
  });
  it("rejects malformed stored settings and clamps finite volume", () => {
    storage.set("t3-sound-settings", '{"volume":"bad"}');
    expect(readStoredSoundSettings()).toEqual(DEFAULT_SOUND_SETTINGS);
    writeStoredSoundSettings({ ...settings, volume: 200 });
    expect(readStoredSoundSettings().volume).toBe(100);
    expect(() => writeStoredSoundSettings({ ...settings, volume: NaN })).toThrow();
  });
  it("merges rapid updates against current settings and publishes changes once", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSoundSettings(listener);
    updateSoundSettings({ volume: 25 });
    updateSoundSettings({ pack: "mechanical-click" });
    expect(getSoundSettingsSnapshot()).toEqual({
      ...DEFAULT_SOUND_SETTINGS,
      volume: 25,
      pack: "mechanical-click",
    });
    expect(listener).toHaveBeenCalledTimes(2);
    updateSoundSettings({ volume: 25 });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
  it("syncs changed settings and cleared storage from other tabs", () => {
    const unsubscribe = subscribeSoundSettings(vi.fn());
    storage.set("t3-sound-settings", JSON.stringify(settings));
    const event = new Event("storage");
    Object.defineProperty(event, "key", { value: "t3-sound-settings" });
    events.dispatchEvent(event);
    expect(getSoundSettingsSnapshot()).toEqual(settings);
    storage.clear();
    events.dispatchEvent(event);
    expect(getSoundSettingsSnapshot()).toEqual(DEFAULT_SOUND_SETTINGS);
    unsubscribe();
  });
});
describe("sound playback", () => {
  it("does not allocate audio for disabled or muted cues", () => {
    expect(playSound("turn-completed", { ...settings, enabled: false })).toBe(false);
    expect(playSound("turn-completed", { ...settings, pack: "off" })).toBe(false);
    expect(playSound("turn-completed", { ...settings, volume: NaN })).toBe(false);
    expect(contexts).toHaveLength(0);
  });
  it("uses the newly selected pack immediately and releases every audio node", () => {
    updateSoundSettings(settings);
    expect(playSound("turn-started")).toBe(true);
    const context = contexts[0]!;
    // Minimal Pure has one partial; the previous Prism setting has two.
    expect(context.oscillators).toHaveLength(1);
    expect(context.oscillators[0]!.frequency.setValueAtTime).toHaveBeenCalledWith(600, 1);
    context.oscillators[0]!.end();
    for (const node of [...context.gains, ...context.oscillators])
      expect(node.disconnect).toHaveBeenCalledTimes(1);
  });
  it("bounds overlapping cues and permits playback again after completion", () => {
    for (let i = 0; i < 8; i++) expect(playSound("turn-started", settings)).toBe(true);
    expect(playSound("turn-started", settings)).toBe(false);
    contexts[0]!.oscillators[0]!.end();
    expect(playSound("turn-started", settings)).toBe(true);
  });
  it("keeps failed persistence usable when the controls reopen", () => {
    Object.defineProperty(window, "localStorage", {
      get: () => {
        throw new Error("blocked");
      },
    });
    writeStoredSoundSettings(settings);
    const unsubscribe = subscribeSoundSettings(vi.fn());
    expect(getSoundSettingsSnapshot()).toEqual(settings);
    unsubscribe();
    const unsubscribeAgain = subscribeSoundSettings(vi.fn());
    expect(getSoundSettingsSnapshot()).toEqual(settings);
    unsubscribeAgain();
  });
  it("disconnects partially allocated nodes after a scheduling failure", () => {
    playSound("turn-started", settings);
    const context = contexts[0]!;
    context.oscillators[0]!.end();
    const originalCreateGain = context.createGain.bind(context);
    const createGain = vi
      .spyOn(context, "createGain")
      .mockImplementationOnce(originalCreateGain)
      .mockImplementationOnce(() => {
        throw new Error("audio unavailable");
      });
    expect(playSound("turn-started", settings)).toBe(false);
    expect(context.oscillators.at(-1)!.disconnect).toHaveBeenCalledTimes(1);
    expect(context.gains.at(-1)!.disconnect).toHaveBeenCalledTimes(1);
    createGain.mockRestore();
    expect(playSound("turn-started", settings)).toBe(true);
  });
  it("handles autoplay denial without allocating nodes or rejecting", async () => {
    playSound("turn-started", settings);
    const context = contexts[0]!;
    context.oscillators[0]!.end();
    context.oscillators.length = 0;
    context.state = "suspended";
    context.resume.mockRejectedValueOnce(new Error("autoplay denied"));
    expect(playSound("turn-started", settings)).toBe(true);
    await context.resume.mock.results[0]!.value.catch(() => {});
    await Promise.resolve();
    expect(context.oscillators).toHaveLength(0);
  });
});
