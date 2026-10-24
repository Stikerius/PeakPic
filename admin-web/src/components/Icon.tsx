import type { IconName } from "../lib/navigation";

type UiIcon = IconName | "search" | "keyboard" | "collapse" | "expand" | "logout" | "close";

/** Simple line icons (24 units, stroke in the text colour). Decorative: the label is next to them. */
const PATHS: Record<UiIcon, readonly string[]> = {
  overview: ["M4 11l8-7 8 7", "M6 10v10h12V10", "M10 20v-6h4v6"],
  queue: ["M4 13l2-8h12l2 8", "M4 13v6h16v-6", "M4 13h5l1 2h4l1-2h5"],
  users: ["M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z", "M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6", "M16 4.5a3.5 3.5 0 0 1 0 6.5", "M21 20c0-2.7-1.6-5-4-5.7"],
  usage: ["M4 20h16", "M7 16v-5", "M12 16V6", "M17 16v-8"],
  legal: ["M7 3h7l4 4v14H7Z", "M14 3v4h4", "M10 12h5", "M10 16h5"],
  pending: ["M5 12l4 4 10-10", "M4 4h11", "M4 20h16"],
  reset: ["M4 12a8 8 0 1 0 2.3-5.7", "M4 4v4h4"],
  mail: ["M4 6h16v12H4Z", "M4 7l8 6 8-6"],
  audit: ["M8 6h12", "M8 12h12", "M8 18h12", "M4 6h.01", "M4 12h.01", "M4 18h.01"],
  logos: ["M12 3l8 5v8l-8 5-8-5V8Z", "M12 12l8-4", "M12 12v9", "M12 12L4 8"],
  design: ["M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.2-1.6-.4-1 .3-2.1 1.4-2.1H17a4 4 0 0 0 4-4c0-5-4-10.3-9-10.3Z", "M7.5 11h.01", "M10 7h.01", "M15 7.5h.01"],
  search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z", "M20 20l-4-4"],
  keyboard: ["M3 7h18v10H3Z", "M7 11h.01", "M11 11h.01", "M15 11h.01", "M8 14h8"],
  collapse: ["M15 6l-6 6 6 6"],
  expand: ["M9 6l6 6-6 6"],
  logout: ["M15 4h4v16h-4", "M10 8l-4 4 4 4", "M6 12h10"],
  close: ["M6 6l12 12", "M18 6L6 18"],
};

export function Icon({ name, size = 18 }: { name: UiIcon; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
