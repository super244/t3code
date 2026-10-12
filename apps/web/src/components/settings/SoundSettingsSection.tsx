/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=7m; seat=codex; date=2026-10-03 */
import { PlayIcon, Volume2Icon } from "lucide-react";
import { useSoundEffects } from "../../hooks/useSoundEffects";
import { Button } from "../ui/button";
import type { SoundCue, SoundPack } from "@t3tools/shared/soundDesign";

const PACK_OPTIONS: ReadonlyArray<{ id: SoundPack; label: string; desc: string }> = [
  {
    id: "prism-harmonic",
    label: "Harmonic",
    desc: "Layered chords for notifications and actions",
  },
  {
    id: "minimal-pure",
    label: "Minimal",
    desc: "Short, simple notification tones",
  },
  {
    id: "mechanical-click",
    label: "Mechanical",
    desc: "Brief clicks and pips",
  },
  {
    id: "off",
    label: "Muted / Off",
    desc: "Silent operation with no audio effects",
  },
];

const AUDITION_CUES: ReadonlyArray<{ id: SoundCue; label: string }> = [
  { id: "turn-completed", label: "Turn Completed" },
  { id: "approval-requested", label: "Approval Needed" },
  { id: "turn-started", label: "Turn Started" },
  { id: "action-error", label: "Action Error" },
  { id: "theme-switched", label: "Theme Switched" },
  { id: "mission-launched", label: "Mission Launched" },
];

export function SoundSettingsSection() {
  const { settings, updateSettings, testCue } = useSoundEffects();

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center gap-2 border-b border-border/60 pb-2">
        <Volume2Icon className="size-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Sound effects</h3>
      </div>

      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-border/60 p-3 bg-card/40">
          <div>
            <div className="text-sm font-medium text-foreground">Enable Sound Effects</div>
            <div className="text-xs text-muted-foreground">
              Play cues when turns start or finish, approvals arrive, and errors occur
            </div>
          </div>
          <Button
            size="sm"
            variant={settings.enabled ? "default" : "outline"}
            aria-pressed={settings.enabled}
            onClick={() => updateSettings({ enabled: !settings.enabled })}
          >
            {settings.enabled ? "Enabled" : "Disabled"}
          </Button>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-border/60 p-3 bg-card/40">
          <div>
            <div className="text-sm font-medium text-foreground">Master Volume</div>
            <div className="text-xs text-muted-foreground">
              Set the volume for notifications and previews
            </div>
          </div>
          <div className="flex items-center gap-3 w-48">
            <span className="text-xs font-mono text-muted-foreground w-10 text-right">
              {settings.volume}%
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={settings.volume}
              onChange={(e) => updateSettings({ volume: Number(e.target.value) })}
              aria-label="Sound effects volume"
              className="flex-1 accent-primary cursor-pointer"
            />
          </div>
        </div>

        <div className="rounded-lg border border-border/60 p-3 bg-card/40 space-y-2">
          <div className="text-sm font-medium text-foreground">Sound pack</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            {PACK_OPTIONS.map((pack) => {
              const active = settings.pack === pack.id;
              return (
                <button
                  key={pack.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    updateSettings({ pack: pack.id, enabled: pack.id !== "off" });
                    if (pack.id !== "off") testCue("theme-switched");
                  }}
                  className={`flex flex-col items-start p-2.5 rounded-md border text-left transition-all ${
                    active
                      ? "border-primary bg-primary/10 shadow-sm"
                      : "border-border/60 hover:bg-accent/30"
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs font-medium text-foreground">{pack.label}</span>
                    {active && <span className="size-2 rounded-full bg-primary" />}
                  </div>
                  <span className="text-[11px] text-muted-foreground mt-0.5">{pack.desc}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border border-border/60 p-3 bg-card/40 space-y-2">
          <div className="text-sm font-medium text-foreground">Test Sound Cues</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
            {AUDITION_CUES.map((cue) => (
              <Button
                key={cue.id}
                size="sm"
                variant="outline"
                className="justify-start gap-1.5 h-8 text-xs font-normal"
                disabled={settings.pack === "off" || settings.volume === 0}
                onClick={() => testCue(cue.id)}
              >
                <PlayIcon className="size-3 text-primary" />
                <span className="truncate">{cue.label}</span>
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
