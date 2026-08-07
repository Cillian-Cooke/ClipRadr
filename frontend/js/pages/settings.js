import { api, downloadAuthed, formatTime } from "../api.js";
import { el, loading, error } from "../components/Sidebar.js";

export async function renderSettings(root) {
  root.replaceChildren(loading());
  try {
    const [status, me, exportsRes] = await Promise.all([
      api.statusCheck(),
      api.me().catch(() => null),
      api.listExports().catch(() => ({ exports: [] })),
    ]);
    const ytPresent = status.credentials.youtube_api_key;
    const ytOk = !!status.credentials.youtube_api_valid;
    const ytError = status.credentials.youtube_api_error;
    const ffmpeg = status.capabilities.export_clips;
    const ytdlp = !!status.capabilities.ytdlp;
    const ytExport = !!status.capabilities.export_youtube_clips;
    const onVercel = status.setup.platform === "vercel";
    const durable = !!status.credentials.database_durable;
    const dbBackend = status.credentials.database_backend || "unknown";
    const auth = status.auth || {};

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
          ? "A key is set on Vercel, but YouTube rejected it."
          : "A key is set in .env, but YouTube rejected it.");
    }

    const dbLabel = durable
      ? dbBackend === "postgres"
        ? "Postgres (durable)"
        : "Local SQLite"
      : "Ephemeral (/tmp SQLite)";
    const dbHint = durable
      ? dbBackend === "postgres"
        ? "Creators, videos, and moments survive Vercel cold starts."
        : "Local disk SQLite is fine for development."
      : "Vercel wipes /tmp on cold starts. Add a Neon DATABASE_URL.";

    const setupText = !durable && onVercel
      ? "1. Create a free Neon project → copy the pooled connection string\n2. Vercel → Settings → Environment Variables\n   DATABASE_URL = postgresql://…?sslmode=require\n   YOUTUBE_API_KEY = your key\n   DEMO_MODE = false\n3. Deployments → Redeploy"
      : onVercel
        ? "Vercel → your project → Settings → Environment Variables"
        : `# ${status.setup.env_file}\nYOUTUBE_API_KEY=your_key_here\nFIREBASE_PROJECT_ID=...\nFIREBASE_CREDENTIALS_PATH=./secrets/firebase-service-account.json\nFIREBASE_WEB_API_KEY=...\n\n# Restart:\nuvicorn backend.main:app --reload --host localhost --port 8001`;

    const finished = exportsRes.exports || [];

    root.replaceChildren(
      el("div", {}, [
        el("div", { class: "page-header" }, [
          el("h1", { text: "Settings" }),
          el("p", {
            text: onVercel
              ? "Credentials come from Vercel Environment Variables."
              : "Credentials, account, and finished clip exports.",
          }),
        ]),

        el("div", { class: "section-title", text: "Account" }),
        me
          ? card(
              "Signed in",
              me.bypass ? `${me.email} (local bypass)` : me.email || me.name,
              me.bypass
                ? "Firebase not configured — using local workspace user. Add FIREBASE_* to .env when ready."
                : `Plan: ${me.plan}. Free plan = ${status.limits?.free_exports_per_day || 3} exports/day. Set users/{uid}.plan = "pro" in Firestore to upgrade.`,
              !me.bypass
            )
          : card("Signed in", "Unknown", "Could not load /api/account/me"),

        card(
          "Firebase",
          auth.firebase_ready
            ? "Admin ready"
            : auth.firebase_configured
              ? "Configured but failed to start"
              : "Not configured",
          auth.firebase_ready
            ? "Auth tokens verified; users/exports mirrored to Firestore."
            : [
                auth.firebase_error ||
                  "Railway needs FIREBASE_CREDENTIALS_JSON (paste service-account JSON), web config vars, and DEV_AUTH_BYPASS=false.",
                !auth.web_config_complete
                  ? "Also set FIREBASE_WEB_API_KEY + FIREBASE_APP_ID so the browser can sign in."
                  : null,
                auth.dev_auth_bypass
                  ? "DEV_AUTH_BYPASS is true — turn it false on Railway after Firebase works."
                  : null,
                "Local helper: bash scripts/print_railway_firebase_env.sh",
              ]
                .filter(Boolean)
                .join(" "),
          !!auth.firebase_ready
        ),

        el("div", { class: "section-title", style: "margin-top:28px;", text: "Finished exports" }),
        finished.length
          ? el(
              "div",
              { class: "card-list", style: "max-width:640px;" },
              finished.map((ex) => {
                const label =
                  ex.start_label && ex.end_label
                    ? `${ex.start_label} → ${ex.end_label}`
                    : ex.startSeconds != null
                      ? `${formatTime(ex.startSeconds)} → ${formatTime(ex.endSeconds)}`
                      : "Clip";
                const row = el("div", { class: "opportunity-card" }, [
                  el("div", {}, [
                    el("h3", {
                      text: `Video #${ex.videoId || ex.sqlJobId || "—"}`,
                      style: "margin:0;font-size:15px;",
                    }),
                    el("div", { class: "muted", text: `${label} · ${ex.status}` }),
                    ex.error
                      ? el("div", { class: "muted", style: "color:#b45309;", text: ex.error })
                      : null,
                  ]),
                  ex.downloadUrl && ex.status === "COMPLETED"
                    ? el("button", {
                        class: "btn btn-sm btn-primary",
                        text: "Download",
                        onclick: async (e) => {
                          const btn = e.currentTarget;
                          btn.disabled = true;
                          try {
                            await downloadAuthed(ex.downloadUrl, `clip_${ex.sqlJobId || "export"}.mp4`);
                          } catch (err) {
                            alert(err.message);
                          } finally {
                            btn.disabled = false;
                          }
                        },
                      })
                    : el("span", { class: "badge", text: ex.status || "—" }),
                ]);
                return row;
              })
            )
          : el("div", {
              class: "muted",
              style: "margin-bottom:16px;",
              text: "No exports yet. Open a video, set IN/OUT, then Export MP4.",
            }),

        el("div", { class: "section-title", style: "margin-top:28px;", text: "Credentials" }),
        card("YouTube Data API", ytLabel, ytHint, ytOk),
        card("Database", dbLabel, dbHint, durable),
        card(
          "FFmpeg export",
          ffmpeg ? "Ready" : "Missing",
          ffmpeg
            ? "Local source and YouTube section clips can be encoded to MP4."
            : "Install ffmpeg (or keep imageio-ffmpeg) to export clips.",
          ffmpeg
        ),
        card(
          "yt-dlp (YouTube clips)",
          ytExport ? "Ready" : ytdlp ? "Installed (Vercel blocked)" : "Missing",
          ytExport
            ? "Can auto-download the selected IN→OUT range from YouTube."
            : ytdlp
              ? "yt-dlp is present but clip export is disabled on Vercel serverless — run locally."
              : "pip install yt-dlp  — required for live YouTube clip download without attached media.",
          ytExport
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
          el("pre", {
            class: "mono",
            style:
              "margin:12px 0 0;padding:12px;background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:6px;font-size:12px;overflow:auto;white-space:pre-wrap;",
            text: setupText,
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
