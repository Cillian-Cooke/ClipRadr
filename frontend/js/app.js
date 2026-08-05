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
  renderShell(`/video/${id}`, root, { contentClass: "workspace" });
  renderVideo(root, id);
});
route("/clips", () => mount("/clips", renderClips));
route("/saved", () => mount("/saved", renderSaved));
route("/videos", () => mount("/videos", renderVideosIndex));
route("/settings", () => mount("/settings", renderSettings));
route("/search", () => mount("/search", renderSearch));

dispatch();

// Expose helpers for debugging in demo
window.ClipRadar = { api, navigate, formatTime };
