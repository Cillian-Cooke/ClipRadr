import { api, formatTime } from "/js/api.js";
import { navigate, route, dispatch, normalizePath } from "/js/router.js";
import { renderShell, el } from "/js/components/Sidebar.js";
import { renderLanding } from "/js/pages/landing.js";
import { renderHome } from "/js/pages/home.js";
import { renderCreators } from "/js/pages/creators.js";
import { renderCreator } from "/js/pages/creator.js";
import { renderVideo } from "/js/pages/video.js";
import { renderClips } from "/js/pages/clips.js";
import { renderSaved } from "/js/pages/saved.js";
import { renderSearch } from "/js/pages/search.js";
import { renderSettings } from "/js/pages/settings.js";
import { renderVideosIndex } from "/js/pages/videos.js";
import { renderLogin } from "/js/pages/login.js";
import { store } from "/js/store.js";
import {
  initAuth,
  onAuthChange,
  isSignedIn,
  getUser,
  hasCachedFirebaseSession,
  isSessionLocked,
} from "/js/auth.js";
import {
  startBackgroundWorker,
  restoreFollowedCreators,
  kickBackgroundScans,
} from "/js/background.js";

let authRequired = false;
let authReady = false;
let workspaceStarted = false;
let lastAuthUid = null;
let mountedPath = null;

function requireAuthGate(path) {
  if (isSessionLocked() || isSignedIn()) return false;
  return authRequired && authReady && path !== "/" && path !== "/login";
}

function currentPath() {
  return normalizePath(window.location.pathname || "/");
}

function showBootLoading(message = "Restoring session…") {
  const appEl = document.getElementById("app");
  if (!appEl) return;
  appEl.replaceChildren(el("div", { class: "loading-state", text: message }));
}

function mount(path, renderer) {
  if (requireAuthGate(path)) {
    history.replaceState({}, "", "/login");
    renderLogin();
    mountedPath = "/login";
    return;
  }
  // Idempotent: same route already on screen → do not remount (duplicate Sign out bug).
  if (mountedPath === path && document.querySelector("#app .app-shell")) {
    return;
  }
  const root = el("div");
  renderShell(path, root);
  renderer(root);
  mountedPath = path;
}

route("/", () => {
  if (!authReady && authRequired) {
    showBootLoading();
    return;
  }
  if (authRequired && isSignedIn()) {
    history.replaceState({}, "", "/home");
    mount("/home", renderHome);
    return;
  }
  if (authRequired) {
    history.replaceState({}, "", "/login");
    renderLogin();
    mountedPath = "/login";
    return;
  }
  renderLanding();
});

route("/login", () => {
  if (!authReady) {
    showBootLoading();
    return;
  }
  if (isSignedIn()) {
    history.replaceState({}, "", "/home");
    mount("/home", renderHome);
    return;
  }
  renderLogin();
  mountedPath = "/login";
});

route("/home", () => mount("/home", renderHome));
route("/creators", () => mount("/creators", renderCreators));
route("/creator/:id", ({ id }) => mount("/creators", (root) => renderCreator(root, id)));
route("/video/:id", ({ id }) => {
  if (requireAuthGate(`/video/${id}`)) {
    history.replaceState({}, "", "/login");
    renderLogin();
    mountedPath = "/login";
    return;
  }
  const root = el("div");
  renderShell(`/video/${id}`, root, { contentClass: "workspace" });
  renderVideo(root, id);
  mountedPath = `/video/${id}`;
});
route("/clips", () => mount("/clips", renderClips));
route("/saved", () => mount("/saved", renderSaved));
route("/videos", () => mount("/videos", renderVideosIndex));
route("/settings", () => mount("/settings", renderSettings));
route("/search", () => mount("/search", renderSearch));

function startWorkspaceSync({ force = false } = {}) {
  if (authRequired && !isSignedIn()) return;
  const user = getUser();
  const switched = store.bindAccount(user?.uid || null);
  if (!force && workspaceStarted && !switched) {
    kickBackgroundScans();
    return;
  }
  workspaceStarted = true;
  restoreFollowedCreators()
    .catch((e) => console.warn("restore failed", e))
    .finally(() => kickBackgroundScans());
}

/**
 * Enter the signed-in app.
 * NEVER steal a deep link (e.g. /creators) back to /home on session restore.
 */
function enterSignedInApp({ preferHome = false } = {}) {
  const path = currentPath();
  const onAuthScreen = path === "/" || path === "/login" || path === "/login.html";

  if (preferHome || onAuthScreen) {
    history.replaceState({}, "", "/home");
    mount("/home", renderHome);
  } else if (!workspaceStarted) {
    dispatch();
  }
  // If already mounted for this session, leave the DOM alone.
  startWorkspaceSync();
}

async function boot() {
  startBackgroundWorker();

  try {
    const status = await api.status();
    store.setStatus(status);
    authRequired = !!status?.auth?.auth_required;
  } catch (e) {
    console.warn("status failed", e);
  }

  if (authRequired) {
    showBootLoading(
      hasCachedFirebaseSession() ? "Restoring session…" : "Starting ClipRadar…"
    );
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
  }

  lastAuthUid = getUser()?.uid || null;

  // Single entry into the workspace after auth settles — do not also mount
  // from the onAuthChange eager callback (that caused duplicate shells).
  if (!authRequired || isSignedIn()) {
    if (!authRequired) {
      dispatch();
      startWorkspaceSync();
    } else {
      const path = currentPath();
      const onAuthScreen = path === "/" || path === "/login" || path === "/login.html";
      enterSignedInApp({ preferHome: onAuthScreen });
    }
  } else {
    history.replaceState({}, "", "/login");
    renderLogin();
    mountedPath = "/login";
  }

  onAuthChange((user) => {
    const uid = user?.uid || null;

    if (!user) {
      if (isSessionLocked()) return;
      lastAuthUid = null;
      workspaceStarted = false;
      mountedPath = null;
      store.bindAccount(null);
      if (currentPath() !== "/login") history.replaceState({}, "", "/login");
      renderLogin();
      return;
    }

    // Same user already running — ignore (tab focus restore).
    if (uid === lastAuthUid && workspaceStarted) return;

    const firstSignIn = !lastAuthUid;
    lastAuthUid = uid;
    // Only jump to Home when coming from a true signed-out state onto an auth screen.
    // Session restore on /creators must stay on /creators.
    enterSignedInApp({
      preferHome: firstSignIn && (currentPath() === "/login" || currentPath() === "/"),
    });
  });

  window.addEventListener("clipradar:force-login", () => {
    if (isSessionLocked()) return;
    lastAuthUid = null;
    workspaceStarted = false;
    mountedPath = null;
    history.replaceState({}, "", "/login");
    renderLogin();
  });
}

boot().catch((e) => {
  console.error(e);
  const appEl = document.getElementById("app");
  if (appEl) {
    appEl.innerHTML = `<div class="error-state">Boot failed: ${e?.message || e}</div>`;
  }
});

window.ClipRadar = { api, navigate, formatTime, store };
