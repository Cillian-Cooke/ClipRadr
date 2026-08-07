import { api, formatTime } from "../api.js";
import { navigate } from "../router.js";
import { el, loading, error, empty } from "../components/Sidebar.js";
import { store } from "/js/store.js";
import { bindLivePage } from "../live.js";
import {
  getExcludeShortsPref,
  setExcludeShortsPref,
  renderLengthFilterBar,
} from "../videoFilters.js";

export async function renderVideosIndex(root) {
  let excludeShorts = getExcludeShortsPref();

  async function draw({ silent = false } = {}) {
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

      wrap.append(
        renderLengthFilterBar(el, {
          excludeShorts,
          onChange: (on) => {
            excludeShorts = on;
            setExcludeShortsPref(on);
            draw({ silent: true });
          },
        })
      );

      const grid = el("div", { class: "video-grid" });
      let any = false;
      let shortsHidden = 0;
      for (const c of creators.creators) {
        const vids = await api.creatorVideos(c.id, { excludeShorts });
        shortsHidden += vids.shorts_hidden || 0;
        store.setCreatorVideos(c.id, vids.videos || []);
        for (const v of vids.videos || []) {
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
      if (!any) {
        wrap.append(
          empty(
            excludeShorts && shortsHidden
              ? "No long-form videos yet — Shorts are hidden. Switch to Include Shorts or refresh a creator."
              : "No videos yet. Add a creator to import recent uploads."
          )
        );
      } else {
        if (excludeShorts && shortsHidden) {
          wrap.append(
            el("p", {
              class: "muted",
              style: "margin:0 0 12px;",
              text: `Hiding ${shortsHidden} Short${shortsHidden === 1 ? "" : "s"} (under 3 min / #shorts).`,
            })
          );
        }
        wrap.append(grid);
      }
      root.replaceChildren(wrap);
    } catch (e) {
      if (!silent) root.replaceChildren(error(e.message));
    }
  }

  bindLivePage(root, draw);
}
