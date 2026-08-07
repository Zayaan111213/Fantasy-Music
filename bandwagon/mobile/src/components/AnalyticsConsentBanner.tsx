import { useEffect, useState } from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from './ui/Button';
import { WEB_URL } from '../api/client';
import {
  getConsentStatus,
  isPostHogConfigured,
  onConsentChange,
  setAnalyticsConsent,
  type ConsentStatus,
} from '../lib/posthog';

/**
 * The native counterpart to the web CookieConsentBanner. Same contract: we ask
 * before anything is collected, and nothing is collected unless the answer is
 * Accept.
 *
 * Two deliberate differences from the web banner. It never mentions cookies,
 * because there are none here. And the visibility check is an effect rather
 * than a useState initializer, because AsyncStorage has no synchronous read:
 * the banner starts hidden and appears only once we know no answer is stored,
 * so a returning user never sees it flash.
 */
export function AnalyticsConsentBanner() {
  const [visible, setVisible] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isPostHogConfigured()) return;
      const status = await getConsentStatus();
      if (!cancelled && status === null) setVisible(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Answering in Account Settings counts as answering.
  useEffect(() => onConsentChange(() => setVisible(false)), []);

  function choose(status: ConsentStatus) {
    // Dismiss first so the banner never sits there waiting on storage.
    setVisible(false);
    void setAnalyticsConsent(status);
  }

  if (!visible) return null;

  return (
    <View
      className="absolute inset-x-0 bottom-0 border-t border-white/10 bg-gray-950/95 px-4 pt-4"
      style={{ paddingBottom: insets.bottom + 16 }}
    >
      <Text className="text-sm text-gray-300 mb-3">
        We'd like to measure how people use Bandwagoner, which features get used and where people
        get stuck. Decline and we won't track you. You can change this any time in Account
        Settings.
      </Text>
      <Pressable onPress={() => Linking.openURL(`${WEB_URL}/privacy`)}>
        <Text className="text-sm text-indigo-400 mb-3">Privacy Policy</Text>
      </Pressable>
      <View className="flex-row gap-2">
        <Button variant="secondary" size="sm" className="flex-1" onPress={() => choose('declined')}>
          Decline
        </Button>
        <Button variant="primary" size="sm" className="flex-1" onPress={() => choose('accepted')}>
          Accept
        </Button>
      </View>
    </View>
  );
}
