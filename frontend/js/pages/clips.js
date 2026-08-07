import { api } from "../api.js";
import { navigate } from "../router.js";
import { el, loading, error, empty } from "../components/Sidebar.js";
import { store } from "/js/store.js";
import { bindLivePage } from "../live.js";

export async function renderClips(root) {
  let status = "ALL";
  let sort = "score";

  async function draw({ silent = false } = {}) {
    if (!silent) root.replaceChildren(loading());
    const params = { sort };
    if (status !== "ALL") params.status = status;
    const data = await api.opportunities(params);
    store.setOpportunities(data);

    const wrap = el("div");
    wrap.append(
      el("div", { class: "page-header" }, [
        el("h1", { text: "Clip Opportunities" }),
        el("p", { text: "Your editor queue — updates live as comment scans finish." }),
      ])
    );

    const filters = el("div", { class: "filter-bar" });
    for (const s of ["ALL", "HIGH", "UNREVIEWED", "SAVED", "EXPORTED"]) {
      filters.append(
        el("button", {
          class: `chip ${status === s ? "active" : ""}`,
          text: s === "HIGH" ? "HIGH CONFIDENCE" : s,
          onclick: () => {
            status = s;
            draw({ silent: true });
          },
        })
      );
    }
    wrap.append(filters);

    const sortBar = el("div", { class: "filter-bar" });
    for (const [key, label] of [
      ["score", "Highest score"],
      ["newest", "Newest"],
      ["comments", "Most comments"],
      ["longest", "Longest"],
      ["shortest", "Shortest"],
    ]) {
      sortBar.append(
        el("button", {
          class: `chip ${sort === key ? "active" : ""}`,
          text: label,
          onclick: () => {
            sort = key;
            draw({ silent: true });
          },
        })
      );
    }
    wrap.append(sortBar);

    if (!data.moments.length) {
      const creators = store.get().creators || [];
      wrap.append(
        empty(
          creators.length
            ? "No opportunities match these filters."
            : "No clip opportunities yet — add a creator to start your queue."
        )
      );
      root.replaceChildren(wrap);
      return;
    }

    const list = el("div", { class: "card-list" });
    for (const m of data.moments) {
      list.append(
        el("div", { class: "opportunity-card" }, [
          el("div", {}, [
            el("div", {
              class: "muted",
              text: `${m.video?.creator?.name || ""} · ${m.topic || "MOMENT"}`,
            }),
            el("h3", { text: m.video?.title || "Video", style: "margin:4px 0;font-size:15px;" }),
            el("div", { class: "ts", text: m.representative_label }),
            el("div", {
              class: "muted",
              text: `${m.unique_commenters} viewers · score ${m.score}/100`,
            }),
            m.top_comment ? el("p", { class: "quote", text: `"${m.top_comment}"` }) : null,
          ]),
          el("button", {
            class: "btn btn-primary btn-sm",
            text: "Open",
            onclick: () => navigate(`/video/${m.video_id}?moment=${m.id}`),
          }),
        ])
      );
    }
    wrap.append(list);
    root.replaceChildren(wrap);
  }

  bindLivePage(root, async ({ silent }) => {
    try {
      await draw({ silent });
    } catch (e) {
      if (!silent) root.replaceChildren(error(e.message));
    }
  });
}
