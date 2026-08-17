import { useRef } from 'react';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { posthog } from '../lib/posthog';
import { FullPageSpinner } from '../components/ui/Spinner';
import { IntroScreen } from '../screens/IntroScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { ForgotPasswordScreen } from '../screens/ForgotPasswordScreen';
import { ResetPasswordScreen } from '../screens/ResetPasswordScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { MainTabs } from './MainTabs';
import { ArtistDetailScreen } from '../screens/ArtistDetailScreen';
import { LeagueCreateScreen } from '../screens/LeagueCreateScreen';
import { LeagueJoinScreen } from '../screens/LeagueJoinScreen';
import { LeagueHubScreen } from '../screens/LeagueHubScreen';
import { DraftRoomScreen } from '../screens/DraftRoomScreen';
import { TradeProposeScreen } from '../screens/TradeProposeScreen';

const AuthStack = createNativeStackNavigator();
const OnboardingStack = createNativeStackNavigator();
const AppStack = createNativeStackNavigator();

// Only the emailed password-reset link is handled. The backend already sends
// an https://bandwagoner.com/reset-password?token=... URL, and the AASA file
// served from backend/src/server.ts claims exactly that one path, so nothing
// else on the domain gets pulled into the app.
//
// React Navigation parses `?token=` into route.params automatically, which is
// why ResetPasswordScreen needs no changes to receive it.
//
// ResetPassword lives in the logged-out stack, so a link tapped while logged
// in doesn't resolve and the app just opens normally. That's the right
// trade-off: you reset a password precisely because you can't get in.
const linking = {
  prefixes: ['bandwagoner://', 'https://bandwagoner.com'],
  config: {
    screens: {
      ResetPassword: 'reset-password',
    },
  },
};

// Auth-state-conditional navigator swap, replacing the web app's per-route
// RequireAuth/RequireOnboarded guard components (see migration plan §4) —
// three top-level trees (logged out / needs onboarding / full app) instead
// of per-route redirects.
export function RootNavigator() {
  const { user, isLoading } = useAuth();
  // The web app fires a manual $pageview on every route change because
  // autocapture can't see client-side navigation. Same problem here: the
  // native equivalent is $screen, fired from the navigation container rather
  // than a useLocation() effect.
  // <any> matches how the rest of the app types navigation: there is no
  // central ParamList, screens use useNavigation<any>().
  const navigationRef = useNavigationContainerRef<any>();
  const routeNameRef = useRef<string | undefined>(undefined);

  function captureScreen() {
    const current = navigationRef.getCurrentRoute()?.name;
    if (current && current !== routeNameRef.current) posthog.screen(current);
    routeNameRef.current = current;
  }

  if (isLoading) return <FullPageSpinner />;

  return (
    <NavigationContainer
      ref={navigationRef}
      linking={linking}
      onReady={captureScreen}
      onStateChange={captureScreen}
    >
      {!user ? (
        <AuthStack.Navigator screenOptions={{ headerShown: false }}>
          <AuthStack.Screen name="Intro" component={IntroScreen} />
          <AuthStack.Screen name="Login" component={LoginScreen} />
          <AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
          <AuthStack.Screen name="ResetPassword" component={ResetPasswordScreen} />
        </AuthStack.Navigator>
      ) : user.username === null ? (
        <OnboardingStack.Navigator screenOptions={{ headerShown: false }}>
          <OnboardingStack.Screen name="Onboarding" component={OnboardingScreen} />
        </OnboardingStack.Navigator>
      ) : (
        <AppStack.Navigator screenOptions={{ headerShown: false }}>
          <AppStack.Screen name="Main" component={MainTabs} />
          <AppStack.Screen name="ArtistDetail" component={ArtistDetailScreen} />
          <AppStack.Screen name="LeagueCreate" component={LeagueCreateScreen} />
          <AppStack.Screen name="LeagueJoin" component={LeagueJoinScreen} />
          <AppStack.Screen name="LeagueHub" component={LeagueHubScreen} />
          <AppStack.Screen name="DraftRoom" component={DraftRoomScreen} />
          <AppStack.Screen name="TradePropose" component={TradeProposeScreen} />
        </AppStack.Navigator>
      )}
    </NavigationContainer>
  );
}
