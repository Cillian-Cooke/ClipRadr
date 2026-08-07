import { navigate } from "../router.js";
import { store } from "../store.js";
import { looksLikeChannelQuery, openAddCreatorModal } from "./AddCreator.js";
import { api } from "../api.js";

const NAV = [
  { href: "/home", label: "Home", icon: "⌂" },
  { href: "/creators", label: "Creators", icon: "◎" },
  { href: "/clips", label: "Clip Opportunities", icon: "◆" },
  { href: "/videos", label: "Videos", icon: "▶" },
  { href: "/saved", label: "Saved Clips", icon: "★" },
];

export function renderShell(
  activePath,
  contentNode,
  { topbarExtra = null, contentClass = "" } = {}
) {
  const app = document.getElementById("app");
  app.replaceChildren();

  const shell = el("div", { class: "app-shell" });
  const sidebar = el("aside", { class: "sidebar" });

  sidebar.append(
    el("div", { class: "brand" }, [
      el("div", { class: "brand-mark", text: "CR" }),
      el("div", {}, [
        el("div", { class: "brand-name", text: "ClipRadar" }),
        el("div", { class: "brand-sub", text: "Editor Workstation" }),
      ]),
    ])
  );

  const nav = el("nav", { class: "nav" });
  for (const item of NAV) {
    const active =
      activePath === item.href ||
      (item.href !== "/home" && activePath.startsWith(item.href));
    nav.append(
      el("a", {
        href: item.href,
        "data-link": "1",
        class: active ? "active" : "",
      }, [
        el("span", { class: "nav-icon", text: item.icon }),
        el("span", { class: "label", text: item.label }),
      ])
    );
  }
  sidebar.append(nav);

  const footer = el("div", { class: "sidebar-footer" });
  const scanPill = el("div", { class: "demo-pill", text: "Idle" });
  const updatePill = () => {
    const { pending, busy } = store.scanProgress();
    const creators = store.get().creators || [];
    const followed = store.get().followedChannels || [];
    const moments = store.get().home?.stats?.clip_moments_found || 0;
    const videos = store.get().home?.stats?.videos_scanned || 0;

    if (busy || pending > 0) {
      scanPill.textContent = `Scanning ${pending} video${pending === 1 ? "" : "s"}…`;
      scanPill.classList.add("scanning");
    } else if (creators.length) {
      scanPill.textContent =
        moments > 0
          ? `${moments} moments · live`
          : videos > 0
            ? `${videos} videos · ready`
            : `${creators.length} creator${creators.length === 1 ? "" : "s"}`;
      scanPill.classList.remove("scanning");
    } else if (followed.length) {
      scanPill.textContent = "Restoring creators…";
      scanPill.classList.add("scanning");
    } else {
      scanPill.textContent = "Ready";
      scanPill.classList.remove("scanning");
    }
  };
  updatePill();
  store.subscribe(updatePill);
  footer.append(scanPill);
  footer.append(
    el("a", { href: "/settings", "data-link": "1", class: activePath === "/settings" ? "active" : "" }, [
      el("span", { class: "nav-icon", text: "⚙" }),
      el("span", { class: "label", text: "Settings" }),
    ])
  );
  sidebar.append(footer);

  const main = el("main", { class: "main" });
  const topbar = el("div", { class: "topbar" });
  const searchWrap = el("div", { class: "search-wrap" });
  const search = el("input", {
    type: "search",
    placeholder: "Search library, or paste a YouTube channel / @handle…",
  });
  search.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !search.value.trim()) return;
    const q = search.value.trim();
    if (looksLikeChannelQuery(q)) {
      openAddCreatorModal({
        initialQuery: q,
        onDone: () => store.bumpData("creator-added"),
      });
      return;
    }
    navigate(`/search?q=${encodeURIComponent(q)}`);
  });
  searchWrap.append(search);
  topbar.append(searchWrap);
  topbar.append(
    el("button", {
      class: "btn btn-primary btn-sm",
      text: "+ Add Creator",
      onclick: () =>
        openAddCreatorModal({
          initialQuery: search.value.trim(),
          onDone: () => store.bumpData("creator-added"),
        }),
    })
  );

  // Account chip (plan / sign out) — filled async
  const accountWrap = el("div", { class: "topbar-account", style: "display:flex;align-items:center;gap:8px;" });
  topbar.append(accountWrap);
  import("../auth.js").then(async ({ getUser, signOut, onAuthChange, isSignedIn }) => {
    const paint = async () => {
      accountWrap.replaceChildren();
      if (!isSignedIn() && !getUser()) {
        // Avoid hammering /api/account/me with 401s before login
        return;
      }
      try {
        const me = await api.me();
        const plan = me.plan || "free";
        accountWrap.append(
          el("span", {
            class: "badge",
            text: me.bypass ? "Local" : plan.toUpperCase(),
            title: me.email || "",
          })
        );
        if (!me.bypass) {
          accountWrap.append(
            el("button", {
              class: "btn btn-sm",
              text: "Sign out",
              onclick: async () => {
                await signOut();
                navigate("/login");
              },
            })
          );
        }
      } catch {
        const u = getUser();
        if (u) {
          accountWrap.append(el("span", { class: "badge", text: u.email || "Signed in" }));
        }
      }
    };
    paint();
    onAuthChange(() => paint());
  }).catch(() => {});

  if (topbarExtra) topbar.append(topbarExtra);

  const content = el("div", { class: `content ${contentClass}`.trim() });
  content.append(contentNode);

  main.append(topbar, content);
  shell.append(sidebar, main);
  app.append(shell);
}


export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "class") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function loading(msg = "Loading…") {
  return el("div", { class: "loading-state", text: msg });
}

export function empty(msg) {
  return el("div", { class: "empty-state", text: msg });
}

export function error(msg) {
  return el("div", { class: "error-state", text: msg });
}
