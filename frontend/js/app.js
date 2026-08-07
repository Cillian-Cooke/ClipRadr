import { api, formatTime } from "./api.js";
import { navigate, route, dispatch } from "./router.js";
import { renderShell, el } from "./components/Sidebar.js";
import { renderLanding } from "./pages/landing.js";
import { renderHome } from "./pages/home.js";
import { renderCreators } from "./pages/creators.js";
import { renderCreator } from "./pages/creator.js";
import { renderVideo } from "./pages/video.js";
import { renderClips } from "./pages/clips.js";
import { renderSaved } from "./pages/saved.js";
import { renderSearch } from "./pages/search.js";
import { renderSettings } from "./pages/settings.js";
import { renderVideosIndex } from "./pages/videos.js";
import { renderLogin } from "./pages/login.js";
import { store } from "./store.js";
import { initAuth, onAuthChange, isSignedIn } from "./auth.js";
import {
  startBackgroundWorker,
  restoreFollowedCreators,
  kickBackgroundScans,
} from "./background.js";

let authRequired = false;
let authReady = false;

function requireAuthGate(path) {
  return authRequired && authReady && !isSignedIn() && path !== "/" && path !== "/login";
}

function mount(path, renderer) {
  if (requireAuthGate(path)) {
    renderLogin();
    history.replaceState({}, "", "/login");
    return;
  }
  const root = el("div");
  renderShell(path, root);
  renderer(root);
}

route("/", () => {
  if (authRequired && authReady && !isSignedIn()) {
    history.replaceState({}, "", "/login");
    renderLogin();
    return;
  }
  if (authRequired && authReady && isSignedIn()) {
    history.replaceState({}, "", "/home");
    mount("/home", renderHome);
    return;
  }
  renderLanding();
});

route("/login", () => {
  if (authReady && isSignedIn()) {
    history.replaceState({}, "", "/home");
    mount("/home", renderHome);
    return;
  }
  renderLogin();
});

route("/home", () => mount("/home", renderHome));
route("/creators", () => mount("/creators", renderCreators));
route("/creator/:id", ({ id }) => mount("/creators", (root) => renderCreator(root, id)));
route("/video/:id", ({ id }) => {
  if (requireAuthGate(`/video/${id}`)) {
    history.replaceState({}, "", "/login");
    renderLogin();
    return;
  }
  const root = el("div");
  renderShell(`/video/${id}`, root, { contentClass: "workspace" });
  renderVideo(root, id);
});
route("/clips", () => mount("/clips", renderClips));
route("/saved", () => mount("/saved", renderSaved));
route("/videos", () => mount("/videos", renderVideosIndex));
route("/settings", () => mount("/settings", renderSettings));
route("/search", () => mount("/search", renderSearch));

function startWorkspaceSync() {
  if (authRequired && !isSignedIn()) return;
  restoreFollowedCreators()
    .catch((e) => console.warn("restore failed", e))
    .finally(() => kickBackgroundScans());
}

async function boot() {
  startBackgroundWorker();

  // Always show login chrome first so the page never looks broken
  // while Firebase initializes.
  try {
    const status = await api.status();
    store.setStatus(status);
    authRequired = !!status?.auth?.auth_required;
  } catch (e) {
    console.warn("status failed", e);
  }

  if (authRequired) {
    history.replaceState({}, "", "/login");
    renderLogin();
  } else {
    dispatch();
  }

  try {
    const info = await initAuth();
    authReady = true;
    if (info.authRequired) authRequired = true;
  } catch (e) {
    console.error("Auth init failed", e);
    authReady = true;
    const appEl = document.getElementById("app");
    if (authRequired && appEl) {
      appEl.insertAdjacentHTML(
        "beforeend",
        `<p class="error-state" style="margin:16px">Firebase failed: ${e?.message || e}</p>`
      );
    }
  }

  onAuthChange((user) => {
    if (authRequired && !user) {
      window.location.replace("/login");
      return;
    }
    if (user) {
      history.replaceState({}, "", "/home");
      mount("/home", renderHome);
      startWorkspaceSync();
    }
  });

  window.__clipradarFallback = () => {
    window.location.replace("/login");
  };

  if (!authRequired || isSignedIn()) {
    if (!authRequired) dispatch();
    else {
      history.replaceState({}, "", "/home");
      mount("/home", renderHome);
    }
    startWorkspaceSync();
  } else {
    window.location.replace("/login");
  }
}

boot().catch((e) => {
  console.error(e);
  const appEl = document.getElementById("app");
  if (appEl) {
    appEl.innerHTML = `<div class="error-state">Boot failed: ${e?.message || e}</div>`;
  }
});

window.ClipRadar = { api, navigate, formatTime, store };
