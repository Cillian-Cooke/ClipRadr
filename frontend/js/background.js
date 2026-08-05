/** Global background scanner — keeps running across page navigations. */

import { api, withRetry } from "./api.js";
import { store } from "./store.js";
import { refreshWorkspace } from "./refresh.js";

let started = false;
let timer = null;
let restoring = false;

async function scanNext() {
  const s = store.get();
  if (s.busy) return;
  const next = s.scanQueue[0];
  if (!next) return;

  // If the server no longer has creators, stop burning scans on dead video IDs.
  if (!(store.get().creators || []).length) {
    store.resetScanHistory();
    return;
  }

  s.busy = true;
  s.currentScanId = next;
  store.notify();

  let creatorId = store.get().videoById?.[next]?.creator_id || null;

  try {
    const res = await withRetry(() => api.scanVideo(next, { sync: true }), {
      tries: 2,
      delayMs: 900,
      label: "Scan",
    });
    store.markScanned(next);
    if (res?.moments != null || res?.status === "SCANNED") {
      try {
        const moments = await api.videoMoments(next);
        store.setMoments(next, moments.moments || []);
      } catch {
        /* cache later */
      }
      try {
        const video = await api.video(next);
        store.setVideo(video);
        creatorId = video.creator_id || video.creator?.id || creatorId;
      } catch {
        /* ignore */
      }
    }
    await refreshWorkspace({ creatorId });
  } catch (e) {
    const msg = String(e?.message || e);
    // Dead IDs after a cold start — don't keep counting them as progress.
    if (/not found|404|video not found/i.test(msg)) {
      store.markScanned(next);
      await refreshWorkspace();
    } else {
      store.markScanError(next, msg);
      store.bumpData("scan-error");
    }
  } finally {
    store.get().busy = false;
    store.notify();
  }
}

function tick() {
  scanNext().finally(() => {
    const { pending } = store.scanProgress();
    if (pending > 0) {
      timer = setTimeout(tick, 500);
    } else {
      timer = null;
    }
  });
}

export function kickBackgroundScans() {
  if (timer || store.get().busy) return;
  if (!store.get().scanQueue.length) return;
  tick();
}

export function startBackgroundWorker() {
  if (started) return;
  started = true;
  store.subscribe(() => {
    const { pending } = store.scanProgress();
    if (pending > 0 && !timer && !store.get().busy) kickBackgroundScans();
  });
  kickBackgroundScans();
}

/** After adding a creator, cache + queue all imported videos for comment scans. */
export async function afterCreatorAdded(res) {
  if (res?.creator) {
    store.rememberChannel(res.creator);
    const creators = store.get().creators.filter((c) => c.id !== res.creator.id);
    store.setCreators([res.creator, ...creators]);
  }

  let videoIds = res?.video_ids || [];

  if (res?.creator?.id && (!videoIds.length || res.import_error)) {
    try {
      await withRetry(() => api.refreshCreator(res.creator.id), { tries: 2, delayMs: 800 });
      const vids = await api.creatorVideos(res.creator.id);
      store.setCreatorVideos(res.creator.id, vids.videos || []);
      videoIds = (vids.videos || [])
        .filter((v) => v.scan_status !== "SCANNED")
        .map((v) => v.id);
    } catch {
      /* keep going */
    }
  } else if (res?.creator?.id) {
    try {
      const vids = await api.creatorVideos(res.creator.id);
      store.setCreatorVideos(res.creator.id, vids.videos || []);
    } catch {
      /* ignore */
    }
  }

  store.enqueueScans(videoIds);
  await refreshWorkspace({ creatorId: res?.creator?.id });
  kickBackgroundScans();
}

/** Re-import followed channels if the server forgot them (Vercel /tmp SQLite). */
export async function restoreFollowedCreators() {
  if (restoring) return { restored: 0 };
  restoring = true;
  try {
    let server;
    try {
      server = await api.creators();
    } catch {
      return { restored: 0 };
    }

    const serverList = server.creators || [];
    if (serverList.length) {
      store.setCreators(serverList);
      for (const c of serverList) {
        store.rememberChannel(c);
        try {
          const vids = await api.creatorVideos(c.id);
          store.setCreatorVideos(c.id, vids.videos || []);
          const need = (vids.videos || [])
            .filter((v) => v.scan_status !== "SCANNED" && v.scan_status !== "SCANNING")
            .map((v) => v.id);
          store.enqueueScans(need);
        } catch {
          /* continue */
        }
      }
      await refreshWorkspace();
      kickBackgroundScans();
      return { restored: 0, synced: serverList.length };
    }

    // Server is empty — previous scanDone IDs are meaningless.
    store.resetScanHistory();

    const followed = store.get().followedChannels || [];
    if (!followed.length) {
      await refreshWorkspace();
      return { restored: 0 };
    }

    store.bumpData("restoring");
    let restored = 0;
    for (const ch of followed) {
      try {
        const res = await withRetry(
          () =>
            api.addCreator({
              youtube_channel_id: ch.youtube_channel_id,
              auto_scan: false,
            }),
          { tries: 3, delayMs: 900, label: "Restore creator" }
        );
        restored += 1;
        await afterCreatorAdded(res);
      } catch (e) {
        console.warn("restore failed", ch.handle || ch.youtube_channel_id, e.message);
      }
    }
    await refreshWorkspace();
    return { restored };
  } finally {
    restoring = false;
  }
}
