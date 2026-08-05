import { api, formatTime } from "./api.js";
import { navigate, route, dispatch } from "./router.js";
import { renderShell, el, loading, error } from "./components/Sidebar.js";
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
import { store } from "./store.js";
import {
  startBackgroundWorker,
  restoreFollowedCreators,
  kickBackgroundScans,
} from "./background.js";

function mount(path, renderer) {
  const root = el("div");
  renderShell(path, root);
  renderer(root);
}

route("/", () => renderLanding());
route("/home", () => mount("/home", renderHome));
route("/creators", () => mount("/creators", renderCreators));
route("/creator/:id", ({ id }) => mount("/creators", (root) => renderCreator(root, id)));
route("/video/:id", ({ id }) => {
  const root = el("div");
  renderShell(`/video/${id}`, root, { contentClass: "workspace", hideTopbar: true });
  renderVideo(root, id);
});
route("/clips", () => mount("/clips", renderClips));
route("/saved", () => mount("/saved", renderSaved));
route("/videos", () => mount("/videos", renderVideosIndex));
route("/settings", () => mount("/settings", renderSettings));
route("/search", () => mount("/search", renderSearch));

async function boot() {
  startBackgroundWorker();
  // Paint UI immediately — never block on restore/YouTube.
  dispatch();

  try {
    const status = await api.status();
    store.setStatus(status);
  } catch {
    /* ignore */
  }

  // Restore / sync in the background so Add Creator stays responsive.
  restoreFollowedCreators()
    .catch((e) => console.warn("restore failed", e))
    .finally(() => kickBackgroundScans());
}

boot();

window.ClipRadar = { api, navigate, formatTime, store };
