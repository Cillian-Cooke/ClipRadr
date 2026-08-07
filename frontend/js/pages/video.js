import { api, formatTime, downloadAuthed } from "../api.js";
import { navigate } from "../router.js";
import { el, loading, error } from "../components/Sidebar.js";
import { store } from "/js/store.js";

const MAX_CLIP_SECONDS = 120;
const DEFAULT_CLIP_SECONDS = 30;
/** Pull clip start back so the flagged moment isn't the first frame. */
const CLIP_LEAD_IN_SECONDS = 5;
const YT_ASPECT = "16:9";
const YT_WIDTH = 1920;
const YT_HEIGHT = 1080;

export async function renderVideo(root, id) {
  const cached = store.get().videoById?.[id];
  const cachedMoments = store.get().momentsByVideo?.[id]?.moments;
  let paintedFromCache = false;

  if (cached && Array.isArray(cachedMoments) && cachedMoments.length) {
    try {
      mountWorkspace(root, normalizeVideo(cached), sortMoments(cachedMoments), {
        fromCache: true,
      });
      paintedFromCache = true;
    } catch {
      paintedFromCache = false;
    }
  }

  if (!paintedFromCache) {
    root.replaceChildren(loading("Opening video workspace…"));
  }

  try {
    const [video, momentsRes] = await Promise.all([
      api.video(id),
      api.videoMoments(id),
    ]);
    const moments = sortMoments(momentsRes.moments || []);
    store.setVideo(video);
    store.setMoments(id, moments);
    mountWorkspace(root, video, moments, { fromCache: false });
  } catch (e) {
    if (!paintedFromCache) root.replaceChildren(error(e.message));
    else flash(`Refresh failed: ${e.message}`);
  }
}

function sortMoments(moments) {
  return [...(moments || [])].sort(
    (a, b) => a.representative_timestamp - b.representative_timestamp
  );
}

function normalizeVideo(video) {
  // Cached list rows may lack playback fields — fill sensible defaults.
  return {
    ...video,
    embed_video_id:
      video.embed_video_id ??
      (video.media_mode === "demo" ? null : video.youtube_video_id),
    playback_mode:
      video.playback_mode ||
      (video.media_mode === "demo" && video.has_source_media ? "local" : "youtube"),
    source_media: video.source_media || null,
  };
}

function pickPreferredMoment(moments) {
  const preferred = new URLSearchParams(window.location.search).get("moment");
  if (preferred) {
    return moments.find((m) => String(m.id) === String(preferred)) || moments[0] || null;
  }
  return [...moments].sort((a, b) => b.score - a.score)[0] || null;
}

let _activeWorkspace = null;

function mountWorkspace(root, video, moments, { fromCache = false } = {}) {
  // Soft-refresh after cache paint: keep the player (especially YouTube iframe) alive.
  if (
    _activeWorkspace?.root === root &&
    String(_activeWorkspace.state.video?.id) === String(video.id) &&
    !fromCache &&
    _activeWorkspace.state.fromCache
  ) {
    const state = _activeWorkspace.state;
    const nowLocal = video.playback_mode === "local" && !!video.source_media?.stream_url;
    const wasLocal = state.player?.type === "html5";
    if (nowLocal === wasLocal) {
      softRefreshWorkspace(state, video, moments);
      return;
    }
  }

  if (_activeWorkspace?.keydownHandler) {
    window.removeEventListener("keydown", _activeWorkspace.keydownHandler);
  }

  const state = {
    video,
    moments,
    selected: null,
    detail: null,
    clipStart: 0,
    clipEnd: 0,
    duration: video.duration_seconds || 1,
    fileDuration: null,
    player: null,
    clipStopHandler: null,
    previewing: false,
    _momentFetch: 0,
    fromCache,
  };

  state.selected = pickPreferredMoment(moments);
  if (state.selected) applyMomentBounds(state, state.selected);

  const workspace = el("div", { class: "video-workspace" });
  const left = el("div", { class: "workspace-left" });
  const right = el("div", { class: "workspace-right" });
  workspace.append(left, right);
  root.replaceChildren(workspace);

  buildPlayer(left, state);
  buildTimeline(left, state);
  buildClipBar(left, state);
  buildRightPanel(right, state);

  if (state.selected) {
    selectMoment(state, state.selected.id, { seek: true, play: false });
  } else {
    refreshPanels(state);
  }

  const keydownHandler = bindShortcuts(state);
  _activeWorkspace = { root, state, keydownHandler };
}

function softRefreshWorkspace(state, video, moments) {
  state.video = video;
  state.moments = moments;
  state.duration = video.duration_seconds || state.duration;
  state.fromCache = false;

  const prevId = state.selected?.id;
  state.selected =
    (prevId && moments.find((m) => m.id === prevId)) || pickPreferredMoment(moments);
  if (state.selected) applyMomentBounds(state, state.selected);

  rebuildTimelineMarkers(state);
  if (state.selected) {
    selectMoment(state, state.selected.id, { seek: false, play: false });
  } else {
    refreshPanels(state);
  }
}

function rebuildTimelineMarkers(state) {
  const markers = state.ui?.markers;
  if (!markers) return;
  markers.replaceChildren();
  for (const m of state.moments) {
    const pct = (m.representative_timestamp / state.duration) * 100;
    const marker = el("button", {
      class: `timeline-marker ${m.confidence}`,
      style: `left:${pct}%`,
      title: `${m.representative_label} · ${m.topic || ""}`,
      onclick: (e) => {
        e.stopPropagation();
        selectMoment(state, m.id, { seek: true, play: false });
      },
    });
    marker.dataset.momentId = m.id;
    markers.append(marker);
  }
  const badge = state.ui?.momentBadge;
  if (badge) badge.textContent = `${state.moments.length} moments`;
}

function applyMomentBounds(state, moment) {
  const rep = Number(moment.representative_timestamp) || 0;
  const leadStart = Math.max(0, rep - CLIP_LEAD_IN_SECONDS);
  let start = Number(moment.start_seconds);
  let end = Number(moment.end_seconds);
  let dur = end - start;

  if (!Number.isFinite(start) || !Number.isFinite(end) || dur <= 0 || dur > MAX_CLIP_SECONDS) {
    dur = Math.min(DEFAULT_CLIP_SECONDS, MAX_CLIP_SECONDS);
    start = leadStart;
    end = Math.min(state.duration, start + dur);
    start = Math.max(0, end - dur);
  } else if (start > leadStart) {
    // Existing moments / tight bounds: still give ~5s of lead-in before the flag.
    start = leadStart;
    if (end - start > MAX_CLIP_SECONDS) {
      end = Math.min(state.duration, start + MAX_CLIP_SECONDS);
    }
  }

  state.clipStart = Math.max(0, start);
  state.clipEnd = Math.min(state.duration, Math.max(end, state.clipStart + 1));
}

function playbackDuration(state) {
  if (state.player?.type === "html5" && state.fileDuration) return state.fileDuration;
  return state.duration;
}

function mapToFileTime(state, t) {
  const fileDur = state.fileDuration;
  if (!fileDur || t <= fileDur) return Math.max(0, t);
  if (t < 120) return Math.min(t, fileDur - 0.05);
  return t % Math.max(1, Math.floor(fileDur - 1));
}

function clearClipPlayback(state) {
  if (state.clipStopHandler && state.player?.el) {
    state.player.el.removeEventListener("timeupdate", state.clipStopHandler);
  }
  state.clipStopHandler = null;
  state.previewing = false;
  state.ui?.previewBtn?.classList.remove("is-playing");
  if (state.ui?.previewBtn) state.ui.previewBtn.textContent = "Preview clip";
}

function buildPlayer(left, state) {
  const stage = el("div", { class: "player-stage" });
  const momentBadge = el("span", { class: "badge", text: `${state.moments.length} moments` });
  const meta = el("div", { class: "workspace-meta" }, [
    el("div", {}, [
      el("div", { class: "muted", text: state.video.creator?.name || "" }),
      el("h1", { text: state.video.title }),
    ]),
    momentBadge,
  ]);
  state.ui = { ...(state.ui || {}), momentBadge };

  const frame = el("div", { class: "player-frame ratio-16x9" });
  const overlay = el("div", { class: "preview-overlay", style: "display:none;" });
  overlay.append(el("span", { class: "preview-pill", text: "Previewing clip" }));
  frame.append(overlay);
  state.ui = { ...(state.ui || {}), previewOverlay: overlay };

  if (state.video.playback_mode === "local" && state.video.source_media?.stream_url) {
    const videoEl = el("video", {
      controls: true,
      playsinline: true,
      src: state.video.source_media.stream_url,
    });
    videoEl.addEventListener("loadedmetadata", () => {
      if (videoEl.duration && isFinite(videoEl.duration)) {
        state.fileDuration = videoEl.duration;
        updateClipRange(state);
        updateClipLabel(state);
      }
    });
    videoEl.addEventListener("timeupdate", () => {
      updatePlayhead(state);
      updateScrubberPlayhead(state);
    });
    videoEl.addEventListener("seeked", () => {
      updatePlayhead(state);
      updateScrubberPlayhead(state);
    });
    videoEl.addEventListener("pause", () => {
      if (state.previewing && !state.clipStopHandler) {
        // natural pause
      }
    });
    frame.append(videoEl);

    state.player = {
      type: "html5",
      el: videoEl,
      seekTo(t, play = true) {
        clearClipPlayback(state);
        hidePreviewOverlay(state);
        const max = playbackDuration(state);
        videoEl.currentTime = Math.min(Math.max(0, mapToFileTime(state, t)), max - 0.05);
        if (play) videoEl.play().catch(() => {});
        else videoEl.pause();
        updatePlayhead(state);
        updateScrubberPlayhead(state);
      },
      getCurrent() {
        return videoEl.currentTime || 0;
      },
      toggle() {
        clearClipPlayback(state);
        hidePreviewOverlay(state);
        if (videoEl.paused) videoEl.play().catch(() => {});
        else videoEl.pause();
      },
      playClip(start, end) {
        clearClipPlayback(state);
        const fileStart = mapToFileTime(state, start);
        let fileEnd = mapToFileTime(state, end);
        const max = playbackDuration(state);
        if (fileEnd <= fileStart) {
          fileEnd = Math.min(max, fileStart + Math.max(1, end - start));
        }
        fileEnd = Math.min(max, fileEnd);

        state.previewing = true;
        showPreviewOverlay(state);
        if (state.ui?.previewBtn) {
          state.ui.previewBtn.textContent = "Stop preview";
          state.ui.previewBtn.classList.add("is-playing");
        }

        const onTime = () => {
          updatePlayhead(state);
          updateScrubberPlayhead(state);
          if (videoEl.currentTime >= fileEnd - 0.04) {
            videoEl.pause();
            clearClipPlayback(state);
            hidePreviewOverlay(state);
            videoEl.currentTime = fileStart;
            updatePlayhead(state);
            updateScrubberPlayhead(state);
          }
        };
        state.clipStopHandler = onTime;
        videoEl.addEventListener("timeupdate", onTime);

        const startPlay = () => videoEl.play().catch(() => {});
        const onSeeked = () => {
          videoEl.removeEventListener("seeked", onSeeked);
          startPlay();
        };
        videoEl.addEventListener("seeked", onSeeked);
        videoEl.currentTime = Math.min(Math.max(0, fileStart), max - 0.05);
        if (Math.abs(videoEl.currentTime - fileStart) < 0.2) {
          videoEl.removeEventListener("seeked", onSeeked);
          startPlay();
        }
      },
    };
  } else {
    const ytId = state.video.embed_video_id || state.video.youtube_video_id;
    if (ytId && !String(ytId).startsWith("demo_")) {
      const initialStart = Math.max(
        0,
        Math.floor(state.selected?.representative_timestamp || state.clipStart || 0)
      );
      state._ytTime = initialStart;
      const iframe = el("iframe", {
        src: `https://www.youtube.com/embed/${ytId}?start=${initialStart}&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`,
        allow:
          "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen",
        allowfullscreen: true,
        title: state.video.title,
      });
      frame.append(iframe);

      const ytCmd = (func, args = []) => {
        try {
          iframe.contentWindow?.postMessage(
            JSON.stringify({ event: "command", func, args }),
            "*"
          );
        } catch {
          /* cross-origin / not ready */
        }
      };

      // Tell the embed we want command events (enables seek without reload).
      iframe.addEventListener("load", () => {
        try {
          iframe.contentWindow?.postMessage(
            JSON.stringify({ event: "listening", id: 1 }),
            "*"
          );
        } catch {
          /* ignore */
        }
      });

      state.player = {
        type: "youtube",
        el: iframe,
        seekTo(t, play = true) {
          clearClipPlayback(state);
          hidePreviewOverlay(state);
          const sec = Math.max(0, Math.floor(t));
          state._ytTime = sec;
          // Prefer in-player seek (no cold reload). Fallback to src once if needed.
          if (iframe.contentWindow) {
            ytCmd("seekTo", [sec, true]);
            if (play) ytCmd("playVideo");
            else ytCmd("pauseVideo");
          } else {
            iframe.src = `https://www.youtube.com/embed/${ytId}?start=${sec}&autoplay=${play ? 1 : 0}&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`;
          }
          updatePlayhead(state);
          updateScrubberPlayhead(state);
        },
        getCurrent() {
          return state._ytTime || 0;
        },
        toggle() {
          ytCmd("playVideo");
        },
        playClip(start) {
          showPreviewOverlay(state);
          this.seekTo(start, true);
        },
      };
    } else {
      frame.append(
        el("div", { class: "player-fallback" }, [
          el("div", {}, [
            el("div", {
              style: "font-size:16px;margin-bottom:8px;",
              text: "No local source for this video",
            }),
            el("p", { class: "muted", text: "Open the demo VOD for playback and export." }),
            el("button", {
              class: "btn btn-primary",
              style: "margin-top:12px;",
              text: "Open demo VOD",
              onclick: () => navigate("/video/1"),
            }),
          ]),
        ])
      );
      state.player = {
        type: "none",
        seekTo(t) {
          state._ytTime = t;
          updatePlayhead(state);
        },
        getCurrent() {
          return state._ytTime || 0;
        },
        toggle() {},
        playClip(start) {
          this.seekTo(start);
        },
      };
    }
  }

  stage.append(meta, frame);
  left.append(stage);
}

function showPreviewOverlay(state) {
  if (state.ui?.previewOverlay) state.ui.previewOverlay.style.display = "flex";
}

function hidePreviewOverlay(state) {
  if (state.ui?.previewOverlay) state.ui.previewOverlay.style.display = "none";
}

function buildTimeline(left, state) {
  const panel = el("div", { class: "timeline-panel" });
  const header = el("div", { class: "timeline-header" }, [
    el("div", { class: "section-title", text: "Timeline", style: "margin:0;" }),
    el("div", { class: "clip-range-label mono", text: clipRangeLabel(state) }),
  ]);

  const timeline = el("div", { class: "timeline" });
  const track = el("div", { class: "timeline-track" });
  const progress = el("div", { class: "timeline-progress" });
  track.append(progress);
  const playhead = el("div", { class: "timeline-playhead" });
  const markers = el("div", { class: "timeline-markers" });
  const clipRange = el("div", { class: "clip-range" });
  const clipStartMark = el("div", { class: "clip-edge start" });
  const clipEndMark = el("div", { class: "clip-edge end" });
  timeline.append(track, clipRange, clipStartMark, clipEndMark, markers, playhead);

  for (const m of state.moments) {
    const pct = (m.representative_timestamp / state.duration) * 100;
    const marker = el("button", {
      class: `timeline-marker ${m.confidence}`,
      style: `left:${pct}%`,
      title: `${m.representative_label} · ${m.topic || ""}`,
      onclick: (e) => {
        e.stopPropagation();
        selectMoment(state, m.id, { seek: true, play: false });
      },
    });
    marker.dataset.momentId = m.id;
    markers.append(marker);
  }

  timeline.addEventListener("click", (e) => {
    if (e.target.closest(".timeline-marker")) return;
    const rect = timeline.getBoundingClientRect();
    const x = (e.clientX - rect.left - 12) / (rect.width - 24);
    const t = Math.max(0, Math.min(1, x)) * state.duration;
    state.player.seekTo(t, true);
  });

  panel.append(
    header,
    timeline,
    el("div", { class: "timeline-labels" }, [
      el("span", { text: "0:00" }),
      el("span", { text: formatTime(Math.floor(state.duration / 2)) }),
      el("span", { text: formatTime(state.duration) }),
    ])
  );
  left.append(panel);

  state.ui = {
    ...(state.ui || {}),
    timeline,
    progress,
    playhead,
    clipRange,
    clipStartMark,
    clipEndMark,
    markers,
    clipRangeLabel: header.querySelector(".clip-range-label"),
  };
  updateClipRange(state);
}

function clipRangeLabel(state) {
  if (!state.selected) return "Select a moment";
  const dur = Math.max(0, Math.round(state.clipEnd - state.clipStart));
  return `${formatTime(state.clipStart)} → ${formatTime(state.clipEnd)} · ${dur}s`;
}

function buildClipBar(left, state) {
  const bar = el("div", { class: "clip-editor-bar" });
  left.append(bar);
  state.ui = { ...(state.ui || {}), editorHost: bar };
}

function buildRightPanel(right, state) {
  const body = el("div", { class: "panel-body audience-panel" });
  right.append(body);
  state.ui = { ...(state.ui || {}), rightBody: body };
}

function refreshPanels(state) {
  renderAudiencePanel(state);
  renderClipBar(state);
  updateClipRange(state);
}

function renderAudiencePanel(state) {
  const body = state.ui.rightBody;
  body.replaceChildren();

  body.append(el("div", { class: "section-title", text: "Moments" }));
  const list = el("div", { class: "moment-list compact" });
  for (const m of [...state.moments].sort((a, b) => b.score - a.score)) {
    list.append(
      el("button", {
        class: `moment-item ${state.selected?.id === m.id ? "active" : ""}`,
        onclick: () => selectMoment(state, m.id, { seek: true, play: false }),
      }, [
        el("div", { class: "row" }, [
          el("strong", { class: "mono", text: m.representative_label }),
          el("span", { class: "score", text: String(m.score) }),
        ]),
        el("div", {
          class: "muted",
          style: "margin-top:2px;font-size:11px;",
          text: `${m.unique_commenters} viewers · ${m.topic || "MOMENT"}`,
        }),
      ])
    );
  }
  body.append(list);

  if (!state.selected) {
    body.append(
      el("div", {
        class: "empty-state",
        style: "padding:24px 8px;",
        text: "Pick a moment to see audience reactions.",
      })
    );
    return;
  }

  const m = state.detail || state.selected;
  body.append(
    el("div", { class: "section-title", text: "Audience", style: "margin-top:18px;" }),
    el("p", {
      class: "muted",
      style: "margin:0 0 10px;",
      text: `${m.unique_commenters || 0} viewers flagged ${formatTime(m.representative_timestamp)}`,
    })
  );

  const comments = m.comments || [];
  if (!comments.length) {
    body.append(el("div", { class: "empty-state", style: "padding:16px 8px;", text: "No comments yet." }));
    return;
  }

  const commentList = el("div", { class: "comment-list" });
  for (const c of comments) {
    commentList.append(
      el("button", {
        class: "comment-item",
        onclick: () => {
          if (c.timestamp_seconds != null) state.player.seekTo(c.timestamp_seconds, true);
        },
      }, [
        el("div", {
          class: "author",
          text: `${c.author_name}${c.timestamp_label ? " · " + c.timestamp_label : ""}`,
        }),
        el("div", { text: c.text }),
        el("div", { class: "likes", text: `${c.like_count} likes` }),
      ])
    );
  }
  body.append(commentList);
}

function renderClipBar(state) {
  const host = state.ui.editorHost;
  host.replaceChildren();

  if (!state.selected) {
    host.classList.add("is-empty");
    host.append(el("div", { class: "clip-editor-empty muted", text: "Select a moment to set the clip." }));
    return;
  }
  host.classList.remove("is-empty");

  const dur = Math.max(0, Math.round((state.clipEnd - state.clipStart) * 10) / 10);
  host.append(
    el("div", { class: "clip-editor-top" }, [
      el("div", {}, [
        el("div", { class: "section-title", text: "Clip", style: "margin:0 0 4px;" }),
        el("div", {
          class: "mono clip-dur",
          text: `${formatTime(state.clipStart)} → ${formatTime(state.clipEnd)} · ${dur}s`,
        }),
      ]),
      el("div", { class: "dim", style: "font-size:12px;", text: "Drag handles to trim · max 2 min" }),
    ])
  );

  host.append(buildClipScrubber(state));

  const previewBtn = el("button", {
    class: "btn btn-primary",
    text: state.previewing ? "Stop preview" : "Preview clip",
    onclick: () => {
      if (state.previewing) {
        clearClipPlayback(state);
        hidePreviewOverlay(state);
        state.player?.el?.pause?.();
        return;
      }
      playPreview(state);
    },
  });
  if (state.previewing) previewBtn.classList.add("is-playing");

  host.append(
    el("div", { class: "action-row tight", style: "margin-top:12px;" }, [
      previewBtn,
      el("button", {
        class: "btn",
        text: "Save",
        onclick: () => saveCurrent(state),
      }),
      el("button", {
        class: "btn btn-primary",
        text: "Export MP4",
        onclick: () => openExportModal(state),
      }),
    ])
  );

  state.ui.previewBtn = previewBtn;
}

function buildClipScrubber(state) {
  const pad = Math.max(20, (state.clipEnd - state.clipStart) * 1.5);
  const winStart = Math.max(0, state.clipStart - pad);
  const winEnd = Math.min(state.duration, state.clipEnd + pad);
  const winSpan = Math.max(1, winEnd - winStart);
  state._scrubWin = { winStart, winEnd, winSpan };

  const wrap = el("div", { class: "clip-scrubber-wrap" });
  const scrubber = el("div", { class: "clip-scrubber" });
  const span = el("div", { class: "mini-span" });
  const startHandle = el("div", { class: "mini-handle", title: "Clip start" });
  const endHandle = el("div", { class: "mini-handle", title: "Clip end" });
  const momentMark = el("div", { class: "scrubber-moment", title: "Moment" });
  const localPlayhead = el("div", { class: "scrubber-playhead" });

  function paint() {
    const left = ((state.clipStart - winStart) / winSpan) * 100;
    const right = ((state.clipEnd - winStart) / winSpan) * 100;
    span.style.left = `${left}%`;
    span.style.width = `${Math.max(right - left, 0.8)}%`;
    startHandle.style.left = `calc(${left}% - 5px)`;
    endHandle.style.left = `calc(${right}% - 5px)`;
    momentMark.style.left = `${((state.selected.representative_timestamp - winStart) / winSpan) * 100}%`;
  }
  paint();

  function drag(handleKey, e) {
    e.preventDefault();
    e.stopPropagation();
    const onMove = (ev) => {
      const rect = scrubber.getBoundingClientRect();
      const x = (ev.clientX - rect.left) / rect.width;
      let t = winStart + Math.max(0, Math.min(1, x)) * winSpan;
      if (handleKey === "clipStart") {
        t = Math.min(t, state.clipEnd - 1);
        if (state.clipEnd - t > MAX_CLIP_SECONDS) t = state.clipEnd - MAX_CLIP_SECONDS;
        state.clipStart = Math.max(0, t);
      } else {
        t = Math.max(t, state.clipStart + 1);
        if (t - state.clipStart > MAX_CLIP_SECONDS) t = state.clipStart + MAX_CLIP_SECONDS;
        state.clipEnd = Math.min(state.duration, t);
      }
      paint();
      updateClipRange(state);
      updateClipLabel(state);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      renderClipBar(state);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  startHandle.addEventListener("pointerdown", (e) => drag("clipStart", e));
  endHandle.addEventListener("pointerdown", (e) => drag("clipEnd", e));
  scrubber.addEventListener("click", (e) => {
    if (e.target.classList.contains("mini-handle")) return;
    const rect = scrubber.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const t = winStart + Math.max(0, Math.min(1, x)) * winSpan;
    state.player.seekTo(t, true);
  });

  scrubber.append(span, momentMark, localPlayhead, startHandle, endHandle);
  wrap.append(scrubber);
  wrap.append(
    el("div", { class: "timeline-labels" }, [
      el("span", { text: formatTime(winStart) }),
      el("span", { text: "IN  ← drag →  OUT" }),
      el("span", { text: formatTime(winEnd) }),
    ])
  );

  state.ui.scrubberPlayhead = localPlayhead;
  state.ui.scrubber = scrubber;
  updateScrubberPlayhead(state);
  return wrap;
}

function updateScrubberPlayhead(state) {
  const ph = state.ui?.scrubberPlayhead;
  const win = state._scrubWin;
  if (!ph || !win || !state.player) return;
  let t = state.player.getCurrent();
  // Map file time into labeled window when possible
  if (state.player.type === "html5" && state.fileDuration && state.duration > state.fileDuration) {
    // keep as file time if clip is early; otherwise approximate
    if (state.clipStart < state.fileDuration) t = state.player.getCurrent();
  }
  if (t < win.winStart || t > win.winEnd) {
    ph.style.display = "none";
    return;
  }
  ph.style.display = "block";
  ph.style.left = `${((t - win.winStart) / win.winSpan) * 100}%`;
}

function playPreview(state) {
  if (!state.selected || !state.player) return;
  state.player.playClip(state.clipStart, state.clipEnd);
}

function updateClipLabel(state) {
  if (state.ui?.clipRangeLabel) state.ui.clipRangeLabel.textContent = clipRangeLabel(state);
  const durEl = state.ui?.editorHost?.querySelector(".clip-dur");
  if (durEl && state.selected) {
    const dur = Math.max(0, Math.round((state.clipEnd - state.clipStart) * 10) / 10);
    durEl.textContent = `${formatTime(state.clipStart)} → ${formatTime(state.clipEnd)} · ${dur}s`;
  }
}

async function selectMoment(state, momentId, { seek = true, play = false } = {}) {
  const basic = state.moments.find((m) => m.id === momentId);
  if (!basic) return;
  clearClipPlayback(state);
  hidePreviewOverlay(state);
  state.selected = basic;
  applyMomentBounds(state, basic);
  // Paint immediately from list data — don't wait on comments.
  state.detail = { ...basic, comments: basic.comments || [] };

  state.ui.markers?.querySelectorAll(".timeline-marker").forEach((node) => {
    node.classList.toggle("active", node.dataset.momentId === String(momentId));
  });

  if (seek) state.player.seekTo(state.clipStart, play);
  refreshPanels(state);

  const fetchId = ++state._momentFetch;
  try {
    const res = await api.momentComments(momentId);
    if (fetchId !== state._momentFetch || state.selected?.id !== momentId) return;
    state.detail = { ...basic, comments: res.comments || [] };
    renderAudiencePanel(state);
  } catch {
    /* keep list-only detail */
  }
}

function updateClipRange(state) {
  if (!state.ui?.clipRange) return;
  const left = (state.clipStart / state.duration) * 100;
  const width = Math.max((state.clipEnd - state.clipStart) / state.duration, 0.0015) * 100;
  state.ui.clipRange.style.left = `calc(12px + (100% - 24px) * ${left / 100})`;
  state.ui.clipRange.style.width = `calc((100% - 24px) * ${width / 100})`;
  if (state.ui.clipStartMark) {
    state.ui.clipStartMark.style.left = `calc(12px + (100% - 24px) * ${left / 100})`;
  }
  if (state.ui.clipEndMark) {
    state.ui.clipEndMark.style.left = `calc(12px + (100% - 24px) * ${state.clipEnd / state.duration})`;
  }
  updateClipLabel(state);
}

function updatePlayhead(state) {
  if (!state.ui?.playhead || !state.player) return;
  const t = state.player.getCurrent();
  const pct = Math.max(0, Math.min(1, t / state.duration));
  state.ui.playhead.style.left = `calc(12px + (100% - 24px) * ${pct})`;
  if (state.ui.progress) state.ui.progress.style.width = `${pct * 100}%`;
}

async function saveCurrent(state) {
  if (!state.selected) return;
  try {
    await api.saveClip({
      moment_id: state.selected.id,
      start_seconds: state.clipStart,
      end_seconds: state.clipEnd,
      aspect_ratio: YT_ASPECT,
      width: YT_WIDTH,
      height: YT_HEIGHT,
      crop_position: "CENTER",
      notes: "",
    });
    flash("Saved");
  } catch (e) {
    flash(e.message);
  }
}

function openExportModal(state) {
  const hasLocal = !!state.video.has_source_media;
  const hasYt = !!state.video.youtube_video_id;
  if (!hasLocal && !hasYt) {
    flash("This video has no local source and no YouTube id — cannot export.");
    return;
  }

  const backdrop = el("div", { class: "modal-backdrop" });
  const progress = el("div", { class: "progress-bar" }, [el("span")]);
  const status = el("div", {
    class: "muted",
    text: hasLocal
      ? "Ready — will cut from local source."
      : "Ready — will auto-fetch this range from YouTube (yt-dlp).",
  });
  const downloadBtn = el("button", {
    class: "btn btn-primary",
    text: "Download Clip",
    style: "display:none;",
  });
  let downloadUrl = null;
  downloadBtn.addEventListener("click", async () => {
    if (!downloadUrl) return;
    downloadBtn.disabled = true;
    downloadBtn.textContent = "Downloading…";
    try {
      await downloadAuthed(downloadUrl, `clipradar_${state.video.id}_${Math.round(state.clipStart)}.mp4`);
      downloadBtn.textContent = "Download Clip";
      downloadBtn.disabled = false;
    } catch (err) {
      status.textContent = err.message;
      downloadBtn.textContent = "Download Clip";
      downloadBtn.disabled = false;
    }
  });
  const dur = Math.round(state.clipEnd - state.clipStart);

  const modal = el("div", { class: "modal" }, [
    el("h2", { text: "Export clip" }),
    el("p", {
      text: hasLocal
        ? "YouTube 1920×1080 MP4 from the selected range (local source)."
        : "Fetches only the selected range from YouTube, then encodes 1920×1080 MP4.",
    }),
    el("div", { class: "export-summary" }, [
      summary("Range", `${formatTime(state.clipStart)} → ${formatTime(state.clipEnd)}`),
      summary("Duration", `${dur}s`),
      summary("Source", hasLocal ? "Local file" : "YouTube (auto)"),
      summary("Size", "1920 × 1080"),
    ]),
    progress,
    status,
    el("div", { class: "modal-actions" }, [
      el("button", { class: "btn", text: "Close", onclick: () => backdrop.remove() }),
      downloadBtn,
      el("button", {
        class: "btn btn-primary",
        text: "Generate",
        onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          status.textContent = hasLocal ? "Encoding…" : "Fetching clip from YouTube…";
          progress.firstChild.style.width = "15%";
          try {
            let start = state.clipStart;
            let end = state.clipEnd;
            if (hasLocal) {
              start = mapToFileTime(state, state.clipStart);
              end = mapToFileTime(state, state.clipEnd);
              if (state.fileDuration) {
                if (end <= start) end = Math.min(state.fileDuration, start + Math.max(1, dur));
                end = Math.min(end, state.fileDuration);
                start = Math.min(start, end - 0.5);
              }
            }
            let job = await api.exportClip({
              video_id: state.video.id,
              moment_id: state.selected?.id,
              start_seconds: start,
              end_seconds: end,
              aspect_ratio: YT_ASPECT,
              width: YT_WIDTH,
              height: YT_HEIGHT,
              crop_position: "CENTER",
            });
            while (job.status === "QUEUED" || job.status === "PROCESSING") {
              await sleep(450);
              job = await api.exportStatus(job.id);
              const p = Math.max(job.progress || 0, 12);
              progress.firstChild.style.width = `${p}%`;
              if (!hasLocal) {
                if (p < 35) status.textContent = `Fetching clip from YouTube… ${p}%`;
                else if (p < 75) status.textContent = `Downloading section… ${p}%`;
                else if (p < 100) status.textContent = `Finalizing MP4… ${p}%`;
                else status.textContent = `Almost done… ${p}%`;
              } else {
                status.textContent = `Encoding… ${p}%`;
              }
            }
            if (job.status === "COMPLETED") {
              progress.firstChild.style.width = "100%";
              status.textContent = "Ready.";
              downloadBtn.style.display = "inline-flex";
              downloadUrl = job.download_url;
            } else {
              status.textContent = job.error || "Export failed.";
              btn.disabled = false;
            }
          } catch (err) {
            status.textContent = err.message;
            btn.disabled = false;
          }
        },
      }),
    ]),
  ]);
  backdrop.append(modal);
  document.body.append(backdrop);
}

function summary(k, v) {
  return el("div", {}, [
    el("div", { class: "k", text: k }),
    el("div", { class: "v", text: v }),
  ]);
}

function flash(msg) {
  let bar = document.getElementById("cr-toast");
  if (!bar) {
    bar = el("div", { id: "cr-toast", class: "toast" });
    document.body.append(bar);
  }
  bar.textContent = msg;
  clearTimeout(bar._t);
  bar._t = setTimeout(() => bar.remove(), 2200);
}

function bindShortcuts(state) {
  const handler = (e) => {
    if (e.target.matches("input, textarea")) return;
    if (e.key === " " || e.code === "Space") {
      e.preventDefault();
      if (state.previewing) {
        clearClipPlayback(state);
        hidePreviewOverlay(state);
        state.player?.el?.pause?.();
      } else {
        playPreview(state);
      }
    } else if (e.key === "ArrowLeft") {
      state.player.seekTo(state.player.getCurrent() - 5, false);
    } else if (e.key === "ArrowRight") {
      state.player.seekTo(state.player.getCurrent() + 5, false);
    } else if (e.key === "p" || e.key === "P") {
      playPreview(state);
    } else if (e.key === "s" || e.key === "S") {
      saveCurrent(state);
    } else if (e.key === "e" || e.key === "E") {
      openExportModal(state);
    } else if (e.key === "Escape") {
      document.querySelector(".modal-backdrop")?.remove();
      if (state.previewing) {
        clearClipPlayback(state);
        hidePreviewOverlay(state);
        state.player?.el?.pause?.();
      }
    }
  };
  window.addEventListener("keydown", handler);
  return handler;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
