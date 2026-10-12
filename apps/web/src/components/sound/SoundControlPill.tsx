/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=7m; seat=codex; date=2026-10-03 */
import { Volume2Icon, VolumeXIcon, MusicIcon, PlayIcon } from "lucide-react";
import { useState } from "react";
import { useSoundEffects } from "../../hooks/useSoundEffects";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "../../lib/utils";
import type { SoundCue, SoundPack } from "@t3tools/shared/soundDesign";

const SOUND_PACK_LABELS: Record<SoundPack, string> = {
  "prism-harmonic": "Harmonic",
  "minimal-pure": "Minimal",
  "mechanical-click": "Mechanical",
  off: "Muted (Off)",
};

const TEST_CUES: ReadonlyArray<{ id: SoundCue; label: string }> = [
  { id: "turn-completed", label: "Turn Complete" },
  { id: "approval-requested", label: "Approval Alert" },
  { id: "turn-started", label: "Turn Started" },
  { id: "theme-switched", label: "Short Click" },
];

export function SoundControlPill() {
  const { settings, updateSettings, testCue } = useSoundEffects();
  const [open, setOpen] = useState(false);

  const isMuted = !settings.enabled || settings.pack === "off" || settings.volume === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-label="Sound and Audio Feedback"
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-all",
                    isMuted
                      ? "border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted/70"
                      : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 shadow-sm",
                  )}
                >
                  {isMuted ? (
                    <VolumeXIcon className="size-3.5 opacity-60" />
                  ) : (
                    <Volume2Icon className="size-3.5 text-primary" />
                  )}
                  <span className="hidden sm:inline font-mono text-[11px]">
                    {isMuted ? "Muted" : settings.volume + "%"}
                  </span>
                </button>
              }
            />
          }
        />
        <TooltipPopup>Audio feedback ({isMuted ? "Off" : settings.pack})</TooltipPopup>
      </Tooltip>

      <PopoverContent align="end" className="w-72 p-3 text-xs">
        <div className="space-y-3">
          <div className="flex items-center justify-between pb-1 border-b border-border/50">
            <div className="flex items-center gap-2 font-medium">
              <MusicIcon className="size-4 text-primary" />
              <span>Sensory Audio Feedback</span>
            </div>
            <Button
              size="xs"
              variant={settings.enabled ? "outline" : "secondary"}
              onClick={() => updateSettings({ enabled: !settings.enabled })}
            >
              {settings.enabled ? "Mute" : "Unmute"}
            </Button>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>Volume</span>
              <span className="font-mono">{settings.volume}%</span>
            </div>
            <input
              type="range"
              aria-label="Sound effects volume"
              min={0}
              max={100}
              step={5}
              value={settings.volume}
              onChange={(e) => updateSettings({ volume: Number(e.target.value) })}
              className="w-full accent-primary cursor-pointer"
            />
          </div>

          <div className="space-y-1.5">
            <span className="text-[11px] text-muted-foreground">Acoustic Profile</span>
            <div className="grid grid-cols-1 gap-1">
              {(Object.keys(SOUND_PACK_LABELS) as SoundPack[]).map((packKey) => {
                const isSelected = settings.pack === packKey;
                return (
                  <button
                    key={packKey}
                    type="button"
                    onClick={() => {
                      updateSettings({ pack: packKey, enabled: packKey !== "off" });
                      if (packKey !== "off") testCue("theme-switched");
                    }}
                    className={cn(
                      "flex items-center justify-between rounded px-2 py-1 text-left transition-colors",
                      isSelected
                        ? "bg-primary/15 font-medium text-foreground"
                        : "hover:bg-accent/40 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span>{SOUND_PACK_LABELS[packKey]}</span>
                    {isSelected && <span className="size-1.5 rounded-full bg-primary" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5 pt-1 border-t border-border/40">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Preview Cues
            </span>
            <div className="grid grid-cols-2 gap-1">
              {TEST_CUES.map(({ id, label }) => (
                <Button
                  key={id}
                  size="xs"
                  variant="ghost"
                  className="justify-start gap-1 h-6 text-[11px] font-normal"
                  onClick={() => testCue(id)}
                >
                  <PlayIcon className="size-2.5 opacity-60" />
                  <span className="truncate">{label}</span>
                </Button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
