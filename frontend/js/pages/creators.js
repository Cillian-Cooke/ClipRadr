import { api } from "../api.js";
import { navigate } from "../router.js";
import { el, loading, error, empty } from "../components/Sidebar.js";

export async function renderCreators(root) {
  root.replaceChildren(loading());
  try {
    const [data, status] = await Promise.all([
      api.creators(),
      api.status().catch(() => null),
    ]);
    const liveReady = !!status?.capabilities?.add_live_creators;
    const ytError = status?.credentials?.youtube_api_error;

    const wrap = el("div");
    const header = el("div", {
      class: "page-header",
      style: "display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;",
    });
    header.append(
      el("div", {}, [
        el("h1", { text: "Creators" }),
        el("p", {
          text: liveReady
            ? "Your YouTube creators — search and add more anytime."
            : ytError
              ? `YouTube key issue: ${ytError}`
              : "Add creators once YouTube is connected in Settings.",
        }),
      ]),
      el("button", {
        class: "btn btn-primary",
        text: "+ Add Creator",
        onclick: () => openAddModal(() => renderCreators(root), liveReady, ytError || ""),
      })
    );
    wrap.append(header);

    if (!data.creators.length) {
      wrap.append(empty("No creators yet. Click Add Creator to import a channel."));
      root.replaceChildren(wrap);
      return;
    }

    const grid = el("div", { class: "creator-grid" });
    for (const c of data.creators) {
      grid.append(
        el("div", { class: "creator-card" }, [
          el("div", { class: "creator-card-head" }, [
            el("img", { class: "avatar", src: c.thumbnail_url || "/static/avatars/chaos.svg", alt: c.name }),
            el("div", {}, [
              el("h3", { text: c.name }),
              el("div", { class: "muted", text: c.handle }),
            ]),
          ]),
          el("div", { class: "creator-meta" }, [
            meta("Videos", c.video_count),
            meta("Clip opportunities", c.clip_opportunities),
            meta("Last scanned", c.last_scanned_at ? "Recently" : "—"),
          ]),
          el("button", {
            class: "btn",
            text: "Open Creator",
            onclick: () => navigate(`/creator/${c.id}`),
          }),
        ])
      );
    }
    wrap.append(grid);
    root.replaceChildren(wrap);
  } catch (e) {
    root.replaceChildren(error(e.message));
  }
}

function meta(k, v) {
  return el("div", {}, [
    el("div", { class: "k", text: k }),
    el("div", { class: "v", text: String(v) }),
  ]);
}

function openAddModal(onDone, liveReady, ytError = "") {
  const backdrop = el("div", { class: "modal-backdrop" });
  const input = el("input", {
    placeholder: "Search name, @handle, or paste a channel URL…",
    autocomplete: "off",
  });
  const status = el("div", { class: "muted", style: "min-height:18px;margin:0 0 10px;" });
  const results = el("div", { class: "channel-results" });

  let timer = null;
  let latestQuery = "";

  const runSearch = async () => {
    const q = input.value.trim();
    latestQuery = q;
    if (!liveReady) {
      status.textContent = ytError || "YouTube API not connected — check Settings.";
      results.replaceChildren();
      return;
    }
    if (q.length < 2) {
      status.textContent = "Type at least 2 characters.";
      results.replaceChildren();
      return;
    }
    status.textContent = "Searching YouTube…";
    try {
      const data = await api.searchChannels(q);
      if (latestQuery !== q) return;
      results.replaceChildren();
      if (!data.channels.length) {
        status.textContent = "No channels found.";
        return;
      }
      status.textContent = `${data.channels.length} channel${data.channels.length === 1 ? "" : "s"} found — click to add.`;
      for (const ch of data.channels) {
        results.append(
          el("button", {
            class: "channel-result",
            onclick: async () => {
              status.textContent = `Adding ${ch.name}…`;
              results.querySelectorAll("button").forEach((b) => (b.disabled = true));
              try {
                const res = await api.addCreator({
                  youtube_channel_id: ch.youtube_channel_id,
                  auto_scan: true,
                });
                status.textContent =
                  (res.message || "Creator added.") +
                  (res.videos_imported ? ` Imported ${res.videos_imported} videos.` : "");
                setTimeout(() => {
                  backdrop.remove();
                  onDone();
                  if (res.creator?.id) navigate(`/creator/${res.creator.id}`);
                }, 650);
              } catch (e) {
                status.textContent = e.message;
                results.querySelectorAll("button").forEach((b) => (b.disabled = false));
              }
            },
          }, [
            el("img", {
              class: "avatar",
              src: ch.thumbnail_url || "/static/avatars/chaos.svg",
              alt: ch.name,
            }),
            el("div", { style: "text-align:left;min-width:0;" }, [
              el("div", { style: "font-weight:600;", text: ch.name }),
              el("div", { class: "muted", style: "font-size:12px;", text: ch.handle }),
              ch.description
                ? el("div", {
                    class: "dim",
                    style: "font-size:11px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px;",
                    text: ch.description,
                  })
                : null,
            ]),
            el("span", { class: "badge badge-scanned", text: "Add" }),
          ])
        );
      }
    } catch (e) {
      if (latestQuery !== q) return;
      status.textContent = e.message;
      results.replaceChildren();
    }
  };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(runSearch, 350);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(timer);
      runSearch();
    }
  });

  const modal = el("div", { class: "modal modal-wide" }, [
    el("h2", { text: "Add Creator" }),
    el("p", {
      text: "Search YouTube by creator name or paste a channel URL. Videos import automatically; comments scan in the background.",
    }),
    el("label", { text: "Search YouTube" }),
    input,
    status,
    results,
    el("div", { class: "modal-actions" }, [
      el("button", {
        class: "btn",
        text: "Close",
        onclick: () => backdrop.remove(),
      }),
    ]),
  ]);
  backdrop.append(modal);
  document.body.append(backdrop);
  setTimeout(() => input.focus(), 50);
  if (!liveReady) status.textContent = ytError || "YOUTUBE_API_KEY not connected — open Settings.";
}
