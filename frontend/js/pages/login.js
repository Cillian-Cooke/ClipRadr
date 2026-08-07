import { el } from "/js/components/Sidebar.js";
import { signInEmail, signUpEmail, signInGoogle } from "/js/auth.js";
import { navigate } from "/js/router.js";

export function renderLogin() {
  const app = document.getElementById("app");
  if (!app) return;

  const status = el("div", { class: "muted", style: "min-height:20px;margin-top:8px;" });
  const email = el("input", { type: "email", placeholder: "Email", autocomplete: "email" });
  const password = el("input", {
    type: "password",
    placeholder: "Password (min 6 characters)",
    autocomplete: "current-password",
  });
  const name = el("input", {
    type: "text",
    placeholder: "Display name (sign up)",
    autocomplete: "name",
  });

  const friendly = (err) => {
    const code = err?.code || "";
    const msg = err?.message || String(err);
    if (code.includes("email-already-in-use")) return "That email already has an account — use Sign in.";
    if (code.includes("invalid-email")) return "Enter a valid email address.";
    if (code.includes("weak-password")) return "Password must be at least 6 characters.";
    if (code.includes("wrong-password") || code.includes("invalid-credential"))
      return "Wrong email or password.";
    if (code.includes("user-not-found")) return "No account for that email — use Create account.";
    if (code.includes("operation-not-allowed"))
      return "Enable Email/Password in Firebase Console → Authentication → Sign-in method.";
    if (code.includes("unauthorized-domain"))
      return "Add localhost to Firebase Authentication → Settings → Authorized domains.";
    if (code.includes("popup-closed")) return "Google popup closed.";
    return msg.replace(/^Firebase:\s*/i, "").replace(/\s*\(auth\/.*\)\.?$/, "");
  };

  const setBusy = (busy, msg = "") => {
    status.textContent = msg;
    form.querySelectorAll("button, input").forEach((n) => {
      n.disabled = busy;
    });
  };

  const form = el("div", { class: "auth-card" }, [
    el("div", { class: "brand", style: "margin-bottom:18px;" }, [
      el("img", {
        class: "brand-logo",
        src: "/assets/logo.png",
        alt: "ClipRadr",
        width: "36",
        height: "36",
      }),
      el("div", {}, [
        el("div", { class: "brand-name", text: "ClipRadr" }),
        el("div", { class: "brand-sub", text: "Sign in" }),
      ]),
    ]),
    el("h1", { text: "Welcome back", style: "font-size:22px;margin:0 0 8px;" }),
    el("p", {
      class: "muted",
      text: "Create an account or sign in to open your workspace.",
    }),
    el("label", { text: "Email" }),
    email,
    el("label", { text: "Password", style: "margin-top:10px;" }),
    password,
    el("label", { text: "Name (for new accounts)", style: "margin-top:10px;" }),
    name,
    status,
    el("div", { class: "auth-actions" }, [
      el("button", {
        class: "btn btn-primary",
        text: "Sign in",
        onclick: async () => {
          setBusy(true, "Signing in…");
          try {
            await signInEmail(email.value.trim(), password.value);
            navigate("/home");
          } catch (e) {
            setBusy(false, friendly(e));
          }
        },
      }),
      el("button", {
        class: "btn",
        text: "Create account",
        onclick: async () => {
          setBusy(true, "Creating account…");
          try {
            await signUpEmail(email.value.trim(), password.value, name.value.trim());
            navigate("/home");
          } catch (e) {
            setBusy(false, friendly(e));
          }
        },
      }),
      el("button", {
        class: "btn",
        text: "Continue with Google",
        onclick: async () => {
          setBusy(true, "Opening Google…");
          try {
            await signInGoogle();
            navigate("/home");
          } catch (e) {
            setBusy(false, friendly(e));
          }
        },
      }),
    ]),
  ]);

  app.replaceChildren(el("div", { class: "auth-page" }, [form]));
}
