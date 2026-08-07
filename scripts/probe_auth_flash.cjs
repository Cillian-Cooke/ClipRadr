/**
 * Reproduce ClipRadar auth flash on tab focus / discard reload.
 * Mocks Firebase so we can control onAuthStateChanged timing.
 *
 * Run: node scripts/probe_auth_flash.mjs
 */
const { chromium } = require("playwright");

const BASE = process.env.CLIPRADAR_URL || "http://localhost:8001";

async function snapshot(page, label) {
  const info = await page.evaluate(() => {
    const app = document.getElementById("app");
    const text = (app?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 240);
    const hasLogin =
      !!document.querySelector('input[type="password"]') ||
      /welcome back|sign in|create account/i.test(text);
    const hasLoading = /restoring session|starting clipradar/i.test(text);
    const path = location.pathname;
    return {
      path,
      hasLogin,
      hasLoading,
      text,
      logs: window.__crProbeLogs?.slice(-20) || [],
    };
  });
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(info, null, 2));
  return info;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("console", (msg) => {
    const t = msg.text();
    if (t.includes("[probe]") || t.includes("[auth]") || t.includes("Boot")) {
      console.log("CONSOLE:", t);
    }
  });

  // Mock Firebase BEFORE any page scripts run.
  await page.addInitScript(() => {
    window.__crProbeLogs = [];
    const log = (m) => {
      window.__crProbeLogs.push(`${Date.now()}:${m}`);
      console.log("[probe]", m);
    };

    // Pretend a persisted Firebase session exists (triggers long boot wait).
    try {
      localStorage.setItem(
        "firebase:authUser:probe-key:[DEFAULT]",
        JSON.stringify({ uid: "probe-uid", email: "probe@test.com", stsTokenManager: { accessToken: "x" } })
      );
      localStorage.setItem("clipradar_session_uid", "probe-uid");
    } catch {}

    let authHandler = null;
    let currentUser = null;
    const fakeUser = {
      uid: "probe-uid",
      email: "probe@test.com",
      getIdToken: async () => "probe-token",
    };

    const authObj = {
      get currentUser() {
        return currentUser;
      },
      setPersistence: async () => {},
      onAuthStateChanged(cb) {
        authHandler = cb;
        log("onAuthStateChanged subscribed");
        const params = new URLSearchParams(location.search);
        const slowBoot = params.get("slowBoot") === "1" || window.__crSlowBoot;
        if (slowBoot) {
          // Discarded-tab style: null for a long time, then persisted user.
          setTimeout(() => {
            log("emit null (slow boot)");
            currentUser = null;
            cb(null);
          }, 30);
          setTimeout(() => {
            log("emit user (slow boot restore 2800ms)");
            currentUser = fakeUser;
            cb(fakeUser);
          }, 2800);
        } else {
          setTimeout(() => {
            log("emit null (boot)");
            currentUser = null;
            cb(null);
          }, 30);
          setTimeout(() => {
            log("emit user (boot restore)");
            currentUser = fakeUser;
            cb(fakeUser);
          }, 80);
        }
        return () => {};
      },
      onIdTokenChanged(cb) {
        return () => {};
      },
      signOut: async () => {
        currentUser = null;
        if (authHandler) authHandler(null);
      },
      signInWithEmailAndPassword: async () => ({ user: fakeUser }),
      createUserWithEmailAndPassword: async () => ({ user: fakeUser }),
      signInWithPopup: async () => ({ user: fakeUser }),
      // Simulate tab-focus blip
      __blip() {
        log("TAB BLIP: emit null");
        currentUser = null;
        if (authHandler) authHandler(null);
        setTimeout(() => {
          log("TAB BLIP: emit user");
          currentUser = fakeUser;
          if (authHandler) authHandler(fakeUser);
        }, 100);
      },
      // Simulate discarded-tab reload timing: long gap before user returns
      __slowRestore() {
        log("SLOW: emit null");
        currentUser = null;
        if (authHandler) authHandler(null);
        setTimeout(() => {
          log("SLOW: emit user after 2500ms");
          currentUser = fakeUser;
          if (authHandler) authHandler(fakeUser);
        }, 2500);
      },
    };

    window.firebase = {
      apps: [],
      initializeApp(cfg) {
        this.apps.push(cfg);
        return cfg;
      },
      app() {
        return this.apps[0];
      },
    };
    const authFn = () => authObj;
    authFn.Auth = { Persistence: { LOCAL: "local" } };
    authFn.GoogleAuthProvider = function () {};
    window.firebase.auth = authFn;

    window.__crAuth = authObj;
    log("firebase mock installed");
  });

  // Block real firebase vendor scripts so our mock wins.
  await page.route("**/vendor/firebase/**", (route) => route.abort());
  // Still allow API
  await page.route("**/api/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        app: "ClipRadar",
        auth: {
          auth_required: true,
          firebase_ready: true,
          web_config: {
            apiKey: "probe",
            authDomain: "probe.firebaseapp.com",
            projectId: "probe",
          },
        },
        credentials: {},
        capabilities: {},
        setup: { platform: "local" },
      }),
    });
  });
  // Authed APIs succeed with probe token
  await page.route("**/api/**", async (route) => {
    if (route.request().url().includes("/api/status")) return route.fallback();
    const authz = route.request().headers()["authorization"] || "";
    if (!authz.includes("Bearer")) {
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Sign in required. Missing Authorization Bearer token." }),
      });
    }
    const url = route.request().url();
    if (url.includes("/api/creators") && route.request().method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ creators: [] }),
      });
    }
    if (url.includes("/api/home")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          greeting: "Hi",
          headline: "Probe",
          stats: {
            creators_followed: 0,
            videos_scanned: 0,
            clip_moments_found: 0,
            clips_exported: 0,
          },
          top_opportunities: [],
        }),
      });
    }
    if (url.includes("/api/account/me")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ email: "probe@test.com", plan: "free", bypass: false }),
      });
    }
    if (url.includes("/api/opportunities")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ moments: [] }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  console.log("Opening", `${BASE}/creators?fresh=probe1`);
  await page.goto(`${BASE}/creators?fresh=probe1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const boot = await snapshot(page, "after boot (~500ms)");

  // Simulate tab focus auth blip
  await page.evaluate(() => window.__crAuth.__blip());
  await page.waitForTimeout(200);
  const blipEarly = await snapshot(page, "200ms after tab blip");
  await page.waitForTimeout(1500);
  const blipLate = await snapshot(page, "1700ms after tab blip");

  // Simulate visibility change
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    window.__crAuth.__blip();
  });
  await page.waitForTimeout(300);
  const vis = await snapshot(page, "after visibility+blip");

  // Verdict
  const flashes = [boot, blipEarly, blipLate, vis].filter((s) => s.hasLogin);
  console.log("\n========== VERDICT ==========");
  if (flashes.length) {
    console.log("FAIL: login UI appeared in", flashes.length, "snapshots");
    process.exitCode = 2;
  } else {
    console.log("PASS: no login UI flash detected in these scenarios");
  }

  // Extra: slow restore after reload-like null (discarded tab)
  await page.evaluate(() => window.__crAuth.__slowRestore());
  await page.waitForTimeout(1200);
  const slowMid = await snapshot(page, "1200ms into slow restore (user still null)");
  await page.waitForTimeout(2000);
  const slowEnd = await snapshot(page, "after slow restore completes");
  if (slowMid.hasLogin) {
    console.log("FAIL: login shown during slow restore gap");
    process.exitCode = 2;
  }
  if (slowEnd.hasLogin) {
    console.log("FAIL: still on login after slow restore");
    process.exitCode = 2;
  }

  // >>> Discarded-tab RELOAD with slow auth (null for 2.8s)
  console.log("\n>>> Simulating discarded-tab RELOAD with slow auth restore");
  await page.goto(`${BASE}/creators?fresh=probe-reload&slowBoot=1`, { waitUntil: "domcontentloaded" });
  const reloadSnaps = [];
  for (const ms of [200, 1000, 2100, 2500, 3200]) {
    await page.waitForTimeout(ms === 200 ? 200 : ms - (reloadSnaps.length ? [200, 1000, 2100, 2500, 3200][reloadSnaps.length - 1] : 0));
    reloadSnaps.push(await snapshot(page, `reload @${ms}ms`));
  }

  console.log("\n========== RELOAD VERDICT ==========");
  let flashed = false;
  for (const s of reloadSnaps) {
    console.log(s.path, { hasLogin: s.hasLogin, hasLoading: s.hasLoading, text: s.text.slice(0, 70) });
    if (s.hasLogin) flashed = true;
  }
  if (flashed) {
    console.log("FAIL: login flashed during reload restore");
    process.exitCode = 2;
  }
  const finalPath = reloadSnaps[reloadSnaps.length - 1]?.path;
  if (finalPath !== "/creators") {
    console.log("FAIL: deep link stolen — ended on", finalPath, "expected /creators");
    process.exitCode = 2;
  }
  const dup = await page.evaluate(() => (document.body.innerText.match(/Sign out/g) || []).length);
  console.log("Sign out button count:", dup);
  if (dup > 1) {
    console.log("FAIL: shell mounted multiple times (duplicate Sign out)");
    process.exitCode = 2;
  }
  if (process.exitCode !== 2) console.log("PASS: reload kept /creators, no login flash, single shell");

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
