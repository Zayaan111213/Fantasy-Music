import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import PostHog from 'posthog-react-native';

// Mirrors frontend/src/lib/posthog.ts. Same event names and the same
// consent-before-init rule, so web and app land in one PostHog project and
// one funnel. Three things genuinely differ on native:
//
//  1. posthog-js is a module-level singleton that safely queues calls made
//     before init(). posthog-react-native is a class you instantiate, so
//     there is nothing to call before consent. The `posthog` export below is
//     a proxy that keeps call sites looking identical to the web, buffering
//     into pendingEvents rather than throwing on a null client.
//  2. AsyncStorage is async where localStorage is sync, so reading consent
//     (and therefore initPostHog) is async and the banner has a "still
//     deciding whether to ask" state instead of rendering synchronously.
//  3. There are no cookies. The stored key is named for what it actually is.
const CONSENT_KEY = 'bw_analytics_consent';

export type ConsentStatus = 'accepted' | 'declined';

let client: PostHog | null = null;

type Identity = { id: string; email: string; username: string | null };
type QueuedEvent = {
  kind: 'capture' | 'screen';
  name: string;
  properties?: Record<string, string | number | boolean | null>;
};

// Buffer for the window between app launch and the client existing (one
// AsyncStorage read). Only ever flushed by initPostHog(), which returns early
// unless the stored answer is already 'accepted' — so nothing recorded before
// someone consents can be sent. A fresh decision clears it outright (see
// setAnalyticsConsent), which makes this stricter than the web, where
// posthog-js replays its own pre-init buffer once you press Accept.
let pendingIdentity: Identity | null = null;
let pendingEvents: QueuedEvent[] = [];
const MAX_PENDING_EVENTS = 20;

/**
 * Whether there's anything to consent to. No key means PostHog never
 * initializes regardless of the answer, so there's no point asking. The key is
 * supplied per build profile through EAS environment variables rather than
 * committed to eas.json, so local dev runs analytics-free unless you
 * deliberately export it.
 */
export function isPostHogConfigured(): boolean {
  return Boolean(process.env.EXPO_PUBLIC_POSTHOG_KEY);
}

export async function getConsentStatus(): Promise<ConsentStatus | null> {
  try {
    const v = await AsyncStorage.getItem(CONSENT_KEY);
    return v === 'accepted' || v === 'declined' ? v : null;
  } catch {
    // A storage read failure must never break app startup. Treating it as
    // "no answer yet" re-asks next launch, which is the safe direction: it
    // can annoy, but it can't track someone who said no.
    return null;
  }
}

async function persistConsent(status: ConsentStatus): Promise<void> {
  try {
    await AsyncStorage.setItem(CONSENT_KEY, status);
  } catch {
    // Same reasoning as the read: worst case we ask again next launch.
  }
}

/**
 * Constructs the client, but only if a key exists and the user has already
 * accepted. Safe to call more than once — the `client` guard makes repeat
 * calls no-ops rather than opening a second queue.
 */
export async function initPostHog(): Promise<void> {
  const key = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  if (!key || client) return;
  if ((await getConsentStatus()) !== 'accepted') return;

  client = new PostHog(key, {
    host: process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
    personProfiles: 'identified_only',
    // AsyncStorage is already a dependency; passing it explicitly pins the
    // storage backend instead of letting the SDK probe optional peer deps
    // (expo-file-system first, then AsyncStorage) that we don't install.
    customStorage: AsyncStorage,
    // Session replay needs the posthog-react-native-session-replay native
    // module. We deliberately don't ship it: the web's replay is gated behind
    // a cookie banner in a browser, whereas on iOS it would widen the App
    // Privacy disclosure for a signal we don't need yet.
    enableSessionReplay: false,
    // Application Installed/Updated derive the app version from
    // expo-application, which we don't install (this change adds no new native
    // modules). Rather than emit lifecycle events with an undefined version,
    // we capture screens and explicit product events only.
    captureAppLifecycleEvents: false,
  });

  // Super property on every event so web and app traffic are separable in the
  // shared project. Platform.OS rather than a hardcoded 'ios' — the Android
  // package id already exists in app.json.
  void client.register({ platform: Platform.OS });

  // Replay whatever happened during the startup gap. posthog-js buffers
  // pre-init() calls for free; here the gap is a real AsyncStorage read, and
  // without this the first $screen of every launch (always the entry screen)
  // and the restored session's identify would be dropped.
  if (pendingIdentity) {
    client.identify(pendingIdentity.id, {
      email: pendingIdentity.email,
      username: pendingIdentity.username,
    });
    pendingIdentity = null;
  }
  for (const queued of pendingEvents) {
    if (queued.kind === 'screen') void client.screen(queued.name, queued.properties);
    else client.capture(queued.name, queued.properties);
  }
  pendingEvents = [];
}

type ConsentListener = (status: ConsentStatus) => void;
const consentListeners = new Set<ConsentListener>();

/**
 * Lets the first-launch banner react when the answer is given somewhere else
 * (the Account Settings toggle). Without it the banner is an overlay on every
 * screen including Settings, so a user could switch analytics on there and
 * still be looking at a banner asking the same question. Returns an
 * unsubscribe function.
 */
export function onConsentChange(fn: ConsentListener): () => void {
  consentListeners.add(fn);
  return () => {
    consentListeners.delete(fn);
  };
}

/**
 * Records the user's answer and brings the client in line with it. Used by
 * both the first-launch banner and the Account Settings toggle, so a user who
 * accepts and later changes their mind actually stops being tracked:
 * optOut() persists in PostHog's own storage and survives restarts.
 */
export async function setAnalyticsConsent(status: ConsentStatus): Promise<void> {
  // Anything captured before the user answered is discarded either way. It
  // was recorded without permission, so accepting must not retroactively send it.
  pendingEvents = [];
  await persistConsent(status);
  consentListeners.forEach((fn) => fn(status));
  if (status === 'accepted') {
    await initPostHog();
    await client?.optIn();
  } else {
    await client?.optOut();
  }
}

export function identifyPostHogUser(user: Identity): void {
  if (!client) {
    // AuthProvider's /auth/me restore is a child effect, so it can resolve
    // before App's initPostHog() does. Hold the identity rather than lose it,
    // or an already-logged-in returning user stays anonymous all session
    // despite personProfiles: 'identified_only'.
    pendingIdentity = user;
    return;
  }
  client.identify(user.id, { email: user.email, username: user.username });
}

export function resetPostHog(): void {
  pendingIdentity = null;
  client?.reset();
}

type PropertyValue = string | number | boolean | null | undefined;

/**
 * The SDK's property type is JSON-shaped and rejects `undefined`, but call
 * sites naturally produce it (an artist viewed outside a league has no
 * leagueId). Dropping those keys is what posthog-js does implicitly, so this
 * keeps the two platforms sending the same payload.
 */
function definedOnly(
  properties?: Record<string, PropertyValue>,
): Record<string, string | number | boolean | null> | undefined {
  if (!properties) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function record(kind: 'capture' | 'screen', name: string, properties?: Record<string, PropertyValue>): void {
  const clean = definedOnly(properties);
  if (!client) {
    if (pendingEvents.length < MAX_PENDING_EVENTS) pendingEvents.push({ kind, name, properties: clean });
    return;
  }
  if (kind === 'screen') void client.screen(name, clean);
  else client.capture(name, clean);
}

/**
 * Lets screens `import { posthog }` and capture unconditionally, exactly like
 * the web app, without every call site knowing whether consent has been given
 * yet.
 */
export const posthog = {
  capture(event: string, properties?: Record<string, PropertyValue>): void {
    record('capture', event, properties);
  },
  screen(name: string, properties?: Record<string, PropertyValue>): void {
    record('screen', name, properties);
  },
};
