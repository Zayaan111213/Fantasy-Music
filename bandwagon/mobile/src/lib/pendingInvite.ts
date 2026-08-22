/**
 * Holds a league invite code between the moment a universal link is tapped and
 * the moment the app is actually able to show the join screen.
 *
 * A tapped invite can arrive in three states, and only one of them can be
 * handled by React Navigation's linking config alone:
 *
 *   logged in + onboarded  LeagueJoin exists in the current navigator
 *   logged out             the auth stack has no LeagueJoin, so the URL
 *                          resolves to nothing and the code is lost
 *   mid-onboarding         same, plus the user still has to pick a username
 *
 * Rather than special-case the first one, every invite URL goes through here:
 * linking stashes the code instead of resolving it, and RootNavigator consumes
 * it once the full app tree is mounted. One path, so signing up from an invite
 * lands on the league the same way an existing user does — matching the web
 * app, where /auth?redirect= carries the attempted path through signup.
 *
 * Persisted as well as held in memory because signing up is long enough to
 * background the app, and iOS can evict it in the middle.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'bw_pending_invite';

let pending: string | null = null;
const listeners = new Set<() => void>();

// Matches both the https:// universal link and the bandwagoner:// scheme.
// Codes are the alphanumeric-with-dashes form generated for leagues.
const INVITE_URL = /\/leagues\/join\/([A-Za-z0-9_-]+)/;

export function inviteCodeFromUrl(url: string): string | null {
  const match = INVITE_URL.exec(url);
  return match ? match[1].toUpperCase() : null;
}

/** Records a tapped invite. Notifies listeners so an app already in the
 *  foreground reacts immediately rather than at the next mount. */
export async function capturePendingInvite(code: string): Promise<void> {
  pending = code;
  listeners.forEach((l) => l());
  try {
    await AsyncStorage.setItem(KEY, code);
  } catch {
    // In-memory copy still carries this session; a lost write only costs the
    // invite if the app is killed mid-signup.
  }
}

/** Reads and clears the pending invite. Clearing on read is what stops the
 *  join screen reopening every time the app tree remounts. */
export async function takePendingInvite(): Promise<string | null> {
  const inMemory = pending;
  pending = null;
  let stored: string | null = null;
  try {
    stored = await AsyncStorage.getItem(KEY);
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Ignore — the in-memory value below is the common case.
  }
  return inMemory ?? stored;
}

export function onPendingInvite(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
