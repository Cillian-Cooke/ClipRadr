/** Long-form VOD filter — hide YouTube Shorts (under 3 minutes / #shorts). */

export const SHORTS_MAX_SECONDS = 180;
const PREF_KEY = "clipradar_exclude_shorts";

export function isShortVideo(video) {
  const duration = Number(video?.duration_seconds) || 0;
  if (duration > 0 && duration < SHORTS_MAX_SECONDS) return true;
  const title = String(video?.title || "").toLowerCase();
  if (title.includes("#shorts") || /\b#short\b/.test(title)) return true;
  return false;
}

export function getExcludeShortsPref() {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw === null) return true; // default: long-form only
    return raw !== "0";
  } catch {
    return true;
  }
}

export function setExcludeShortsPref(on) {
  try {
    localStorage.setItem(PREF_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function filterVideos(videos, excludeShorts = getExcludeShortsPref()) {
  const list = Array.isArray(videos) ? videos : [];
  if (!excludeShorts) return { videos: list, shortsHidden: 0 };
  const kept = [];
  let shortsHidden = 0;
  for (const v of list) {
    if (isShortVideo(v)) shortsHidden += 1;
    else kept.push(v);
  }
  return { videos: kept, shortsHidden };
}

/** Chip bar matching Clip Opportunities filters. */
export function renderLengthFilterBar(el, { excludeShorts, onChange }) {
  const bar = el("div", { class: "filter-bar" });
  for (const [on, label] of [
    [true, "Long-form only"],
    [false, "Include Shorts"],
  ]) {
    bar.append(
      el("button", {
        class: `chip ${excludeShorts === on ? "active" : ""}`,
        text: label,
        onclick: () => onChange(on),
      })
    );
  }
  return bar;
}
