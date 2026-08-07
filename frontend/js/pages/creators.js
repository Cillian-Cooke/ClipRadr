import { api } from "../api.js";
import { navigate } from "../router.js";
import { el, loading, error, empty } from "../components/Sidebar.js";
import { openAddCreatorModal } from "../components/AddCreator.js";
import { store } from "/js/store.js";
import { bindLivePage } from "../live.js";
import { removeCreatorFollow } from "/js/background.js";

export async function renderCreators(root) {
  bindLivePage(root, async ({ silent }) => {
    const cached = store.get().creators;
    if (!silent) {
      if (cached?.length) paint(root, cached, store.get().status);
      else root.replaceChildren(loading());
    }
    try {
      const [data, status] = await Promise.all([
        api.creators(),
        api.status().catch(() => null),
      ]);
      store.setCreators(data.creators || []);
      if (status) store.setStatus(status);
      paint(root, data.creators || [], status || store.get().status);
    } catch (e) {
      if (!silent && !cached?.length) root.replaceChildren(error(e.message));
    }
  });
}

function paint(root, creators, status) {
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
          ? "Your YouTube creators — pages update live as scans finish."
          : ytError
            ? `YouTube key issue: ${ytError}`
            : "Add creators once YouTube is connected in Settings.",
      }),
    ]),
    el("button", {
      class: "btn btn-primary",
      text: "+ Add Creator",
      onclick: () =>
        openAddCreatorModal({
          onDone: () => store.bumpData("creator-added"),
        }),
    })
  );
  wrap.append(header);

  if (!creators.length) {
    wrap.append(empty("No creators yet. Click Add Creator to import a channel."));
    root.replaceChildren(wrap);
    return;
  }

  const grid = el("div", { class: "creator-grid" });
  for (const c of creators) {
    grid.append(
      el("div", { class: "creator-card" }, [
        el("div", { class: "creator-card-head" }, [
          el("img", {
            class: "avatar",
            src: c.thumbnail_url || "/static/avatars/chaos.svg",
            alt: c.name,
          }),
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
        el("div", { class: "creator-card-actions" }, [
          el("button", {
            class: "btn",
            text: "Open",
            onclick: () => navigate(`/creator/${c.id}`),
          }),
          el("button", {
            class: "btn btn-danger",
            text: "Remove",
            onclick: async (e) => {
              const btn = e.currentTarget;
              if (!confirm(`Remove ${c.name} from your workspace?`)) return;
              btn.disabled = true;
              btn.textContent = "Removing…";
              try {
                await removeCreatorFollow(c);
              } catch (err) {
                alert(err.message || "Could not remove creator");
                btn.disabled = false;
                btn.textContent = "Remove";
              }
            },
          }),
        ]),
      ])
    );
  }
  wrap.append(grid);
  root.replaceChildren(wrap);
}

function meta(k, v) {
  return el("div", {}, [
    el("div", { class: "k", text: k }),
    el("div", { class: "v", text: String(v) }),
  ]);
}
