import { store } from "/js/store.js";
import { openAddCreatorModal } from "./AddCreator.js";
import { api } from "../api.js";
import {
  subscribeExports,
  dismissExportJob,
  downloadExportJob,
} from "/js/exports.js";

const NAV = [
  { href: "/home", label: "Home", icon: "⌂" },
  { href: "/videos", label: "Videos", icon: "▶" },
  { href: "/clips", label: "Clip Opportunities", icon: "◆" },
];

let unsubExports = null;

export function renderShell(
  activePath,
  contentNode,
  { topbarExtra = null, contentClass = "" } = {}
) {
  const app = document.getElementById("app");
  app.replaceChildren();

  const shell = el("div", { class: "app-shell" });
  const sidebar = el("aside", { class: "sidebar" });

  const brand = el("a", {
    class: "brand",
    href: "/home",
    "data-link": "1",
    "aria-label": "ClipRadr home",
  });
  brand.append(
    el("img", {
      class: "brand-logo",
      src: "/assets/logo.png",
      alt: "ClipRadr",
      width: "36",
      height: "36",
    }),
    el("div", {}, [
      el("div", { class: "brand-name", text: "ClipRadr" }),
      el("div", { class: "brand-sub", text: "Editor Workstation" }),
    ])
  );
  sidebar.append(brand);

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

  const downloads = el("div", {
    class: "sidebar-downloads",
    hidden: true,
  });
  sidebar.append(downloads);

  if (typeof unsubExports === "function") {
    try {
      unsubExports();
    } catch {
      /* ignore */
    }
  }
  unsubExports = subscribeExports((jobs) => paintDownloads(downloads, jobs));

  const footer = el("div", { class: "sidebar-footer" });

  const accountBox = el("div", { class: "sidebar-account" });
  const accountLabel = el("div", {
    class: "sidebar-account-label",
    text: "Account",
  });
  const accountEmail = el("div", {
    class: "sidebar-account-email",
    text: "Loading…",
  });
  const accountActions = el("div", { class: "sidebar-account-actions" });
  accountBox.append(accountLabel, accountEmail, accountActions);
  footer.append(accountBox);

  footer.append(
    el("a", {
      href: "/settings",
      "data-link": "1",
      class: `btn btn-settings ${activePath === "/settings" ? "active" : ""}`,
    }, [
      el("span", { class: "nav-icon", text: "⚙" }),
      el("span", { class: "label", text: "Settings" }),
    ])
  );
  sidebar.append(footer);

  import("/js/auth.js").then(async ({ getUser, signOut, onAuthChange, isSignedIn }) => {
    const paintAccount = async () => {
      accountActions.replaceChildren();
      const user = getUser();
      if (!isSignedIn() && !user) {
        accountEmail.textContent = "Not signed in";
        return;
      }
      try {
        const me = await api.me();
        const email =
          me.email ||
          user?.email ||
          me.display_name ||
          user?.displayName ||
          "Signed in";
        accountEmail.textContent = email;
        accountEmail.title = email;
        if (!me.bypass) {
          accountActions.append(
            el("button", {
              class: "btn btn-sm btn-logout",
              text: "Log out",
              onclick: async () => {
                await signOut();
                window.location.replace("/login");
              },
            })
          );
        } else {
          accountEmail.textContent = me.email || "Local workspace";
        }
      } catch {
        accountEmail.textContent = user?.email || "Signed in";
        accountActions.append(
          el("button", {
            class: "btn btn-sm btn-logout",
            text: "Log out",
            onclick: async () => {
              await signOut();
              window.location.replace("/login");
            },
          })
        );
      }
    };
    paintAccount();
    onAuthChange(() => paintAccount());
  }).catch(() => {
    accountEmail.textContent = "Account unavailable";
  });

  const main = el("main", { class: "main" });
  const topbar = el("div", { class: "topbar" });

  const accountWrap = el("div", { class: "topbar-account" });
  accountWrap.append(
    el("button", {
      class: "btn btn-primary btn-sm",
      text: "+ Add Creator",
      onclick: () =>
        openAddCreatorModal({
          onDone: () => store.bumpData("creator-added"),
        }),
    })
  );
  topbar.append(accountWrap);

  if (topbarExtra) topbar.append(topbarExtra);

  const content = el("div", { class: `content ${contentClass}`.trim() });
  content.append(contentNode);

  main.append(topbar, content);
  shell.append(sidebar, main);
  app.append(shell);
}

function paintDownloads(host, jobs) {
  if (!host.isConnected) return;
  host.replaceChildren();
  if (!jobs.length) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  host.append(el("div", { class: "sidebar-downloads-title", text: "Downloads" }));

  for (const job of jobs) {
    const busy = job.status === "QUEUED" || job.status === "PROCESSING";
    const done = job.status === "COMPLETED";
    const failed = job.status === "FAILED";
    const pct = Math.min(100, Math.max(busy ? 8 : 0, Number(job.progress) || 0));

    const card = el("div", {
      class: `sidebar-download-card ${busy ? "is-busy" : ""} ${done ? "is-done" : ""} ${failed ? "is-failed" : ""}`,
    });

    const head = el("div", { class: "sidebar-download-head" });
    if (busy) {
      head.append(el("span", { class: "sidebar-download-spinner", "aria-hidden": "true" }));
    } else if (done) {
      head.append(el("span", { class: "sidebar-download-check", text: "✓" }));
    } else {
      head.append(el("span", { class: "sidebar-download-check", text: "!" }));
    }
    head.append(
      el("div", { class: "sidebar-download-meta" }, [
        el("div", {
          class: "sidebar-download-label",
          text: job.label || "Clip export",
          title: job.label || "Clip export",
        }),
        el("div", {
          class: "sidebar-download-status",
          text: busy
            ? `Downloading… ${Math.round(pct)}%`
            : done
              ? "Ready"
              : job.error || "Failed",
        }),
      ])
    );
    card.append(head);

    if (busy || done) {
      card.append(
        el("div", { class: "sidebar-download-bar" }, [
          el("span", { style: `width:${done ? 100 : pct}%` }),
        ])
      );
    }

    const actions = el("div", { class: "sidebar-download-actions" });
    if (done && job.download_url) {
      actions.append(
        el("button", {
          class: "btn btn-primary btn-sm",
          text: "Save",
          type: "button",
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.textContent = "Saving…";
            try {
              await downloadExportJob(job.id);
              btn.textContent = "Saved";
            } catch (err) {
              btn.disabled = false;
              btn.textContent = "Save";
              alert(err.message || "Download failed");
            }
          },
        })
      );
    }
    if (done || failed) {
      actions.append(
        el("button", {
          class: "btn btn-sm",
          text: "Dismiss",
          type: "button",
          onclick: () => dismissExportJob(job.id),
        })
      );
    }
    if (actions.childNodes.length) card.append(actions);
    host.append(card);
  }
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
