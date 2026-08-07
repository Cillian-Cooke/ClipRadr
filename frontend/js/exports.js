/** Background export jobs — keep downloading while the user navigates. */

import { api, downloadAuthed } from "/js/api.js";

const listeners = new Set();
/** @type {Map<number|string, object>} */
const jobs = new Map();
const pollTimers = new Map();

function notify() {
  const list = getExportJobs();
  for (const fn of listeners) {
    try {
      fn(list);
    } catch {
      /* ignore */
    }
  }
}

export function getExportJobs() {
  return [...jobs.values()].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

export function subscribeExports(fn) {
  listeners.add(fn);
  try {
    fn(getExportJobs());
  } catch {
    /* ignore */
  }
  return () => listeners.delete(fn);
}

function upsert(job) {
  const prev = jobs.get(job.id) || {};
  const next = { ...prev, ...job };
  jobs.set(job.id, next);
  notify();
  return next;
}

function stopPoll(id) {
  const t = pollTimers.get(id);
  if (t) clearInterval(t);
  pollTimers.delete(id);
}

async function pollJob(id) {
  try {
    const remote = await api.exportStatus(id);
    const cur = jobs.get(id) || {};
    upsert({
      id,
      status: remote.status,
      progress: remote.progress ?? cur.progress ?? 0,
      download_url: remote.download_url || cur.download_url,
      error: remote.error || null,
      duration_seconds: remote.duration_seconds,
    });
    if (remote.status === "COMPLETED" || remote.status === "FAILED") {
      stopPoll(id);
    }
  } catch (err) {
    upsert({
      id,
      status: "FAILED",
      error: err.message || "Export status failed",
    });
    stopPoll(id);
  }
}

function startPolling(id) {
  stopPoll(id);
  pollTimers.set(
    id,
    setInterval(() => {
      pollJob(id);
    }, 500)
  );
  pollJob(id);
}

/**
 * Create an export on the server and track it in the sidebar.
 * Returns the tracked job; polling continues even if the modal closes.
 */
export async function startBackgroundExport({
  body,
  label = "Clip export",
  filename = "clip.mp4",
  qualityLabel = "",
} = {}) {
  const remote = await api.exportClip(body);
  const job = upsert({
    id: remote.id,
    status: remote.status || "QUEUED",
    progress: Math.max(remote.progress || 0, 8),
    download_url: remote.download_url,
    error: remote.error || null,
    label,
    filename,
    qualityLabel,
    startedAt: Date.now(),
  });
  if (job.status === "QUEUED" || job.status === "PROCESSING") {
    startPolling(job.id);
  }
  return job;
}

export function dismissExportJob(id) {
  stopPoll(id);
  jobs.delete(id);
  notify();
}

export async function downloadExportJob(id) {
  const job = jobs.get(id);
  if (!job?.download_url) throw new Error("Download not ready");
  await downloadAuthed(job.download_url, job.filename || `clip_${id}.mp4`);
}

export function isExportBusy() {
  return getExportJobs().some((j) => j.status === "QUEUED" || j.status === "PROCESSING");
}
