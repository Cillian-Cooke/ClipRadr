import { api, formatTime } from "../api.js";
import { navigate } from "../router.js";
import { el, loading, error, empty } from "../components/Sidebar.js";
import { store } from "../store.js";
import { bindLivePage } from "../live.js";

export async function renderVideosIndex(root) {
  bindLivePage(root, async ({ silent }) => {
    if (!silent) root.replaceChildren(loading());
    try {
      const creators = await api.creators();
      store.setCreators(creators.creators || []);
      const wrap = el("div");
      wrap.append(
        el("div", { class: "page-header" }, [
          el("h1", { text: "Videos" }),
          el("p", { text: "Recent VODs across your creators — moment counts update live." }),
        ])
      );
      const grid = el("div", { class: "video-grid" });
      let any = false;
      for (const c of creators.creators) {
        const vids = await api.creatorVideos(c.id);
        store.setCreatorVideos(c.id, vids.videos || []);
        for (const v of vids.videos) {
          any = true;
          grid.append(
            el("div", { class: "video-card" }, [
              el("div", { class: "video-thumb" }, [
                el("div", { class: "title-watermark", text: v.title }),
                el("div", { class: "duration", text: formatTime(v.duration_seconds) }),
              ]),
              el("div", { class: "muted", text: c.name }),
              el("h3", { text: v.title }),
              el("div", { class: "video-card-stats" }, [
                el("span", {
                  class: `badge ${v.scan_status === "SCANNED" ? "badge-scanned" : ""}`,
                  text: v.scan_status.replace("_", " "),
                }),
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
      if (!any) wrap.append(empty("No videos yet. Add a creator to import recent uploads."));
      else wrap.append(grid);
      root.replaceChildren(wrap);
    } catch (e) {
      if (!silent) root.replaceChildren(error(e.message));
    }
  });
}
