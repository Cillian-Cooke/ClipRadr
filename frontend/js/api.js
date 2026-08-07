import { getIdToken, forceLogout, isSignedIn, isSessionLocked } from "/js/auth.js";
import { store } from "/js/store.js";

const PUBLIC_PATHS = new Set(["/api/health", "/api/status"]);

function authIsRequired() {
  return !!store.get()?.status?.auth?.auth_required;
}

function isPublicApi(path) {
  const bare = path.split("?")[0];
  return PUBLIC_PATHS.has(bare);
}

async function request(path, options = {}, { _retried = false } = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  let token = null;
  try {
    token = await getIdToken(_retried);
  } catch {
    token = null;
  }

  if (authIsRequired() && !isPublicApi(path) && !token) {
    for (let i = 0; i < 8 && !token; i++) {
      await new Promise((r) => setTimeout(r, 200));
      token = await getIdToken(true);
    }
  }

  if (authIsRequired() && !isPublicApi(path) && !token) {
    // Never kick a locked session for a transient token gap.
    if (isSessionLocked() || isSignedIn()) {
      throw new Error("Auth token unavailable — retry in a moment");
    }
    await forceLogout("Missing Authorization Bearer token");
    throw new Error("Sign in required");
  }

  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, {
    ...options,
    headers,
  });
  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text };
  }

  if (res.status === 401) {
    if (!_retried) {
      try {
        const refreshed = await getIdToken(true);
        if (refreshed) {
          return request(path, options, { _retried: true });
        }
      } catch {
        /* fall through */
      }
    }
    const detail = typeof data?.detail === "string" ? data.detail : "";
    // Only hard-logout on explicit invalid-token responses.
    if (/invalid auth token|sign in required|missing authorization/i.test(detail)) {
      await forceLogout(detail || "Unauthorized — signed out");
    }
    throw new Error(detail || "Unauthorized");
  }

  if (!res.ok) {
    const msg = data?.detail || data?.message || res.statusText;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

/** Download a protected file using the Firebase ID token. */
export async function downloadAuthed(url, filename = "clip.mp4") {
  const headers = {};
  let token = null;
  try {
    token = await getIdToken();
  } catch {
    token = null;
  }
  if (authIsRequired() && !token) {
    if (isSessionLocked() || isSignedIn()) {
      throw new Error("Auth token unavailable — retry in a moment");
    }
    await forceLogout("Missing Authorization Bearer token");
    throw new Error("Sign in required");
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  if (res.status === 401) {
    const refreshed = await getIdToken(true);
    if (refreshed && refreshed !== token) {
      headers.Authorization = `Bearer ${refreshed}`;
      const retry = await fetch(url, { headers });
      if (retry.ok) {
        const blob = await retry.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = filename;
        document.body.append(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
        return;
      }
    }
    if (!isSessionLocked()) {
      await forceLogout("Unauthorized download — signed out");
    }
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      msg = JSON.parse(text)?.detail || text;
    } catch {
      /* keep */
    }
    throw new Error(typeof msg === "string" ? msg : "Download failed");
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export const api = {
  home: () => request("/api/home"),
  health: () => request("/api/health"),
  creators: () => request("/api/creators"),
  creator: (id) => request(`/api/creators/${id}`),
  creatorVideos: (id, { length, excludeShorts } = {}) => {
    const params = new URLSearchParams();
    if (length) params.set("length", length);
    else if (excludeShorts === false) params.set("length", "all");
    else if (excludeShorts === true) params.set("length", "no_shorts");
    const qs = params.toString();
    return request(`/api/creators/${id}/videos${qs ? `?${qs}` : ""}`);
  },
  addCreator: (payload) =>
    request("/api/creators", {
      method: "POST",
      body: JSON.stringify(typeof payload === "string" ? { url: payload } : payload),
    }),
  removeCreator: (id) => request(`/api/creators/${id}`, { method: "DELETE" }),
  searchChannels: (q) => request(`/api/youtube/search-channels?q=${encodeURIComponent(q)}`),
  video: (id) => request(`/api/videos/${id}`),
  videoMoments: (id) => request(`/api/videos/${id}/moments`),
  moment: (id, { includeRelated = false } = {}) =>
    request(`/api/moments/${id}${includeRelated ? "?include_related=1" : ""}`),
  momentComments: (id) => request(`/api/moments/${id}/comments`),
  opportunities: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/opportunities${qs ? `?${qs}` : ""}`);
  },
  search: (q) => request(`/api/search?q=${encodeURIComponent(q)}`),
  clips: () => request("/api/clips"),
  saveClip: (body) => request("/api/clips", { method: "POST", body: JSON.stringify(body) }),
  exportClip: (body) => request("/api/export", { method: "POST", body: JSON.stringify(body) }),
  exportStatus: (id) => request(`/api/export/${id}`),
  listExports: () => request("/api/account/exports"),
  me: () => request("/api/account/me"),
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
      // Never retry auth failures — forceLogout already handled them.
      if (/sign in required|unauthorized|401|missing authorization/i.test(msg)) break;
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
