import { api } from "../api.js";
import { navigate } from "../router.js";
import { el, loading, error } from "../components/Sidebar.js";
import { store } from "/js/store.js";
import { bindLivePage } from "../live.js";

export async function renderHome(root) {
  bindLivePage(root, async ({ silent }) => {
    if (!silent) {
      const cached = store.get().home;
      if (cached) paint(root, cached, store.get().status);
      else root.replaceChildren(loading("Loading workspace…"));
    }
    try {
      const [data, status] = await Promise.all([
        api.home(),
        api.status().catch(() => null),
      ]);
      store.setHome(data);
      if (status) store.setStatus(status);
      paint(root, data, status);
    } catch (e) {
      if (!silent && !store.get().home) root.replaceChildren(error(e.message));
    }
  });
}

function paint(root, data, status) {
  const wrap = el("div");
  wrap.append(
    el("div", { class: "page-header" }, [
      el("h1", { text: data.greeting }),
      el("p", { text: data.headline }),
    ])
  );

  const onVercel = status?.setup?.platform === "vercel";
  const durable = status?.credentials?.database_durable;
  if (onVercel && durable === false) {
    wrap.append(
      el("div", {
        class: "stat-card",
        style: "margin-bottom:18px;max-width:720px;",
      }, [
        el("div", { class: "label", text: "Vercel database" }),
        el("div", { class: "value", style: "font-size:18px;", text: "Not durable yet" }),
        el("p", {
          class: "muted",
          style: "margin:8px 0 12px;line-height:1.5;",
          text:
            status?.setup?.hint ||
            "Add a Neon Postgres DATABASE_URL in Vercel env vars or creators will disappear on cold starts.",
        }),
        el("button", {
          class: "btn btn-primary btn-sm",
          text: "Open Settings",
          onclick: () => navigate("/settings"),
        }),
      ])
    );
  }

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
  if (!data.top_opportunities?.length) {
    const creators = store.get().creators || [];
    list.append(
      el("div", {
        class: "empty-state",
        text:
          onVercel && durable === false
            ? "Set DATABASE_URL (Neon) in Settings so your workspace can persist on Vercel."
            : creators.length
              ? "Scans are running — moments will show up here as each video finishes."
              : "No moments yet — add a creator to start your clip queue.",
      })
    );
  }
  for (const m of data.top_opportunities || []) {
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
          m.top_comment ? el("p", { class: "quote", text: `"${m.top_comment}"` }) : null,
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
}
