/** Firebase Auth via compat SDK (loaded from /vendor/firebase in index.html). */

let app = null;
let auth = null;
let initPromise = null;
let cachedToken = null;
let currentUser = null;
let firstAuthResolved = false;
/** Once true, ignore Firebase null blips on tab focus until explicit sign-out. */
let sessionLocked = false;
let explicitSignOut = false;
let bootWaitTimer = null;
const listeners = new Set();

const SESSION_KEY = "clipradr_session_uid";

function uidOf(user) {
  return user?.uid || null;
}

function notify() {
  for (const fn of listeners) {
    try {
      fn(currentUser);
    } catch {
      /* ignore */
    }
  }
}

function readSessionUid() {
  try {
    return sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function writeSessionUid(uid) {
  try {
    if (uid) {
      sessionStorage.setItem(SESSION_KEY, uid);
      localStorage.setItem(SESSION_KEY, uid);
    } else {
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SESSION_KEY);
    }
  } catch {
    /* ignore */
  }
}

function firebaseGlobal() {
  if (!window.firebase?.app || !window.firebase?.auth) {
    throw new Error(
      "Firebase SDK failed to load. Check /vendor/firebase/firebase-app-compat.js is served."
    );
  }
  return window.firebase;
}

async function loadConfig() {
  try {
    const status = await fetch("/api/status").then((r) => r.json());
    const cfg = status?.auth?.web_config;
    if (cfg?.apiKey && cfg?.projectId) {
      return { cfg, authRequired: !!status.auth?.auth_required };
    }
    return { cfg: null, authRequired: !!status?.auth?.auth_required };
  } catch {
    /* fall through */
  }
  try {
    const mod = await import("./firebase-config.js");
    if (mod.firebaseConfig?.apiKey) {
      return { cfg: mod.firebaseConfig, authRequired: true };
    }
  } catch {
    /* missing */
  }
  return { cfg: null, authRequired: false };
}

export function hasCachedFirebaseSession() {
  if (readSessionUid()) return true;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("firebase:authUser:")) return true;
    }
  } catch {
    /* private mode */
  }
  return false;
}

function lockSession(user, token) {
  currentUser = user;
  if (token) cachedToken = token;
  sessionLocked = true;
  explicitSignOut = false;
  writeSessionUid(user?.uid || null);
}

function clearSession() {
  currentUser = null;
  cachedToken = null;
  sessionLocked = false;
  writeSessionUid(null);
}

export async function initAuth() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const { cfg, authRequired } = await loadConfig();
    if (!cfg) {
      firstAuthResolved = true;
      return { ready: false, authRequired: false };
    }

    const firebase = firebaseGlobal();
    if (!firebase.apps.length) {
      app = firebase.initializeApp(cfg);
    } else {
      app = firebase.app();
    }
    auth = firebase.auth();
    try {
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    } catch {
      /* older SDK */
    }

    await new Promise((resolve) => {
      let bootAttempts = 0;

      const finishBoot = async (user) => {
        if (firstAuthResolved) return;
        clearTimeout(bootWaitTimer);
        if (user) {
          let token = null;
          try {
            token = await user.getIdToken();
          } catch {
            /* keep */
          }
          lockSession(user, token);
        } else {
          clearSession();
        }
        firstAuthResolved = true;
        notify();
        resolve();
      };

      const scheduleBootRecheck = () => {
        clearTimeout(bootWaitTimer);
        bootAttempts += 1;
        // Keep waiting while a persisted Firebase user blob exists — never
        // conclude "logged out" mid-restore (discarded-tab reload).
        const maxAttempts = 40; // ~10s
        bootWaitTimer = setTimeout(() => {
          if (firstAuthResolved) return;
          if (auth?.currentUser) {
            finishBoot(auth.currentUser);
            return;
          }
          if (hasCachedFirebaseSession() && bootAttempts < maxAttempts) {
            scheduleBootRecheck();
            return;
          }
          finishBoot(null);
        }, 250);
      };

      auth.onAuthStateChanged(async (user) => {
        if (!firstAuthResolved) {
          if (user) {
            await finishBoot(user);
            return;
          }
          // null during boot — wait for persistence restore; do NOT finish yet
          // if localStorage still has a firebase auth user.
          scheduleBootRecheck();
          return;
        }

        if (user) {
          const prevUid = uidOf(currentUser);
          let token = cachedToken;
          try {
            token = await user.getIdToken();
          } catch {
            /* keep cached */
          }
          lockSession(user, token);
          if (prevUid !== user.uid) notify();
          return;
        }

        // null after boot: IGNORE while session is locked (tab focus blip).
        if (sessionLocked && !explicitSignOut) {
          return;
        }

        const prev = uidOf(currentUser);
        clearSession();
        if (prev) notify();
      });
    });

    return { ready: true, authRequired };
  })();
  return initPromise;
}

export function onAuthChange(fn) {
  listeners.add(fn);
  // Do NOT eagerly invoke here during boot — app.js owns the first paint
  // after initAuth resolves, which prevents double-mounting the shell.
  return () => listeners.delete(fn);
}

export function getUser() {
  return currentUser || auth?.currentUser || null;
}

export function authSettled() {
  return firstAuthResolved;
}

export function isSessionLocked() {
  return sessionLocked;
}

export async function getIdToken(force = false) {
  if (!auth) return cachedToken;

  const user = auth.currentUser || currentUser;
  if (!user) {
    return sessionLocked ? cachedToken : null;
  }
  try {
    cachedToken = await user.getIdToken(force);
    return cachedToken;
  } catch {
    return cachedToken;
  }
}

let loggingOut = false;
export async function forceLogout(reason = "Session expired") {
  if (loggingOut) return;
  if (sessionLocked && /missing authorization|token unavailable/i.test(String(reason))) {
    console.warn("[auth] ignored soft logout:", reason);
    return;
  }
  loggingOut = true;
  try {
    explicitSignOut = true;
    sessionLocked = false;
    clearTimeout(bootWaitTimer);
    clearSession();
    try {
      if (auth) await auth.signOut();
    } catch {
      /* ignore */
    }
    notify();
    console.warn("[auth]", reason);
    history.replaceState({}, "", "/login");
    window.dispatchEvent(new CustomEvent("clipradr:force-login", { detail: reason }));
  } finally {
    setTimeout(() => {
      loggingOut = false;
    }, 1500);
  }
}

export async function signInEmail(email, password) {
  await initAuth();
  explicitSignOut = false;
  const cred = await auth.signInWithEmailAndPassword(email, password);
  const token = await cred.user.getIdToken();
  const prev = uidOf(currentUser);
  lockSession(cred.user, token);
  if (prev !== cred.user.uid) notify();
  else if (!prev) notify();
  return cred.user;
}

export async function signUpEmail(email, password, displayName = "") {
  await initAuth();
  explicitSignOut = false;
  const cred = await auth.createUserWithEmailAndPassword(email, password);
  if (displayName) {
    await cred.user.updateProfile({ displayName });
  }
  const token = await cred.user.getIdToken();
  const prev = uidOf(currentUser);
  lockSession(cred.user, token);
  if (prev !== cred.user.uid) notify();
  else if (!prev) notify();
  return cred.user;
}

export async function signInGoogle() {
  await initAuth();
  explicitSignOut = false;
  const firebase = firebaseGlobal();
  const provider = new firebase.auth.GoogleAuthProvider();
  const cred = await auth.signInWithPopup(provider);
  const token = await cred.user.getIdToken();
  const prev = uidOf(currentUser);
  lockSession(cred.user, token);
  if (prev !== cred.user.uid) notify();
  else if (!prev) notify();
  return cred.user;
}

export async function signOut() {
  explicitSignOut = true;
  sessionLocked = false;
  clearTimeout(bootWaitTimer);
  try {
    if (auth) await auth.signOut();
  } catch {
    /* ignore */
  }
  clearSession();
  notify();
}

export function isSignedIn() {
  if (sessionLocked && currentUser) return true;
  return !!(currentUser || auth?.currentUser);
}
