import * as SecureStore from 'expo-secure-store';
import { createApiClient } from '@bandwagon/shared';

export const TOKEN_KEY = 'bw_token';

// EXPO_PUBLIC_-prefixed env vars are inlined at build time by Expo. Point
// this at your machine's LAN IP (not localhost) for local backend testing —
// a physical device or simulator can't resolve the dev machine's localhost.
// Defaults to the custom domain, not the bandwagon.up.railway.app subdomain.
// A shipped build cannot be hot-fixed: if that subdomain ever goes away, every
// installed copy is broken until a new binary clears App Review. The release
// build sets this explicitly in eas.json rather than relying on the fallback.
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://bandwagoner.com/api';

// socket.io connects to the server origin, not the /api-prefixed REST base —
// the web app gets this for free from same-origin relative '/', but a native
// client has no origin and needs an explicit absolute URL (see migration
// plan §6).
export const SOCKET_URL = BASE_URL.replace(/\/api\/?$/, '');

// Same origin, used for links out to the public web pages (privacy, terms).
export const WEB_URL = SOCKET_URL;

export const api = createApiClient({
  baseUrl: BASE_URL,
  getToken: () => SecureStore.getItemAsync(TOKEN_KEY),
});
