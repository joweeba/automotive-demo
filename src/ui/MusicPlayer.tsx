import { Card, IconButton, Slider } from "@liquidai/react";
import { Spotify, SkipBack, SkipForward, Play, Pause, Volume, VolumeLow } from "./icons";
import {
  useMusic,
  TRACKS,
  togglePlay,
  nextTrack,
  prevTrack,
  setVolume,
} from "../state/musicStore";

/**
 * Spotify-style now-playing bar, driven by the mock `musicStore` (no real audio —
 * a ticker advances a simulated playhead). A wide bottom bar: track on the left,
 * transport in the middle (outlined circular play/pause), volume slider flanked by
 * low/high icons, and a thin progress line along the bottom edge.
 */
export function MusicPlayer() {
  const { index, playing, position, volume } = useMusic((s) => s);
  const track = TRACKS[index];
  const pct = Math.min(100, (position / track.duration) * 100);

  return (
    <Card className="relative flex items-center gap-5 overflow-hidden rounded-2xl px-5 py-3 shadow-xl">
      {/* Track */}
      <Spotify className="h-9 w-9 shrink-0" />
      <div className="min-w-0 w-[128px] shrink-0">
        <div className="truncate text-sm font-medium text-foreground">{track.title}</div>
        <div className="truncate text-xs text-muted-foreground">{track.artist}</div>
      </div>

      {/* Transport */}
      <div className="flex shrink-0 items-center gap-2">
        <IconButton variant="ghost" size="sm" aria-label="Previous track" onClick={prevTrack}>
          <SkipBack />
        </IconButton>
        <IconButton
          variant="default"
          size="md"
          round
          aria-label={playing ? "Pause" : "Play"}
          onClick={togglePlay}
        >
          {playing ? <Pause /> : <Play />}
        </IconButton>
        <IconButton variant="ghost" size="sm" aria-label="Next track" onClick={nextTrack}>
          <SkipForward />
        </IconButton>
      </div>

      {/* Volume — icon on each end of the slider */}
      <div className="flex flex-1 items-center gap-2.5">
        <VolumeLow className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Slider
          value={[volume]}
          onValueChange={(v) => setVolume(v[0])}
          max={100}
          step={1}
          aria-label="Volume"
          // Tidal's slider fill (range) + thumb default to `foreground` (stark white in
          // this build). Retint the fill to the muted token and make the thumb a solid
          // muted dot (drop its white ring) via classes that actually compile here.
          className="flex-1 [&>span:first-child>span]:!bg-muted-foreground [&>span:last-child>span]:!bg-muted-foreground [&>span:last-child>span]:!border-transparent"
        />
        <Volume className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>

      {/* Playback progress — thin line along the bottom edge. */}
      <div className="absolute inset-x-0 bottom-0 h-[3px] bg-[color:var(--muted-foreground)]/15">
        <div
          className="h-full bg-foreground/70 transition-[width] duration-200 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
    </Card>
  );
}
