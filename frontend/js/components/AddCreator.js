import { api, withRetry } from "../api.js";
import { navigate } from "../router.js";
import { store } from "/js/store.js";
import { afterCreatorAdded } from "/js/background.js";
import { el } from "./Sidebar.js";

export async function addChannel(ch, statusEl) {
  if (statusEl) statusEl.textContent = `Adding ${ch.name}… (saving channel)`;
  const res = await withRetry(
    () =>
      api.addCreator({
        youtube_channel_id: ch.youtube_channel_id,
        auto_scan: false,
      }),
    { tries: 3, delayMs: 900, label: "Add creator" }
  );
  store.rememberChannel({ ...ch, ...res.creator });
  if (statusEl) {
    statusEl.textContent = res.import_error
      ? `Saved ${ch.name}. Retrying video import…`
      : `Imported ${res.videos_imported || 0} videos — queuing comment scans…`;
  }
  await afterCreatorAdded(res);
  return res;
}

/** True for channel URLs, @handles, or UC… channel IDs. */
export function looksLikeChannelQuery(q) {
  const s = (q || "").trim();
  if (!s) return false;
  return (
    /youtube\.com|youtu\.be/i.test(s) ||
    /^@[\w.-]+$/.test(s) ||
    /^UC[\w-]{20,}$/.test(s)
  );
}

/**
 * Shared Add Creator modal used from Creators page and the top bar.
 * @param {{ onDone?: () => void, initialQuery?: string }} opts
 */
export function openAddCreatorModal(opts = {}) {
  const { onDone, initialQuery = "" } = opts;
  const statusSnap = store.get().status;
  const liveReady = !!statusSnap?.capabilities?.add_live_creators;
  const ytError = statusSnap?.credentials?.youtube_api_error || "";

  const backdrop = el("div", { class: "modal-backdrop" });
  const input = el("input", {
    placeholder: "Search name, @handle, or paste a channel URL…",
    autocomplete: "off",
    value: initialQuery,
  });
  const status = el("div", { class: "muted", style: "min-height:18px;margin:0 0 10px;" });
  const results = el("div", { class: "channel-results" });

  let timer = null;
  let latestQuery = "";
  let adding = false;

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
      const data = await withRetry(() => api.searchChannels(q), {
        tries: 2,
        delayMs: 500,
        label: "Search",
      });
      if (latestQuery !== q) return;
      results.replaceChildren();
      if (!data.channels.length) {
        status.textContent = "No channels found.";
        return;
      }
      status.textContent = `${data.channels.length} channel${data.channels.length === 1 ? "" : "s"} found — click to add.`;
      for (const ch of data.channels) {
        results.append(
          el(
            "button",
            {
              class: "channel-result",
              onclick: async () => {
                if (adding) return;
                adding = true;
                results.querySelectorAll("button").forEach((b) => (b.disabled = true));
                try {
                  const res = await addChannel(ch, status);
                  status.textContent = res.message || "Creator added.";
                  setTimeout(() => {
                    backdrop.remove();
                    onDone?.();
                    if (res.creator?.id) navigate(`/creator/${res.creator.id}`);
                  }, 400);
                } catch (e) {
                  status.textContent = e.message || "Couldn’t add creator. Try again.";
                  results.querySelectorAll("button").forEach((b) => (b.disabled = false));
                  adding = false;
                }
              },
            },
            [
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
                      style:
                        "font-size:11px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px;",
                      text: ch.description,
                    })
                  : null,
              ]),
              el("span", { class: "badge badge-scanned", text: "Add" }),
            ]
          )
        );
      }
    } catch (e) {
      if (latestQuery !== q) return;
      status.textContent = e.message || "Search failed. Try again.";
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
      text: "Search YouTube by creator name or paste a channel URL. We’ll save the channel first, then import videos with retries if needed.",
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
  setTimeout(() => {
    input.focus();
    if (initialQuery.trim().length >= 2) runSearch();
  }, 50);
  if (!liveReady) status.textContent = ytError || "YOUTUBE_API_KEY not connected — open Settings.";
}
