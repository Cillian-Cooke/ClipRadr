import { api } from "../api.js";
import { navigate } from "../router.js";
import { el, loading, error, empty } from "../components/Sidebar.js";

export async function renderSaved(root) {
  root.replaceChildren(loading());
  try {
    const data = await api.clips();
    const wrap = el("div");
    wrap.append(
      el("div", { class: "page-header" }, [
        el("h1", { text: "Saved Clips" }),
        el("p", { text: "Moments parked for your edit — with boundaries and export settings." }),
      ])
    );
    if (!data.clips.length) {
      wrap.append(empty("No saved clips yet. Save a moment from the video workspace."));
      root.replaceChildren(wrap);
      return;
    }
    const list = el("div", { class: "card-list" });
    for (const c of data.clips) {
      const m = c.moment;
      list.append(
        el("div", { class: "saved-card opportunity-card" }, [
          el("div", {}, [
            el("div", { class: "muted", text: `${m?.video?.creator?.name || ""} · ${c.status}` }),
            el("h3", { text: m?.video?.title || "Clip", style: "margin:4px 0;font-size:15px;" }),
            el("div", {
              class: "ts",
              text: `${c.start_label} → ${c.end_label}`,
            }),
            el("div", {
              class: "muted",
              text: `${c.duration_seconds}s · ${c.aspect_ratio} · ${c.crop_position}`,
            }),
            c.notes ? el("p", { class: "quote", text: c.notes }) : null,
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
  } catch (e) {
    root.replaceChildren(error(e.message));
  }
}
