const routes = [];

export function route(pattern, handler) {
  const keys = [];
  const regex = new RegExp(
    "^" +
      pattern.replace(/\//g, "\\/").replace(/:([A-Za-z_]+)/g, (_, key) => {
        keys.push(key);
        return "([^/]+)";
      }) +
      "$"
  );
  routes.push({ regex, keys, handler });
}

/** Resolve real app path even behind Cursor/VS Code port proxies. */
export function normalizePath(pathname) {
  let path = pathname || "/";
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep raw */
  }
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

  if (path === "/index.html" || path.endsWith("/index.html")) return "/";

  const known = [
    "/login",
    "/home",
    "/creators",
    "/clips",
    "/saved",
    "/videos",
    "/settings",
    "/search",
  ];
  for (const k of known) {
    if (path === k || path.endsWith(k)) return k;
  }

  const video = path.match(/\/video\/([^/]+)/);
  if (video) return `/video/${video[1]}`;
  const creator = path.match(/\/creator\/([^/]+)/);
  if (creator) return `/creator/${creator[1]}`;

  // Proxy prefixes: keep only the last segment if it looks empty → home
  if (path.includes("/proxy/") || path.includes("/.cursor/") || path.includes("/ide/")) {
    return "/";
  }

  return path || "/";
}

export function navigate(path) {
  const next = normalizePath(path);
  if (normalizePath(window.location.pathname) !== next) {
    window.history.pushState({}, "", next);
  }
  dispatch();
}

export function dispatch() {
  const path = normalizePath(window.location.pathname);
  for (const r of routes) {
    const match = path.match(r.regex);
    if (!match) continue;
    const params = {};
    r.keys.forEach((k, i) => {
      params[k] = decodeURIComponent(match[i + 1]);
    });
    try {
      r.handler(params);
    } catch (e) {
      console.error("Route handler failed", path, e);
      const app = document.getElementById("app");
      if (app) {
        app.innerHTML = `<div class="error-state">Screen failed: ${e?.message || e}</div>`;
      }
    }
    return;
  }

  // No match usually means a duplicate ESM instance (empty routes[]) or a
  // brand-new path. Prefer staying put over a fake login card.
  console.warn("No route matched", window.location.pathname, "→ normalized", path, "routes=", routes.length);
  if (typeof window.__clipradarFallback === "function") {
    window.__clipradarFallback(path);
    return;
  }
  if (routes.length === 0) {
    // Wrong module graph — wait for the real app boot instead of nuking the DOM.
    return;
  }
  const app = document.getElementById("app");
  if (app && !app.querySelector(".app-shell")) {
    app.innerHTML =
      `<div class="loading-state">Loading ${path}…</div>`;
  }
}

window.addEventListener("popstate", dispatch);

document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-link]");
  if (!a) return;
  e.preventDefault();
  navigate(a.getAttribute("href"));
});
