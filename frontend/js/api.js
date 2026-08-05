async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text };
  }
  if (!res.ok) {
    const msg = data?.detail || data?.message || res.statusText;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

export const api = {
  home: () => request("/api/home"),
  health: () => request("/api/health"),
  creators: () => request("/api/creators"),
  creator: (id) => request(`/api/creators/${id}`),
  creatorVideos: (id) => request(`/api/creators/${id}/videos`),
  addCreator: (payload) =>
    request("/api/creators", {
      method: "POST",
      body: JSON.stringify(typeof payload === "string" ? { url: payload } : payload),
    }),
  searchChannels: (q) => request(`/api/youtube/search-channels?q=${encodeURIComponent(q)}`),
  video: (id) => request(`/api/videos/${id}`),
  videoMoments: (id) => request(`/api/videos/${id}/moments`),
  moment: (id) => request(`/api/moments/${id}`),
  opportunities: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/opportunities${qs ? `?${qs}` : ""}`);
  },
  search: (q) => request(`/api/search?q=${encodeURIComponent(q)}`),
  clips: () => request("/api/clips"),
  saveClip: (body) => request("/api/clips", { method: "POST", body: JSON.stringify(body) }),
  exportClip: (body) => request("/api/export", { method: "POST", body: JSON.stringify(body) }),
  exportStatus: (id) => request(`/api/export/${id}`),
  status: () => request("/api/status"),
  statusCheck: () => request("/api/status?check_youtube=1"),
  scanCreator: (id) => request(`/api/creators/${id}/scan`, { method: "POST" }),
  refreshCreator: (id) => request(`/api/creators/${id}/refresh`, { method: "POST" }),
  scanVideo: (id, { sync = false } = {}) =>
    request(`/api/videos/${id}/scan${sync ? "?sync=1" : ""}`, { method: "POST" }),
};

export async function withRetry(fn, { tries = 3, delayMs = 700, label = "Request" } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      const retryable =
        /failed to fetch|network|timeout|502|503|504|cloudflare|temporar|econnreset|socket/i.test(
          msg
        );
      if (!retryable || i === tries - 1) break;
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastErr || new Error(`${label} failed`);
}


export function formatTime(seconds) {
  seconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function parseTimeInput(value) {
  const parts = String(value).trim().split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}
