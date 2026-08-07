import { api, formatTime } from "../api.js";
import { navigate } from "../router.js";
import { el, loading, error } from "../components/Sidebar.js";
import { store } from "/js/store.js";
import { bindLivePage } from "../live.js";
import { kickBackgroundScans, removeCreatorFollow } from "/js/background.js";
import { refreshWorkspace } from "../refresh.js";
import {
  getExcludeShortsPref,
  setExcludeShortsPref,
  isShortVideo,
  renderLengthFilterBar,
} from "../videoFilters.js";

export async function renderCreator(root, id) {
  let excludeShorts = getExcludeShortsPref();

  bindLivePage(root, async ({ silent }) => {
    if (!silent) root.replaceChildren(loading());
    try {
      await draw(root, id, {
        excludeShorts,
        setExcludeShorts: (on) => {
          excludeShorts = on;
          setExcludeShortsPref(on);
        },
      });
    } catch (e) {
      if (!silent) root.replaceChildren(error(e.message));
    }
  });
}

async function draw(root, id, { excludeShorts, setExcludeShorts }) {
  const [creator, videosRes, status] = await Promise.all([
    api.creator(id),
    api.creatorVideos(id, { excludeShorts }),
    api.status().catch(() => null),
  ]);
  store.setCreatorVideos(id, videosRes.videos || []);
  const liveReady = status?.credentials?.youtube_api_key;
  const wrap = el("div");

  const actions = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;" });
  if (!creator.is_demo && liveReady) {
    actions.append(
      el("button", {
        class: "btn",
        text: "Refresh videos",
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          e.currentTarget.textContent = "Refreshing…";
          try {
            await api.refreshCreator(id);
            await refreshWorkspace({ creatorId: id });
          } catch (err) {
            alert(err.message);
            e.currentTarget.disabled = false;
            e.currentTarget.textContent = "Refresh videos";
          }
        },
      }),
      el("button", {
        class: "btn btn-primary",
        text: "Scan comments",
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          e.currentTarget.textContent = "Queuing…";
          try {
            const all = await api.creatorVideos(id, { excludeShorts: false });
            const vids = (all.videos || [])
              .filter((v) => !v.is_demo && !isShortVideo(v))
              .map((v) => v.id);
            store.enqueueScans(vids, { front: true });
            kickBackgroundScans();
            e.currentTarget.textContent = "Scan queued";
            setTimeout(() => {
              e.currentTarget.disabled = false;
              e.currentTarget.textContent = "Scan comments";
            }, 1200);
          } catch (err) {
            alert(err.message);
            e.currentTarget.disabled = false;
            e.currentTarget.textContent = "Scan comments";
          }
        },
      })
    );
  }
  actions.append(
    el("a", {
      class: "btn",
      href: `https://youtube.com/${creator.handle}`,
      target: "_blank",
      rel: "noopener",
      text: "Open Channel",
    }),
    el("button", {
      class: "btn btn-danger",
      text: "Remove",
      onclick: async (e) => {
        const btn = e.currentTarget;
        if (!confirm(`Remove ${creator.name} from your workspace?`)) return;
        btn.disabled = true;
        btn.textContent = "Removing…";
        try {
          await removeCreatorFollow(creator);
          navigate("/creators");
        } catch (err) {
          alert(err.message || "Could not remove creator");
          btn.disabled = false;
          btn.textContent = "Remove";
        }
      },
    })
  );

  wrap.append(
    el("div", {
      class: "page-header",
      style: "display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;",
    }, [
      el("div", { style: "display:flex;gap:14px;align-items:center;" }, [
        el("img", { class: "avatar", src: creator.thumbnail_url, alt: creator.name }),
        el("div", {}, [
          el("h1", { text: creator.name }),
          el("p", {
            text: `${creator.handle} · ${creator.video_count} videos · ${creator.clip_opportunities} opportunities`,
          }),
        ]),
      ]),
      actions,
    ])
  );

  if (!creator.is_demo && !liveReady) {
    wrap.append(
      el("div", {
        class: "stat-card",
        style: "margin-bottom:18px;",
      }, [
        el("div", { class: "label", text: "Live scanning" }),
        el("p", {
          class: "muted",
          style: "margin:8px 0 0;",
          text: "Set YOUTUBE_API_KEY to refresh videos and scan comments for this creator.",
        }),
      ])
    );
  }

  wrap.append(
    renderLengthFilterBar(el, {
      excludeShorts,
      onChange: (on) => {
        setExcludeShorts(on);
        draw(root, id, { excludeShorts: on, setExcludeShorts }).catch((err) => {
          root.replaceChildren(error(err.message));
        });
      },
    })
  );

  const shortsHidden = videosRes.shorts_hidden || 0;
  wrap.append(
    el("div", {
      class: "section-title",
      text: excludeShorts ? "Recent long-form videos" : "Recent Videos",
    })
  );
  if (excludeShorts && shortsHidden) {
    wrap.append(
      el("p", {
        class: "muted",
        style: "margin:-4px 0 12px;",
        text: `Hiding ${shortsHidden} Short${shortsHidden === 1 ? "" : "s"} (under 3 min / #shorts).`,
      })
    );
  }

  const grid = el("div", { class: "video-grid" });
  for (const v of videosRes.videos || []) {
    const thumb = el("div", { class: "video-thumb" });
    if (v.thumbnail_url && !v.thumbnail_url.endsWith(".svg")) {
      thumb.append(
        el("img", {
          src: v.thumbnail_url,
          alt: v.title,
          style: "width:100%;height:100%;object-fit:cover;position:absolute;inset:0;",
        })
      );
    } else {
      thumb.append(el("div", { class: "title-watermark", text: v.title }));
    }
    thumb.append(el("div", { class: "duration", text: formatTime(v.duration_seconds) }));

    const scanBadgeClass =
      v.scan_status === "SCANNED"
        ? "badge-scanned"
        : v.scan_status === "SCANNING"
          ? "badge-scanning"
          : "";

    const row = el("div", { class: "video-card" }, [
      thumb,
      el("h3", { text: v.title }),
      el("div", { class: "video-card-stats" }, [
        el("span", { class: `badge ${scanBadgeClass}`, text: v.scan_status.replace("_", " ") }),
        el("span", { class: "badge", text: `${v.moment_count} moments` }),
        v.high_confidence_count
          ? el("span", { class: "badge badge-high", text: `${v.high_confidence_count} high` })
          : null,
      ]),
    ]);

    const buttons = el("div", { style: "display:flex;gap:8px;" });
    buttons.append(
      el("button", {
        class: "btn btn-primary",
        text: "Open",
        onclick: () => navigate(`/video/${v.id}`),
      })
    );
    if (!v.is_demo && liveReady && v.scan_status !== "SCANNING") {
      buttons.append(
        el("button", {
          class: "btn",
          text: v.scan_status === "SCANNED" ? "Rescan" : "Scan",
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            try {
              store.enqueueScans([v.id], { front: true });
              kickBackgroundScans();
              e.currentTarget.textContent = "Queued";
              setTimeout(() => {
                e.currentTarget.disabled = false;
                e.currentTarget.textContent = v.scan_status === "SCANNED" ? "Rescan" : "Scan";
              }, 1000);
            } catch (err) {
              alert(err.message);
              e.currentTarget.disabled = false;
            }
          },
        })
      );
    }
    row.append(buttons);
    grid.append(row);
  }
  if (!(videosRes.videos || []).length) {
    wrap.append(
      el("p", {
        class: "muted",
        text:
          excludeShorts && shortsHidden
            ? "No long-form videos in the recent window. Try Include Shorts or Refresh videos."
            : "No videos imported yet. Click Refresh videos.",
      })
    );
  } else {
    wrap.append(grid);
  }
  root.replaceChildren(wrap);
}
