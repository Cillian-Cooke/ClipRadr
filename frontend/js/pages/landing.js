import { navigate } from "../router.js";
import { el } from "../components/Sidebar.js";

export function renderLanding() {
  const app = document.getElementById("app");
  const page = el("div", { class: "landing" }, [
    el("div", { class: "landing-copy" }, [
      el("div", { class: "brand" }, [
        el("div", { class: "brand-mark", text: "CR" }),
        el("div", { class: "brand-name", text: "ClipRadar" }),
      ]),
      el("h1", { text: "Find the moments worth clipping." }),
      el("p", {
        text: "Turn hours of VODs into an editor-ready queue of audience-backed clips.",
      }),
      el("div", { class: "landing-actions" }, [
        el("button", {
          class: "btn btn-primary",
          text: "Open Workspace",
          onclick: () => navigate("/home"),
        }),
        el("button", {
          class: "btn",
          text: "Add a creator",
          onclick: () => navigate("/creators"),
        }),
      ]),
    ]),
    el("div", { class: "landing-visual" }, [
      el("div", { class: "workspace-mock" }, [
        el("div", { class: "mock-player" }),
        el("div", { class: "mock-timeline" }, [
          el("div", { class: "mock-marker", style: "left:18%" }),
          el("div", { class: "mock-marker", style: "left:34%" }),
          el("div", { class: "mock-marker", style: "left:47%" }),
          el("div", { class: "mock-marker", style: "left:71%" }),
        ]),
      ]),
    ]),
  ]);
  app.replaceChildren(page);
}
