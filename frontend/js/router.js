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

export function navigate(path) {
  if (window.location.pathname !== path) {
    window.history.pushState({}, "", path);
  }
  dispatch();
}

export function dispatch() {
  const path = window.location.pathname || "/";
  for (const r of routes) {
    const match = path.match(r.regex);
    if (!match) continue;
    const params = {};
    r.keys.forEach((k, i) => {
      params[k] = decodeURIComponent(match[i + 1]);
    });
    r.handler(params);
    return;
  }
  routes.find((r) => r.regex.source === "^\\/$")?.handler({}) ||
    document.getElementById("app").replaceChildren(
      Object.assign(document.createElement("div"), {
        className: "error-state",
        textContent: "Page not found",
      })
    );
}

window.addEventListener("popstate", dispatch);

document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-link]");
  if (!a) return;
  e.preventDefault();
  navigate(a.getAttribute("href"));
});
