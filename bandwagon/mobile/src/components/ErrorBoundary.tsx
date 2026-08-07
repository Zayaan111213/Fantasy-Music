import { Component, type ErrorInfo, type ReactNode } from 'react';
import { View, Text } from 'react-native';
import * as Updates from 'expo-updates';
import { Button } from './ui/Button';

/**
 * The app ships no crash reporting (Sentry is backend and web only), so before
 * this a render-time throw anywhere in the tree was a white screen with no way
 * out except force-quitting. This turns that into something a user can recover
 * from, and something a reviewer doesn't file as a crash.
 *
 * Reload goes through Updates.reloadAsync(), which restarts the JS bundle
 * cleanly. It's available because expo-updates is installed for OTA; there is
 * no fallback path needed since it works in release builds regardless of
 * whether an update has ever been published.
 */

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // No telemetry sink yet, so at least make it visible in a dev console and
    // in device logs. Replace with a Sentry capture when the app gets one.
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReload = () => {
    Updates.reloadAsync().catch(() => {
      // If the reload itself fails there's nothing better to do than clear the
      // error and let React try rendering the tree again.
      this.setState({ error: null });
    });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View className="flex-1 bg-gray-950 items-center justify-center px-8">
        <Text className="text-xl font-semibold text-white text-center">Something went wrong</Text>
        <Text className="text-sm text-gray-400 text-center mt-2 mb-6">
          Sorry about that. Reloading usually fixes it. If it keeps happening, let us know.
        </Text>
        <Button onPress={this.handleReload} size="lg">
          Reload
        </Button>
      </View>
    );
  }
}
