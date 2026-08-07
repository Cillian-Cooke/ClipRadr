/** Firebase Auth via compat SDK (loaded from /vendor/firebase in index.html). */

let app = null;
let auth = null;
let initPromise = null;
let cachedToken = null;
let currentUser = null;
let firstAuthResolved = false;
const listeners = new Set();

function notify() {
  for (const fn of listeners) {
    try {
      fn(currentUser);
    } catch {
      /* ignore */
    }
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

    await new Promise((resolve) => {
      auth.onAuthStateChanged(async (user) => {
        currentUser = user;
        try {
          cachedToken = user ? await user.getIdToken() : null;
        } catch {
          cachedToken = null;
        }
        notify();
        if (!firstAuthResolved) {
          firstAuthResolved = true;
          resolve();
        }
      });
    });

    return { ready: true, authRequired };
  })();
  return initPromise;
}

export function onAuthChange(fn) {
  listeners.add(fn);
  if (firstAuthResolved) fn(currentUser);
  return () => listeners.delete(fn);
}

export function getUser() {
  return currentUser;
}

export async function getIdToken(force = false) {
  if (!auth?.currentUser) return cachedToken;
  cachedToken = await auth.currentUser.getIdToken(force);
  return cachedToken;
}

export async function signInEmail(email, password) {
  await initAuth();
  const cred = await auth.signInWithEmailAndPassword(email, password);
  cachedToken = await cred.user.getIdToken();
  currentUser = cred.user;
  notify();
  return cred.user;
}

export async function signUpEmail(email, password, displayName = "") {
  await initAuth();
  const cred = await auth.createUserWithEmailAndPassword(email, password);
  if (displayName) {
    await cred.user.updateProfile({ displayName });
  }
  cachedToken = await cred.user.getIdToken();
  currentUser = cred.user;
  notify();
  return cred.user;
}

export async function signInGoogle() {
  await initAuth();
  const firebase = firebaseGlobal();
  const provider = new firebase.auth.GoogleAuthProvider();
  const cred = await auth.signInWithPopup(provider);
  cachedToken = await cred.user.getIdToken();
  currentUser = cred.user;
  notify();
  return cred.user;
}

export async function signOut() {
  if (!auth) return;
  await auth.signOut();
  cachedToken = null;
  currentUser = null;
  notify();
}

export function isSignedIn() {
  return !!currentUser;
}
