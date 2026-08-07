/** Pull fresh workspace data and bump the live revision so open pages repaint. */

import { api } from "./api.js";
import { store } from "/js/store.js";

let refreshing = false;
let pending = null;

export async function refreshWorkspace(opts = {}) {
  const { creatorId = null } = opts;
  if (refreshing) {
    pending = { creatorId: creatorId || pending?.creatorId || null };
    return;
  }
  refreshing = true;
  try {
    const tasks = [
      api.creators().then((d) => store.setCreators(d.creators || [])).catch(() => null),
      api.home().then((d) => store.setHome(d)).catch(() => null),
      api.opportunities({}).then((d) => store.setOpportunities(d)).catch(() => null),
    ];
    if (creatorId) {
      tasks.push(
        api
          .creatorVideos(creatorId)
          .then((d) => store.setCreatorVideos(creatorId, d.videos || []))
          .catch(() => null)
      );
      tasks.push(
        api
          .creator(creatorId)
          .then((c) => {
            const list = store.get().creators || [];
            const next = list.map((x) => (String(x.id) === String(creatorId) ? { ...x, ...c } : x));
            if (!next.find((x) => String(x.id) === String(creatorId))) next.unshift(c);
            store.setCreators(next);
          })
          .catch(() => null)
      );
    }
    await Promise.all(tasks);
    // If the server forgot everything (cold start), drop stale scan IDs and
    // stop showing a fake "N scanned" count from a previous instance.
    if (!(store.get().creators || []).length) {
      store.resetScanHistory();
    }
    store.bumpData("workspace-refresh");
  } finally {
    refreshing = false;
    if (pending) {
      const next = pending;
      pending = null;
      refreshWorkspace(next);
    }
  }
}
