import { api } from "../api.js";
import { navigate } from "../router.js";
import { el, loading, error } from "../components/Sidebar.js";

export async function renderHome(root) {
  root.replaceChildren(loading("Loading workspace…"));
  try {
    const data = await api.home();
    const wrap = el("div");
    wrap.append(
      el("div", { class: "page-header" }, [
        el("h1", { text: data.greeting }),
        el("p", { text: data.headline }),
      ])
    );

    const stats = el("div", { class: "grid-stats" });
    const pairs = [
      ["Creators followed", data.stats.creators_followed],
      ["Videos scanned", data.stats.videos_scanned],
      ["Clip moments found", data.stats.clip_moments_found],
      ["Clips exported", data.stats.clips_exported],
    ];
    for (const [label, value] of pairs) {
      stats.append(
        el("div", { class: "stat-card" }, [
          el("div", { class: "label", text: label }),
          el("div", { class: "value", text: String(value) }),
        ])
      );
    }
    wrap.append(el("div", { class: "section-title", text: "Quick Stats" }), stats);

    wrap.append(el("div", { class: "section-title", text: "Top Clip Opportunities" }));
    const list = el("div", { class: "card-list" });
    for (const m of data.top_opportunities) {
      list.append(
        el("div", { class: "opportunity-card" }, [
          el("div", {}, [
            el("div", { class: "muted", text: m.video?.creator?.name || "Creator" }),
            el("h3", { text: m.video?.title || "Video", style: "margin:4px 0 0;font-size:15px;" }),
            el("div", { class: "ts", text: m.representative_label }),
            el("div", {
              class: "muted",
              text: `${m.unique_commenters} viewers flagged this moment · ${m.score}/100`,
            }),
            m.top_comment
              ? el("p", { class: "quote", text: `"${m.top_comment}"` })
              : null,
          ]),
          el("button", {
            class: "btn btn-primary btn-sm",
            text: "Open Moment",
            onclick: () => navigate(`/video/${m.video_id}?moment=${m.id}`),
          }),
        ])
      );
    }
    wrap.append(list);
    root.replaceChildren(wrap);
  } catch (e) {
    root.replaceChildren(error(e.message));
  }
}
