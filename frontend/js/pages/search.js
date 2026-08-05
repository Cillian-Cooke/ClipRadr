import { api, withRetry } from "../api.js";
import { navigate } from "../router.js";
import { el, loading, error, empty } from "../components/Sidebar.js";

export async function renderSearch(root) {
  const q = new URLSearchParams(window.location.search).get("q") || "";
  root.replaceChildren(loading(q ? `Searching “${q}”…` : "Search"));
  try {
    if (!q.trim()) {
      root.replaceChildren(
        el("div", {}, [
          el("div", { class: "page-header" }, [
            el("h1", { text: "Search" }),
            el("p", { text: "Find creators, videos, moments, or look up a YouTube channel to add." }),
          ]),
          empty("Type a query in the top search bar."),
        ])
      );
      return;
    }

    const [local, status] = await Promise.all([
      api.search(q),
      api.status().catch(() => null),
    ]);

    let ytChannels = [];
    if (status?.capabilities?.add_live_creators) {
      try {
        const yt = await api.searchChannels(q);
        ytChannels = yt.channels || [];
      } catch {
        ytChannels = [];
      }
    }

    const wrap = el("div");
    wrap.append(
      el("div", { class: "page-header" }, [
        el("h1", { text: `Search: ${local.query}` }),
        el("p", { text: "Local library + YouTube channel lookup." }),
      ])
    );

    if (ytChannels.length) {
      wrap.append(el("div", { class: "section-title", text: "YouTube channels" }));
      const list = el("div", { class: "card-list" });
      for (const ch of ytChannels) {
        list.append(
          el("div", { class: "opportunity-card" }, [
            el("div", { style: "display:flex;gap:12px;align-items:center;min-width:0;" }, [
              el("img", {
                class: "avatar",
                src: ch.thumbnail_url || "/static/avatars/chaos.svg",
                alt: ch.name,
              }),
              el("div", { style: "min-width:0;" }, [
                el("h3", { text: ch.name, style: "margin:0;font-size:15px;" }),
                el("div", { class: "muted", text: ch.handle }),
              ]),
            ]),
            el("button", {
              class: "btn btn-sm btn-primary",
              text: "Add",
              onclick: async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                btn.textContent = "Adding…";
                try {
                  const res = await withRetry(
                    () =>
                      api.addCreator({
                        youtube_channel_id: ch.youtube_channel_id,
                        auto_scan: false,
                      }),
                    { tries: 3, delayMs: 900, label: "Add creator" }
                  );
                  const { afterCreatorAdded } = await import("../background.js");
                  await afterCreatorAdded(res);
                  navigate(`/creator/${res.creator.id}`);
                } catch (err) {
                  alert(err.message);
                  btn.disabled = false;
                  btn.textContent = "Add";
                }
              },
            }),
          ])
        );
      }
      wrap.append(list);
    }

    if (local.creators.length) {
      wrap.append(el("div", { class: "section-title", text: "Your creators", style: "margin-top:24px;" }));
      const list = el("div", { class: "card-list" });
      for (const c of local.creators) {
        list.append(
          el("div", { class: "opportunity-card" }, [
            el("div", {}, [
              el("h3", { text: c.name, style: "margin:0;font-size:15px;" }),
              el("div", { class: "muted", text: c.handle }),
            ]),
            el("button", {
              class: "btn btn-sm btn-primary",
              text: "Open",
              onclick: () => navigate(`/creator/${c.id}`),
            }),
          ])
        );
      }
      wrap.append(list);
    }

    if (local.videos.length) {
      wrap.append(el("div", { class: "section-title", text: "Videos", style: "margin-top:24px;" }));
      const list = el("div", { class: "card-list" });
      for (const v of local.videos) {
        list.append(
          el("div", { class: "opportunity-card" }, [
            el("div", {}, [
              el("div", { class: "muted", text: v.creator?.name || "" }),
              el("h3", { text: v.title, style: "margin:4px 0;font-size:15px;" }),
            ]),
            el("button", {
              class: "btn btn-sm btn-primary",
              text: "Open",
              onclick: () => navigate(`/video/${v.id}`),
            }),
          ])
        );
      }
      wrap.append(list);
    }

    if (local.moments.length) {
      wrap.append(el("div", { class: "section-title", text: "Moments", style: "margin-top:24px;" }));
      const list = el("div", { class: "card-list" });
      for (const m of local.moments) {
        list.append(
          el("div", { class: "opportunity-card" }, [
            el("div", {}, [
              el("div", { class: "muted", text: `${m.video?.creator?.name || ""} · ${m.topic || ""}` }),
              el("h3", { text: m.video?.title || "Video", style: "margin:4px 0;font-size:15px;" }),
              el("div", { class: "ts", text: m.representative_label }),
            ]),
            el("button", {
              class: "btn btn-sm btn-primary",
              text: "Open",
              onclick: () => navigate(`/video/${m.video_id}?moment=${m.id}`),
            }),
          ])
        );
      }
      wrap.append(list);
    }

    if (!ytChannels.length && !local.moments.length && !local.creators.length && !local.videos.length) {
      wrap.append(empty("No results."));
    }

    root.replaceChildren(wrap);
  } catch (e) {
    root.replaceChildren(error(e.message));
  }
}
