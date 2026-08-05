import { navigate } from "../router.js";
import { store } from "../store.js";

const NAV = [
  { href: "/home", label: "Home", icon: "⌂" },
  { href: "/creators", label: "Creators", icon: "◎" },
  { href: "/clips", label: "Clip Opportunities", icon: "◆" },
  { href: "/videos", label: "Videos", icon: "▶" },
  { href: "/saved", label: "Saved Clips", icon: "★" },
];

export function renderShell(activePath, contentNode, { topbarExtra = null, contentClass = "" } = {}) {
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
    placeholder: "Search creators, videos, moments, topics…",
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && search.value.trim()) {
      navigate(`/search?q=${encodeURIComponent(search.value.trim())}`);
    }
  });
  searchWrap.append(search);
  topbar.append(searchWrap);
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
