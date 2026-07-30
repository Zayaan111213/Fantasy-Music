import * as SecureStore from 'expo-secure-store';
import { createApiClient } from '@bandwagon/shared';

export const TOKEN_KEY = 'bw_token';

// EXPO_PUBLIC_-prefixed env vars are inlined at build time by Expo. Point
// this at your machine's LAN IP (not localhost) for local backend testing —
// a physical device or simulator can't resolve the dev machine's localhost.
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://bandwagon.up.railway.app/api';

export const api = createApiClient({
  baseUrl: BASE_URL,
  getToken: () => SecureStore.getItemAsync(TOKEN_KEY),
});
