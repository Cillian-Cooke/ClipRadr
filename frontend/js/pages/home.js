import { api } from "../api.js";
import { navigate } from "../router.js";
import { el, loading, error, empty } from "../components/Sidebar.js";
import { store } from "/js/store.js";
import { bindLivePage } from "../live.js";
import { openAddCreatorModal } from "../components/AddCreator.js";
import { removeCreatorFollow } from "/js/background.js";

export async function renderHome(root) {
  let statusFilter = "ALL";
  let sort = "score";

  async function draw({ silent = false } = {}) {
    if (!silent) {
      const cachedHome = store.get().home;
      const cachedCreators = store.get().creators;
      if (cachedHome || cachedCreators?.length) {
        paint(root, {
          home: cachedHome,
          creators: cachedCreators || [],
          moments: store.get().opportunities?.moments || null,
          status: store.get().status,
          statusFilter,
          sort,
          onStatus: (s) => {
            statusFilter = s;
            draw({ silent: true });
          },
          onSort: (s) => {
            sort = s;
            draw({ silent: true });
          },
        });
      } else {
        root.replaceChildren(loading("Loading workspace…"));
      }
    }

    try {
      const params = { sort };
      if (statusFilter !== "ALL") params.status = statusFilter;

      const [home, creatorsRes, momentsRes, status] = await Promise.all([
        api.home().catch(() => store.get().home),
        api.creators().catch(() => ({ creators: store.get().creators || [] })),
        api.opportunities(params).catch(() => ({ moments: [] })),
        api.status().catch(() => store.get().status),
      ]);

      if (home) store.setHome(home);
      if (creatorsRes?.creators) store.setCreators(creatorsRes.creators);
      if (momentsRes) store.setOpportunities(momentsRes);
      if (status) store.setStatus(status);

      paint(root, {
        home: home || store.get().home,
        creators: creatorsRes?.creators || store.get().creators || [],
        moments: momentsRes?.moments || [],
        status,
        statusFilter,
        sort,
        onStatus: (s) => {
          statusFilter = s;
          draw({ silent: true });
        },
        onSort: (s) => {
          sort = s;
          draw({ silent: true });
        },
      });
    } catch (e) {
      if (!silent && !store.get().home) root.replaceChildren(error(e.message));
    }
  }

  bindLivePage(root, async ({ silent }) => {
    await draw({ silent });
  });
}

function paint(root, ctx) {
  const {
    home,
    creators,
    moments,
    status,
    statusFilter,
    sort,
    onStatus,
    onSort,
  } = ctx;

  const layout = el("div", { class: "home-layout" });
  const mainCol = el("div", { class: "home-main" });
  const sideCol = el("aside", { class: "home-creators" });

  mainCol.append(
    el("div", { class: "page-header" }, [
      el("h1", { text: home?.greeting || "Home" }),
      el("p", {
        text:
          home?.headline ||
          "Clip opportunities from the creators you follow — filter and open moments to edit.",
      }),
    ])
  );

  const filters = el("div", { class: "filter-bar" });
  for (const s of ["ALL", "HIGH", "UNREVIEWED", "SAVED", "EXPORTED"]) {
    filters.append(
      el("button", {
        class: `chip ${statusFilter === s ? "active" : ""}`,
        text: s === "HIGH" ? "HIGH CONFIDENCE" : s,
        onclick: () => onStatus(s),
      })
    );
  }
  mainCol.append(filters);

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
        onclick: () => onSort(key),
      })
    );
  }
  mainCol.append(sortBar);

  const list = el("div", { class: "card-list" });
  const momentRows = Array.isArray(moments) ? moments : [];
  if (!momentRows.length) {
    list.append(
      empty(
        creators.length
          ? "No opportunities match these filters."
          : "No clip opportunities yet — add a creator to start your queue."
      )
    );
  } else {
    for (const m of momentRows) {
      list.append(
        el("div", { class: "opportunity-card" }, [
          el("div", {}, [
            el("div", {
              class: "muted",
              text: `${m.video?.creator?.name || ""} · ${m.topic || "MOMENT"}`,
            }),
            el("h3", {
              text: m.video?.title || "Video",
              style: "margin:4px 0;font-size:15px;",
            }),
            el("div", { class: "ts", text: m.representative_label }),
            el("div", {
              class: "muted",
              text: `${m.unique_commenters} viewers · score ${m.score}/100`,
            }),
            m.top_comment
              ? el("p", { class: "quote", text: `"${m.top_comment}"` })
              : null,
          ]),
          el("button", {
            class: "btn btn-primary btn-sm",
            text: "Open",
            onclick: () => navigate(`/video/${m.video_id}?moment=${m.id}`),
          }),
        ])
      );
    }
  }
  mainCol.append(list);

  sideCol.append(
    el("div", { class: "home-creators-header" }, [
      el("h2", { text: "Followed creators" }),
      el("button", {
        class: "btn btn-sm",
        text: "Add",
        onclick: () =>
          openAddCreatorModal({
            onDone: () => store.bumpData("creator-added"),
          }),
      }),
    ])
  );

  const creatorList = el("div", { class: "home-creators-list" });
  if (!creators.length) {
    creatorList.append(
      el("div", {
        class: "empty-state",
        style: "padding:16px;",
        text: "No creators yet. Add one to build your queue.",
      })
    );
  } else {
    for (const c of creators) {
      const row = el("div", { class: "home-creator-row" }, [
        el("button", {
          class: "home-creator-main",
          type: "button",
          onclick: () => navigate(`/creator/${c.id}`),
        }, [
          c.thumbnail_url
            ? el("img", {
                class: "home-creator-avatar",
                src: c.thumbnail_url,
                alt: "",
              })
            : el("div", {
                class: "home-creator-avatar home-creator-avatar--fallback",
                text: (c.name || "?").slice(0, 1).toUpperCase(),
              }),
          el("div", { class: "home-creator-meta" }, [
            el("div", { class: "home-creator-name", text: c.name || "Creator" }),
            el("div", {
              class: "muted",
              text: `${c.video_count ?? 0} videos`,
            }),
          ]),
        ]),
        el("button", {
          class: "btn btn-sm btn-danger home-creator-remove",
          type: "button",
          title: `Remove ${c.name || "creator"}`,
          text: "Remove",
          onclick: async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const btn = e.currentTarget;
            if (!confirm(`Remove ${c.name || "this creator"} from your list?`)) return;
            btn.disabled = true;
            btn.textContent = "…";
            try {
              await removeCreatorFollow(c);
            } catch (err) {
              alert(err.message || "Could not remove creator");
              btn.disabled = false;
              btn.textContent = "Remove";
            }
          },
        }),
      ]);
      creatorList.append(row);
    }
  }
  sideCol.append(creatorList);

  if (status?.setup?.platform === "vercel" && status?.credentials?.database_durable === false) {
    mainCol.prepend(
      el("div", {
        class: "stat-card",
        style: "margin-bottom:18px;",
      }, [
        el("div", { class: "label", text: "Database" }),
        el("div", {
          class: "value",
          style: "font-size:16px;",
          text: "Not durable yet",
        }),
        el("p", {
          class: "muted",
          style: "margin:8px 0 0;line-height:1.5;",
          text: status?.setup?.hint || "Add a durable DATABASE_URL so data persists.",
        }),
      ])
    );
  }

  layout.append(mainCol, sideCol);
  root.replaceChildren(layout);
}
