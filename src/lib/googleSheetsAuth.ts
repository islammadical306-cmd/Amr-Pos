import { getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { apiFetch } from './api';

export const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}
// Using select_account allows smooth reconnecting without repeatedly forcing full consent on every visit
provider.setCustomParameters({ prompt: 'select_account' });

const STORAGE_KEY = 'amarpos_google_sheets_auth';

export interface StoredGoogleAuth {
  accessToken: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  savedAt: number;
}

export function getStoredGoogleAuth(): StoredGoogleAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: StoredGoogleAuth = JSON.parse(raw);
      if (parsed && (parsed.accessToken || parsed.email)) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

const initialSaved = getStoredGoogleAuth();

let isSigningIn = false;
let cachedAccessToken: string | null = initialSaved?.accessToken || null;
let cachedUserEmail: string | null = initialSaved?.email || null;
let cachedUser: User | null = null;

type Listener = (state: { user: User | null; email: string | null; accessToken: string | null }) => void;
const listeners = new Set<Listener>();

function notify() {
  const email = cachedUser?.email || cachedUserEmail;
  for (const fn of listeners) {
    fn({ user: cachedUser, email, accessToken: cachedAccessToken });
  }
}

onAuthStateChanged(auth, (user) => {
  cachedUser = user;
  if (user?.email) {
    cachedUserEmail = user.email;
  }
  // If we already have a saved token in localStorage, keep it across page refreshes!
  if (!cachedAccessToken) {
    const saved = getStoredGoogleAuth();
    if (saved?.accessToken) {
      cachedAccessToken = saved.accessToken;
      if (saved.email) cachedUserEmail = saved.email;
    }
  }
  notify();
});

export function subscribeGoogleAuth(listener: Listener): () => void {
  listeners.add(listener);
  listener({
    user: cachedUser,
    email: cachedUser?.email || cachedUserEmail,
    accessToken: cachedAccessToken,
  });
  return () => {
    listeners.delete(listener);
  };
}

export function getGoogleAccessToken(): string | null {
  if (!cachedAccessToken) {
    const saved = getStoredGoogleAuth();
    if (saved?.accessToken) {
      cachedAccessToken = saved.accessToken;
      if (saved.email) cachedUserEmail = saved.email;
    }
  }
  return cachedAccessToken;
}

export function getGoogleUserEmail(): string | null {
  return cachedUser?.email || cachedUserEmail || null;
}

export async function signInWithGoogleSheets(): Promise<{ user: User; email: string; accessToken: string }> {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Could not obtain Google Sheets permission token. Please try again and allow spreadsheet access.');
    }
    cachedUser = result.user;
    cachedAccessToken = credential.accessToken;
    cachedUserEmail = result.user.email || null;

    const data: StoredGoogleAuth = {
      accessToken: credential.accessToken,
      email: result.user.email || null,
      displayName: result.user.displayName || null,
      photoURL: result.user.photoURL || null,
      savedAt: Date.now(),
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // ignore
    }

    // Sync to backend DB so background sync and multi-tab/reloads are permanently aware
    try {
      await apiFetch('/api/sheets/auth-token', {
        method: 'POST',
        body: JSON.stringify({ email: data.email, accessToken: data.accessToken }),
      });
    } catch {
      // ignore
    }

    notify();
    return { user: result.user, email: data.email || '', accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export async function signOutGoogleSheets(): Promise<void> {
  cachedAccessToken = null;
  cachedUserEmail = null;
  cachedUser = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  try {
    await apiFetch('/api/sheets/auth-token', {
      method: 'POST',
      body: JSON.stringify({ email: '', accessToken: '' }),
    });
  } catch {
    // ignore
  }
  try {
    await signOut(auth);
  } finally {
    notify();
  }
}

export function clearExpiredGoogleToken(): void {
  // Mark token expired for API calls, but preserve cachedUserEmail so user sees their account and can renew in 1 click
  cachedAccessToken = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      parsed.accessToken = '';
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    }
  } catch {
    // ignore
  }
  notify();
}
