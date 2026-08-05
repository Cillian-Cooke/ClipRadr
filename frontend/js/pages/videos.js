import { api, formatTime } from "../api.js";
import { navigate } from "../router.js";
import { el, loading, error } from "../components/Sidebar.js";

export async function renderVideosIndex(root) {
  root.replaceChildren(loading());
  try {
    const creators = await api.creators();
    const wrap = el("div");
    wrap.append(
      el("div", { class: "page-header" }, [
        el("h1", { text: "Videos" }),
        el("p", { text: "Recent VODs across your creators." }),
      ])
    );
    const grid = el("div", { class: "video-grid" });
    for (const c of creators.creators) {
      const vids = await api.creatorVideos(c.id);
      for (const v of vids.videos) {
        grid.append(
          el("div", { class: "video-card" }, [
            el("div", { class: "video-thumb" }, [
              el("div", { class: "title-watermark", text: v.title }),
              el("div", { class: "duration", text: formatTime(v.duration_seconds) }),
            ]),
            el("div", { class: "muted", text: c.name }),
            el("h3", { text: v.title }),
            el("div", { class: "video-card-stats" }, [
              el("span", { class: "badge", text: `${v.moment_count} moments` }),
            ]),
            el("button", {
              class: "btn btn-primary",
              text: "Open",
              onclick: () => navigate(`/video/${v.id}`),
            }),
          ])
        );
      }
    }
    wrap.append(grid);
    root.replaceChildren(wrap);
  } catch (e) {
    root.replaceChildren(error(e.message));
  }
}
