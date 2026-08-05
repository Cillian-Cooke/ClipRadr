import { api, formatTime } from "../api.js";
import { navigate } from "../router.js";
import { el, loading, error } from "../components/Sidebar.js";

export async function renderCreator(root, id) {
  root.replaceChildren(loading());
  try {
    await draw(root, id);
  } catch (e) {
    root.replaceChildren(error(e.message));
  }
}

async function draw(root, id) {
  const [creator, videosRes, status] = await Promise.all([
    api.creator(id),
    api.creatorVideos(id),
    api.status().catch(() => null),
  ]);
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
            await draw(root, id);
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
          e.currentTarget.textContent = "Scanning…";
          try {
            const res = await api.scanCreator(id);
            alert(res.message || "Scan started.");
            await draw(root, id);
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
          text: "Set YOUTUBE_API_KEY in .env to refresh videos and scan comments for this creator.",
        }),
      ])
    );
  }

  wrap.append(el("div", { class: "section-title", text: "Recent Videos" }));
  const grid = el("div", { class: "video-grid" });
  for (const v of videosRes.videos) {
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
              const res = await api.scanVideo(v.id);
              alert(res.message);
              await draw(root, id);
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
  wrap.append(grid);
  root.replaceChildren(wrap);
}
