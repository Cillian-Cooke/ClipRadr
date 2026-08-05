/** Global background scanner — keeps running across page navigations. */

import { api } from "./api.js";
import { store } from "./store.js";

let started = false;
let timer = null;

async function scanNext() {
  const s = store.get();
  if (s.busy) return;
  const next = s.scanQueue[0];
  if (!next) return;

  s.busy = true;
  s.currentScanId = next;
  store.notify();

  try {
    const res = await api.scanVideo(next, { sync: true });
    store.markScanned(next);
    if (res?.moments != null || res?.status === "SCANNED") {
      try {
        const moments = await api.videoMoments(next);
        store.setMoments(next, moments.moments || []);
      } catch {
        /* cache later */
      }
    }
  } catch (e) {
    store.markScanError(next, e.message);
  } finally {
    store.get().busy = false;
    store.notify();
  }
}

function tick() {
  scanNext().finally(() => {
    const { pending } = store.scanProgress();
    if (pending > 0) {
      timer = setTimeout(tick, 400);
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
  if (!videoIds.length && res?.creator?.id) {
    try {
      const vids = await api.creatorVideos(res.creator.id);
      store.setCreatorVideos(res.creator.id, vids.videos || []);
      videoIds = (vids.videos || [])
        .filter((v) => v.scan_status !== "SCANNED")
        .map((v) => v.id);
    } catch {
      videoIds = [];
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
  kickBackgroundScans();
}

/** Re-import followed channels if the server forgot them (Vercel /tmp SQLite). */
export async function restoreFollowedCreators() {
  let server;
  try {
    server = await api.creators();
  } catch {
    return { restored: 0 };
  }

  const serverList = server.creators || [];
  if (serverList.length) {
    store.setCreators(serverList);
    // Queue unscanned videos for each creator
    for (const c of serverList) {
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
    kickBackgroundScans();
    return { restored: 0, synced: serverList.length };
  }

  const followed = store.get().followedChannels || [];
  if (!followed.length) return { restored: 0 };

  let restored = 0;
  for (const ch of followed) {
    try {
      const res = await api.addCreator({
        youtube_channel_id: ch.youtube_channel_id,
        auto_scan: false,
      });
      restored += 1;
      await afterCreatorAdded(res);
    } catch (e) {
      console.warn("restore failed", ch.handle || ch.youtube_channel_id, e.message);
    }
  }
  return { restored };
}
