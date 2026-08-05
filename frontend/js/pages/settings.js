import { api } from "../api.js";
import { el, loading, error } from "../components/Sidebar.js";

export async function renderSettings(root) {
  root.replaceChildren(loading());
  try {
    const status = await api.status();
    const ytPresent = status.credentials.youtube_api_key;
    const ytOk = !!status.credentials.youtube_api_valid;
    const ytError = status.credentials.youtube_api_error;
    const ffmpeg = status.capabilities.export_clips;
    const onVercel = status.setup.platform === "vercel";

    let ytLabel = "Not configured";
    let ytHint = onVercel
      ? "Add YOUTUBE_API_KEY in Vercel → Project → Settings → Environment Variables, then redeploy."
      : "Add YOUTUBE_API_KEY to .env, then restart the server.";
    if (ytPresent && ytOk) {
      ytLabel = "Connected";
      ytHint = "Live creator search, import, and comment scanning are enabled.";
    } else if (ytPresent && !ytOk) {
      ytLabel = "Key invalid";
      ytHint =
        ytError ||
        (onVercel
          ? "A key is set on Vercel, but YouTube rejected it. Re-paste the key (no quotes), enable YouTube Data API v3, set Application restrictions to None, then redeploy."
          : "A key is set in .env, but YouTube rejected it. Check the value and API restrictions.");
    }

    root.replaceChildren(
      el("div", {}, [
        el("div", { class: "page-header" }, [
          el("h1", { text: "Settings" }),
          el("p", {
            text: onVercel
              ? "Credentials come from Vercel Environment Variables (not .env on the server)."
              : "Credentials and pipeline defaults. Keys stay server-side in .env.",
          }),
        ]),

        el("div", { class: "section-title", text: "Credentials" }),
        card("YouTube Data API", ytLabel, ytHint, ytOk),
        card(
          "FFmpeg export",
          ffmpeg ? "Ready" : "Missing",
          ffmpeg
            ? "Clip export can generate real MP4 files from local/demo source media."
            : "Install ffmpeg (or keep imageio-ffmpeg) to export clips.",
          ffmpeg
        ),
        card(
          "OpenAI embeddings",
          status.credentials.openai_api_key ? "Key present" : "Optional / unused",
          "MVP uses local embeddings. OpenAI is reserved for a later upgrade.",
          status.credentials.openai_api_key
        ),

        el("div", { class: "section-title", style: "margin-top:28px;", text: "Pipeline" }),
        card("Comments per video", String(status.limits.max_comments_per_video), "Cap for commentThreads.list during scan."),
        card("Recent videos", String(status.limits.recent_videos_limit), "Imported when a creator is added."),
        card("Cluster window", `${status.limits.cluster_window_seconds}s`, "Nearby timestamps merge into one moment."),
        card(
          "Auto-scan on add",
          status.limits.auto_scan_on_add ? "On" : "Off",
          "When on, new creators start scanning comments in the background."
        ),

        el("div", { class: "section-title", style: "margin-top:28px;", text: "Setup" }),
        el("div", { class: "stat-card", style: "max-width:640px;" }, [
          el("div", { class: "label", text: "Next step" }),
          el("p", {
            class: "muted",
            style: "margin:8px 0 0;line-height:1.5;",
            text: status.setup.hint,
          }),
          onVercel
            ? el("pre", {
                class: "mono",
                style:
                  "margin:12px 0 0;padding:12px;background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:6px;font-size:12px;overflow:auto;white-space:pre-wrap;",
                text: "Vercel → your project → Settings → Environment Variables\nName: YOUTUBE_API_KEY\nValue: paste key with no quotes\nEnvironments: Production (+ Preview)\nThen: Deployments → Redeploy",
              })
            : el("pre", {
                class: "mono",
                style:
                  "margin:12px 0 0;padding:12px;background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:6px;font-size:12px;overflow:auto;",
                text: `# ${status.setup.env_file}\nYOUTUBE_API_KEY=your_key_here\n\n# Restart:\nuvicorn backend.main:app --reload --host 0.0.0.0 --port 8001`,
              }),
        ]),
      ])
    );
  } catch (e) {
    root.replaceChildren(error(e.message));
  }
}

function card(label, value, hint, ok) {
  const node = el("div", { class: "stat-card", style: "max-width:640px;margin-bottom:12px;" }, [
    el("div", {
      style: "display:flex;justify-content:space-between;gap:12px;align-items:center;",
    }, [
      el("div", { class: "label", text: label }),
      ok == null
        ? null
        : el("span", {
            class: `badge ${ok ? "badge-scanned" : "badge-scanning"}`,
            text: ok ? "Ready" : "Needs setup",
          }),
    ]),
    el("div", { class: "value", style: "font-size:20px;", text: value }),
    el("p", { class: "muted", style: "margin:8px 0 0;", text: hint }),
  ]);
  return node;
}
