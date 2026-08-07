import { api, formatTime } from "../api.js";
import { navigate } from "../router.js";
import { el, loading, error, empty } from "../components/Sidebar.js";
import { store } from "/js/store.js";
import { bindLivePage } from "../live.js";
import {
  getLengthFilterPref,
  setLengthFilterPref,
  lengthFilterHint,
  lengthFilterEmptyMessage,
  renderLengthFilterBar,
} from "../videoFilters.js";

export async function renderVideosIndex(root) {
  let lengthMode = getLengthFilterPref();

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
          mode: lengthMode,
          onChange: (mode) => {
            lengthMode = mode;
            setLengthFilterPref(mode);
            draw({ silent: true });
          },
        })
      );

      const grid = el("div", { class: "video-grid" });
      let any = false;
      let hidden = 0;
      for (const c of creators.creators) {
        const vids = await api.creatorVideos(c.id, { length: lengthMode });
        hidden += vids.hidden || vids.shorts_hidden || 0;
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
        wrap.append(empty(lengthFilterEmptyMessage(lengthMode)));
      } else {
        const hint = lengthFilterHint(lengthMode, hidden);
        if (hint) {
          wrap.append(
            el("p", {
              class: "muted",
              style: "margin:0 0 12px;",
              text: hint,
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
