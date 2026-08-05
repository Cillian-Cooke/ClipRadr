import { api, withRetry } from "../api.js";
import { navigate } from "../router.js";
import { el, loading, error, empty } from "../components/Sidebar.js";
import { addChannel } from "../components/AddCreator.js";
import { store } from "../store.js";

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
    if (status) store.setStatus(status);

    let ytChannels = [];
    let ytError = "";
    const liveReady = !!status?.capabilities?.add_live_creators;
    if (liveReady) {
      try {
        const yt = await withRetry(() => api.searchChannels(q), {
          tries: 2,
          delayMs: 500,
          label: "YouTube search",
        });
        ytChannels = yt.channels || [];
      } catch (e) {
        ytError = e.message || "YouTube channel search failed.";
      }
    } else {
      ytError =
        status?.credentials?.youtube_api_error ||
        "YouTube not connected — open Settings to add creators from search.";
    }

    const wrap = el("div");
    wrap.append(
      el("div", { class: "page-header" }, [
        el("h1", { text: `Search: ${local.query}` }),
        el("p", { text: "Local library + YouTube channel lookup." }),
      ])
    );

    wrap.append(el("div", { class: "section-title", text: "YouTube channels" }));
    if (ytChannels.length) {
      const list = el("div", { class: "card-list" });
      for (const ch of ytChannels) {
        const statusLine = el("div", { class: "muted", style: "font-size:12px;min-height:16px;" });
        const addBtn = el("button", {
          class: "btn btn-sm btn-primary",
          text: "Add",
        });
        addBtn.addEventListener("click", async () => {
          addBtn.disabled = true;
          addBtn.textContent = "Adding…";
          try {
            const res = await addChannel(ch, statusLine);
            addBtn.textContent = "Added";
            statusLine.textContent = res.message || "Creator added.";
            setTimeout(() => {
              if (res.creator?.id) navigate(`/creator/${res.creator.id}`);
            }, 350);
          } catch (err) {
            statusLine.textContent = err.message || "Couldn’t add creator.";
            addBtn.disabled = false;
            addBtn.textContent = "Add";
          }
        });
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
                statusLine,
              ]),
            ]),
            addBtn,
          ])
        );
      }
      wrap.append(list);
    } else {
      wrap.append(
        el("div", {
          class: "muted",
          style: "margin-bottom:16px;",
          text: ytError || "No YouTube channels matched.",
        })
      );
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

    if (
      !ytChannels.length &&
      !local.moments.length &&
      !local.creators.length &&
      !local.videos.length
    ) {
      wrap.append(empty("No results."));
    }

    root.replaceChildren(wrap);
  } catch (e) {
    root.replaceChildren(error(e.message));
  }
}
