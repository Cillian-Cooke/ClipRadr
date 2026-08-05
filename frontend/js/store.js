/** Persistent client cache + scan queue (survives navigation; helps on Vercel cold starts). */

const KEY = "clipradar:cache:v1";

const state = {
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
};

const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
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
    });
  } catch {
    /* ignore corrupt cache */
  }
}

function persist() {
  try {
    localStorage.setItem(
      KEY,
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
  } catch {
    /* quota */
  }
}

load();

export const store = {
  get() {
    return state;
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
    for (const c of state.creators) this.rememberChannel(c);
    state.lastSyncAt = Date.now();
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

  scanProgress() {
    const done = Object.keys(state.scanDone).length;
    const pending = state.scanQueue.length + (state.currentScanId ? 1 : 0);
    return { done, pending, busy: state.busy, current: state.currentScanId };
  },
};
