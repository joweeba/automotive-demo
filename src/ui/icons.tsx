import type { ComponentProps, ComponentType } from "react";
import {
  IconChevronUp,
  IconChevronDown,
  IconPlayerPlayFilled,
  IconPlayerPauseFilled,
  IconPlayerSkipBackFilled,
  IconPlayerSkipForwardFilled,
  IconVolume,
  IconVolume2,
  IconVideo,
  IconWind,
  IconRefresh,
  IconMist,
  IconArrowUp,
  IconWaveSine,
  IconCloudRain,
  IconSun,
  IconMoon,
  IconLayoutSidebarRightCollapse,
  IconPlayerStopFilled,
  IconMicrophone,
  IconMicrophoneOff,
  IconTerminal2,
  IconTrash,
} from "@tabler/icons-react";

// Tidal icon standard: 1.5px stroke; color follows `currentColor` — muted by
// default (set by the parent), foreground when the parent is active/selected.
type TablerProps = ComponentProps<typeof IconChevronUp>;

function tidalIcon(Base: ComponentType<TablerProps>) {
  return function TidalIcon(props: TablerProps) {
    return <Base stroke={1.5} size={18} {...props} />;
  };
}

export const ChevronUp = tidalIcon(IconChevronUp);
export const ChevronDown = tidalIcon(IconChevronDown);
export const Play = tidalIcon(IconPlayerPlayFilled);
export const Pause = tidalIcon(IconPlayerPauseFilled);
export const SkipBack = tidalIcon(IconPlayerSkipBackFilled);
export const SkipForward = tidalIcon(IconPlayerSkipForwardFilled);
export const Volume = tidalIcon(IconVolume);
export const VolumeLow = tidalIcon(IconVolume2);
export const Camera = tidalIcon(IconVideo);
export const Fan = tidalIcon(IconWind);
export const Recirculate = tidalIcon(IconRefresh);
export const Fog = tidalIcon(IconMist);
export const ArrowUp = tidalIcon(IconArrowUp);
export const Waveform = tidalIcon(IconWaveSine);
// Weather (environment panel).
export const Rain = tidalIcon(IconCloudRain);
export const Sun = tidalIcon(IconSun);
export const Moon = tidalIcon(IconMoon);
export const Mist = tidalIcon(IconMist);
// Agent chat.
export const PanelClose = tidalIcon(IconLayoutSidebarRightCollapse);
export const Stop = tidalIcon(IconPlayerStopFilled);
export const Mic = tidalIcon(IconMicrophone);
export const MicOff = tidalIcon(IconMicrophoneOff);
export const Terminal = tidalIcon(IconTerminal2);
export const Trash = tidalIcon(IconTrash);

// Brand marks stay custom (Tabler's are monochrome).

// Spotify glyph (filled green circle + three bars).
export const Spotify = (p: ComponentProps<"svg">) => (
  <svg width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true" {...p}>
    <circle cx="12" cy="12" r="12" fill="#1DB954" />
    <path
      d="M7 10.5c3-.9 6.5-.6 9 1M7.5 13.4c2.4-.7 5-.4 7 .9M8 16c1.8-.5 3.7-.3 5.2.7"
      fill="none"
      stroke="#0b0b0b"
      strokeWidth={1.4}
      strokeLinecap="round"
    />
  </svg>
);

// Liquid AI mark — the official three-piece logomark (Figma 123:2355), drawn with
// currentColor so it inherits the surrounding text color (muted empty-state droplet,
// foreground next to the "Agent" label). viewBox 52×64; aspect ratio preserved.
export const LiquidMark = (p: ComponentProps<"svg">) => (
  <svg
    width="1em"
    height="1em"
    viewBox="0 0 52 64"
    fill="currentColor"
    aria-hidden="true"
    {...p}
  >
    <path d="M25.7551 0C26.0687 0.245561 30.5881 7.92907 31.2007 8.94259L51.6235 42.7364C48.428 43.8166 45.0755 44.8444 41.8547 45.8802L35.101 48.0555C35.6359 47.1766 36.0419 46.2258 36.3063 45.2322C36.832 43.2473 36.7618 41.1521 36.1043 39.2066C35.6482 37.8621 34.9059 36.7152 34.1936 35.4939L31.6995 31.2148L19.5563 10.2905C21.4853 6.91954 23.736 3.34885 25.7551 0Z" />
    <path d="M49.6186 45.9444C49.5493 46.361 39.6535 62.2171 38.5506 63.9933H16.7956L16.7934 63.9438C16.9114 63.7272 30.8295 52.0028 31.615 51.6426C32.2723 51.341 33.0169 51.1605 33.7077 50.9468L37.3073 49.826L49.6186 45.9444Z" />
    <path d="M18.1556 12.6173C20.2458 16.201 22.38 19.9894 24.527 23.5179L18.811 33.4161C17.8162 35.1469 16.0984 37.7807 15.567 39.586C15.0224 41.437 14.9981 43.4014 15.4967 45.2652C16.2307 47.9923 18.0201 50.3176 20.4724 51.7308C22.1691 52.7086 23.975 53.1661 25.9278 53.1789C21.6805 56.718 17.2287 60.5682 12.9332 64L4.31987 49.8518L1.43744 45.0972C1.06805 44.4911 0.389716 43.3073 0.00012207 42.7809V42.7309L18.1556 12.6173Z" />
  </svg>
);
