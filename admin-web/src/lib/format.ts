const dateTime = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Zurich",
});

export function formatDateTime(iso: string | null): string {
  if (iso === null || iso === "") return "–";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "–" : dateTime.format(date);
}

/** "vor 3 Std." / "vor 2 Tagen" */
export function formatAge(iso: string | null, now: Date = new Date()): string {
  if (iso === null || iso === "") return "–";
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `vor ${hours} Std.`;
  return `vor ${Math.round(hours / 24)} Tagen`;
}

export const REASON_LABELS: Record<string, string> = {
  spam: "Spam",
  harassment: "Belästigung/Mobbing",
  nudity: "Nacktheit/sexuell",
  violence: "Gewalt/Drohung",
  hate: "Hassrede",
  copyright: "Urheberrecht",
  self_harm: "Selbstgefährdung",
  non_consensual: "Ohne Einwilligung gezeigt",
  other: "Sonstiges",
};

export const TYPE_LABELS: Record<string, string> = {
  post: "Beitrag",
  story: "Story",
  comment: "Kommentar",
  message: "Nachricht",
  profile: "Profil",
  plan: "Trainingsplan",
  workout: "Aktivität",
};

export const STATUS_LABELS: Record<string, string> = {
  open: "Offen",
  in_review: "In Prüfung",
  resolved: "Erledigt",
  dismissed: "Abgewiesen",
};

export const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  active: "Aktiv",
  suspended: "Gesperrt",
  banned: "Gebannt",
  deleting: "Wird gelöscht",
};

export function label(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}
