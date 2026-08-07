/** Video length filters for creator / videos lists. */

export const SHORTS_MAX_SECONDS = 180; // under 3 min
export const OVER_1H_SECONDS = 3600;

/** @typedef {"all" | "no_shorts" | "over_1h"} LengthFilter */

export const LENGTH_FILTERS = [
  { id: "all", label: "All lengths" },
  { id: "no_shorts", label: "Over 3 min" },
  { id: "over_1h", label: "Over 1 hour" },
];

const PREF_KEY = "clipradar_length_filter";
const LEGACY_SHORTS_KEY = "clipradar_exclude_shorts";

export function isShortVideo(video) {
  const duration = Number(video?.duration_seconds) || 0;
  if (duration > 0 && duration < SHORTS_MAX_SECONDS) return true;
  const title = String(video?.title || "").toLowerCase();
  if (title.includes("#shorts") || /\b#short\b/.test(title)) return true;
  return false;
}

export function passesLengthFilter(video, mode = getLengthFilterPref()) {
  const duration = Number(video?.duration_seconds) || 0;
  if (mode === "all") return true;
  if (mode === "over_1h") return duration >= OVER_1H_SECONDS;
  // no_shorts
  return !isShortVideo(video);
}

/** @returns {LengthFilter} */
export function getLengthFilterPref() {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw === "all" || raw === "no_shorts" || raw === "over_1h") return raw;
    // Migrate old boolean preference.
    const legacy = localStorage.getItem(LEGACY_SHORTS_KEY);
    if (legacy === "0") return "all";
    return "no_shorts";
  } catch {
    return "no_shorts";
  }
}

/** @param {LengthFilter} mode */
export function setLengthFilterPref(mode) {
  try {
    localStorage.setItem(PREF_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function filterVideos(videos, mode = getLengthFilterPref()) {
  const list = Array.isArray(videos) ? videos : [];
  if (mode === "all") return { videos: list, hidden: 0 };
  const kept = [];
  let hidden = 0;
  for (const v of list) {
    if (passesLengthFilter(v, mode)) kept.push(v);
    else hidden += 1;
  }
  return { videos: kept, hidden };
}

export function lengthFilterHint(mode, hidden) {
  if (!hidden) return "";
  if (mode === "over_1h") {
    return `Hiding ${hidden} video${hidden === 1 ? "" : "s"} under 1 hour.`;
  }
  if (mode === "no_shorts") {
    return `Hiding ${hidden} Short${hidden === 1 ? "" : "s"} (under 3 min / #shorts).`;
  }
  return "";
}

export function lengthFilterEmptyMessage(mode) {
  if (mode === "over_1h") {
    return "No videos over 1 hour here. Try Over 3 min or All lengths, or refresh a creator.";
  }
  if (mode === "no_shorts") {
    return "No videos over 3 minutes yet. Try All lengths or refresh a creator.";
  }
  return "No videos yet. Add a creator to import recent uploads.";
}

export function lengthFilterSectionTitle(mode) {
  if (mode === "over_1h") return "Videos over 1 hour";
  if (mode === "no_shorts") return "Videos over 3 min";
  return "Recent Videos";
}

/** Chip bar matching Clip Opportunities filters. */
export function renderLengthFilterBar(el, { mode, onChange }) {
  const bar = el("div", { class: "filter-bar" });
  for (const item of LENGTH_FILTERS) {
    bar.append(
      el("button", {
        class: `chip ${mode === item.id ? "active" : ""}`,
        text: item.label,
        onclick: () => onChange(item.id),
      })
    );
  }
  return bar;
}
