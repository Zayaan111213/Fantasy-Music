import './global.css';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { queryClient } from './src/lib/queryClient';
import { AuthProvider } from './src/context/AuthContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { AnalyticsConsentBanner } from './src/components/AnalyticsConsentBanner';
import { initPostHog } from './src/lib/posthog';

export default function App() {
  // Picks the client back up for someone who accepted on a previous launch.
  // It's a no-op for everyone else, so the banner stays the only thing that
  // can start analytics for the first time. The web does this in main.tsx
  // before render; here it has to be an effect because reading the stored
  // answer is async.
  useEffect(() => {
    void initPostHog();
  }, []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RootNavigator />
          <AnalyticsConsentBanner />
          <StatusBar style="light" />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
