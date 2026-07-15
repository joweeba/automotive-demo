import { useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// Mock Spotify player. There's no real audio — a module-level ticker advances a
// simulated playhead so the now-playing bar feels live (progress moves, tracks
// auto-advance). Same tiny store shape as vehicleState/agentStore.
// ---------------------------------------------------------------------------

export interface Track {
  title: string;
  artist: string;
  duration: number; // seconds
}

// A short fictional playlist (invented titles/artists — nothing real is streamed).
export const TRACKS: Track[] = [
  { title: "Neon Horizon", artist: "Soleil", duration: 214 },
  { title: "Midnight Drive", artist: "Ava Reyes", duration: 258 },
  { title: "Cassette Dreams", artist: "The Meridian", duration: 192 },
  { title: "Open Road", artist: "Kites & Comets", duration: 236 },
];

interface MusicState {
  index: number; // current track
  playing: boolean;
  position: number; // seconds into the current track
  volume: number; // 0–100
}

let state: MusicState = { index: 0, playing: true, position: 0, volume: 60 };

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function set(patch: Partial<MusicState>) {
  state = { ...state, ...patch };
  emit();
}

export const getMusic = () => state;
export function subscribeMusic(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ── Simulated playhead ────────────────────────────────────────────────────
const TICK_MS = 250;
let timer: ReturnType<typeof setInterval> | null = setInterval(() => {
  if (!state.playing) return;
  const dur = TRACKS[state.index].duration;
  const pos = state.position + TICK_MS / 1000;
  if (pos >= dur) set({ index: (state.index + 1) % TRACKS.length, position: 0 });
  else set({ position: pos });
}, TICK_MS);

// Clean the ticker up on hot-reload so intervals don't stack (and speed up time).
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (timer) clearInterval(timer);
    timer = null;
  });
}

// ── Actions ───────────────────────────────────────────────────────────────
export const togglePlay = () => set({ playing: !state.playing });
export const nextTrack = () =>
  set({ index: (state.index + 1) % TRACKS.length, position: 0 });
export function prevTrack() {
  // Spotify convention: >3s in, restart the track; otherwise jump to the previous.
  if (state.position > 3) return set({ position: 0 });
  set({ index: (state.index - 1 + TRACKS.length) % TRACKS.length, position: 0 });
}
export const seek = (pos: number) =>
  set({ position: Math.max(0, Math.min(pos, TRACKS[state.index].duration)) });
/** Jump directly to a track by index (used by the BMW renderer's media.track_index). */
export const setTrack = (index: number) => {
  const i = ((index % TRACKS.length) + TRACKS.length) % TRACKS.length;
  if (i !== state.index) set({ index: i, position: 0 });
};
export const setVolume = (v: number) => set({ volume: Math.max(0, Math.min(100, v)) });

export function useMusic<T>(selector: (s: MusicState) => T): T {
  return useSyncExternalStore(subscribeMusic, () => selector(state));
}

/** Format seconds as m:ss. */
export const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};
