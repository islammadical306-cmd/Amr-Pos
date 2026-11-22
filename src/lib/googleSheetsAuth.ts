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

export const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}
provider.setCustomParameters({ prompt: 'consent select_account' });

// In-memory OAuth access token cache (NEVER persisted to localStorage/sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;
let cachedUser: User | null = null;

type Listener = (state: { user: User | null; accessToken: string | null }) => void;
const listeners = new Set<Listener>();

function notify() {
  for (const fn of listeners) {
    fn({ user: cachedUser, accessToken: cachedAccessToken });
  }
}

onAuthStateChanged(auth, (user) => {
  cachedUser = user;
  if (!user) {
    cachedAccessToken = null;
  } else if (!isSigningIn && !cachedAccessToken) {
    cachedAccessToken = null;
  }
  notify();
});

export function subscribeGoogleAuth(listener: Listener): () => void {
  listeners.add(listener);
  listener({ user: cachedUser, accessToken: cachedAccessToken });
  return () => {
    listeners.delete(listener);
  };
}

export function getGoogleAccessToken(): string | null {
  return cachedAccessToken;
}

export function getGoogleUserEmail(): string | null {
  return cachedUser?.email || null;
}

export async function signInWithGoogleSheets(): Promise<{ user: User; accessToken: string }> {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Could not obtain Google Sheets permission token. Please try again and allow spreadsheet access.');
    }
    cachedUser = result.user;
    cachedAccessToken = credential.accessToken;
    notify();
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export async function signOutGoogleSheets(): Promise<void> {
  cachedAccessToken = null;
  cachedUser = null;
  try {
    await signOut(auth);
  } finally {
    notify();
  }
}

export function clearExpiredGoogleToken(): void {
  cachedAccessToken = null;
  notify();
}
