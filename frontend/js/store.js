/** Persistent client cache + scan queue (survives navigation; keyed per account). */

const BASE_KEY = "clipradar:cache:v1";
const ACCOUNT_KEY = "clipradar:cache:account";

const EMPTY_PERSIST = {
  followedChannels: [],
  creators: [],
  videosByCreator: {},
  videoById: {},
  momentsByVideo: {},
  home: null,
  opportunities: null,
  scanQueue: [],
  scanDone: {},
  scanErrors: {},
  lastSyncAt: null,
};

const state = {
  accountUid: null,
  followedChannels: [], // { youtube_channel_id, name, handle, thumbnail_url }
  creators: [],
  videosByCreator: {}, // creatorId -> { videos, fetchedAt }
  videoById: {},
  momentsByVideo: {}, // videoId -> { moments, fetchedAt }
  home: null,
  opportunities: null,
  status: null,
  scanQueue: [], // video ids
  scanDone: {}, // videoId -> true
  scanErrors: {},
  busy: false,
  currentScanId: null,
  lastSyncAt: null,
  dataRevision: 0,
  lastDataChange: null,
};

const listeners = new Set();

function storageKey(uid) {
  return uid ? `${BASE_KEY}:${uid}` : `${BASE_KEY}:guest`;
}

function applySaved(saved) {
  Object.assign(state, {
    followedChannels: saved.followedChannels || [],
    creators: saved.creators || [],
    videosByCreator: saved.videosByCreator || {},
    videoById: saved.videoById || {},
    momentsByVideo: saved.momentsByVideo || {},
    home: saved.home || null,
    opportunities: saved.opportunities || null,
    scanQueue: saved.scanQueue || [],
    scanDone: saved.scanDone || {},
    scanErrors: saved.scanErrors || {},
    lastSyncAt: saved.lastSyncAt || null,
    busy: false,
    currentScanId: null,
  });
}

function loadKey(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      applySaved(EMPTY_PERSIST);
      return;
    }
    applySaved(JSON.parse(raw));
  } catch {
    applySaved(EMPTY_PERSIST);
  }
}

function persist() {
  try {
    const key = storageKey(state.accountUid);
    localStorage.setItem(
      key,
      JSON.stringify({
        followedChannels: state.followedChannels,
        creators: state.creators,
        videosByCreator: state.videosByCreator,
        videoById: state.videoById,
        momentsByVideo: state.momentsByVideo,
        home: state.home,
        opportunities: state.opportunities,
        scanQueue: state.scanQueue,
        scanDone: state.scanDone,
        scanErrors: state.scanErrors,
        lastSyncAt: state.lastSyncAt,
      })
    );
    if (state.accountUid) {
      localStorage.setItem(ACCOUNT_KEY, state.accountUid);
    }
  } catch {
    /* quota */
  }
}

// Boot: prefer last signed-in account cache; otherwise guest (empty).
try {
  const lastUid = localStorage.getItem(ACCOUNT_KEY);
  state.accountUid = lastUid || null;
  loadKey(storageKey(state.accountUid));
} catch {
  applySaved(EMPTY_PERSIST);
}

export const store = {
  get() {
    return state;
  },

  /** Switch cache namespace when Firebase user changes — new accounts start empty. */
  bindAccount(uid) {
    const next = uid || null;
    if (state.accountUid === next) return false;
    persist();
    state.accountUid = next;
    loadKey(storageKey(next));
    // Fresh account / different user: never inherit another user's follows.
    if (!next) {
      applySaved(EMPTY_PERSIST);
    }
    state.dataRevision = (state.dataRevision || 0) + 1;
    state.lastDataChange = "account-switch";
    this.notify();
    return true;
  },

  clearWorkspace() {
    applySaved(EMPTY_PERSIST);
    this.notify();
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  notify() {
    persist();
    for (const fn of listeners) {
      try {
        fn(state);
      } catch {
        /* ignore */
      }
    }
  },

  rememberChannel(ch) {
    if (!ch?.youtube_channel_id) return;
    const rest = state.followedChannels.filter(
      (c) => c.youtube_channel_id !== ch.youtube_channel_id
    );
    state.followedChannels = [
      {
        youtube_channel_id: ch.youtube_channel_id,
        name: ch.name,
        handle: ch.handle,
        thumbnail_url: ch.thumbnail_url,
      },
      ...rest,
    ];
    this.notify();
  },

  forgetChannel(youtubeChannelId) {
    state.followedChannels = state.followedChannels.filter(
      (c) => c.youtube_channel_id !== youtubeChannelId
    );
    this.notify();
  },

  setCreators(creators) {
    state.creators = creators || [];
    // Authoritative server sync — followed list matches this account's follows.
    state.followedChannels = (creators || [])
      .filter((c) => c?.youtube_channel_id)
      .map((c) => ({
        youtube_channel_id: c.youtube_channel_id,
        name: c.name,
        handle: c.handle,
        thumbnail_url: c.thumbnail_url,
      }));
    state.lastSyncAt = Date.now();
    this.notify();
  },

  removeCreatorLocal(creator) {
    const id = creator?.id;
    const yt = creator?.youtube_channel_id;
    state.creators = (state.creators || []).filter((c) => c.id !== id);
    if (yt) {
      state.followedChannels = state.followedChannels.filter(
        (c) => c.youtube_channel_id !== yt
      );
    }
    if (id != null) {
      const vids = state.videosByCreator[id]?.videos || [];
      for (const v of vids) {
        delete state.videoById[v.id];
        delete state.momentsByVideo[v.id];
        delete state.scanDone[v.id];
        delete state.scanErrors[v.id];
        state.scanQueue = state.scanQueue.filter((qid) => qid !== v.id);
      }
      delete state.videosByCreator[id];
    }
    // Drop cached home/opportunities so UI doesn't show removed creator moments.
    state.home = null;
    state.opportunities = null;
    this.notify();
  },

  setCreatorVideos(creatorId, videos) {
    state.videosByCreator[creatorId] = { videos: videos || [], fetchedAt: Date.now() };
    for (const v of videos || []) {
      state.videoById[v.id] = v;
    }
    this.notify();
  },

  setVideo(video) {
    if (!video?.id) return;
    state.videoById[video.id] = video;
    this.notify();
  },

  setMoments(videoId, moments) {
    state.momentsByVideo[videoId] = { moments: moments || [], fetchedAt: Date.now() };
    this.notify();
  },

  setHome(data) {
    state.home = data;
    this.notify();
  },

  setOpportunities(data) {
    state.opportunities = data;
    this.notify();
  },

  setStatus(data) {
    state.status = data;
    this.notify();
  },

  enqueueScans(videoIds, { front = false } = {}) {
    const ids = (videoIds || []).map(Number).filter(Boolean);
    for (const id of ids) {
      if (state.scanDone[id]) continue;
      if (state.scanQueue.includes(id)) continue;
      if (front) state.scanQueue.unshift(id);
      else state.scanQueue.push(id);
    }
    this.notify();
  },

  markScanned(videoId) {
    state.scanDone[videoId] = true;
    state.scanQueue = state.scanQueue.filter((id) => id !== videoId);
    delete state.scanErrors[videoId];
    if (state.currentScanId === videoId) state.currentScanId = null;
    this.notify();
  },

  markScanError(videoId, message) {
    state.scanErrors[videoId] = message || "Scan failed";
    state.scanQueue = state.scanQueue.filter((id) => id !== videoId);
    if (state.currentScanId === videoId) state.currentScanId = null;
    this.notify();
  },

  /** Drop stale scan history (e.g. after Vercel wiped the server DB). */
  resetScanHistory() {
    state.scanQueue = [];
    state.scanDone = {};
    state.scanErrors = {};
    state.busy = false;
    state.currentScanId = null;
    this.notify();
  },

  scanProgress() {
    const done = Object.keys(state.scanDone).length;
    const pending = state.scanQueue.length + (state.currentScanId ? 1 : 0);
    return { done, pending, busy: state.busy, current: state.currentScanId };
  },

  bumpData(reason = "update") {
    state.dataRevision = (state.dataRevision || 0) + 1;
    state.lastDataChange = reason;
    state.lastSyncAt = Date.now();
    this.notify();
  },
};
