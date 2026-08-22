import { useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { posthog } from '../lib/posthog';
import { capturePendingInvite, inviteCodeFromUrl, onPendingInvite, takePendingInvite } from '../lib/pendingInvite';
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

// Two paths on the domain open the app; the AASA file in backend/src/server.ts
// claims exactly those two, so nothing else on bandwagoner.com gets pulled in.
//
// reset-password resolves through the config below. React Navigation parses
// `?token=` into route.params automatically, which is why ResetPasswordScreen
// needs no changes to receive it. It lives in the logged-out stack, so a link
// tapped while logged in doesn't resolve and the app just opens normally —
// the right trade-off, since you reset a password precisely because you can't
// get in.
//
// League invites deliberately do NOT resolve through the config. LeagueJoin
// only exists in the full app stack, so a config entry would work for a
// logged-in member and silently drop the code for the person being recruited —
// exactly the case invites exist for. Instead the URL is intercepted below,
// the code is stashed, and RootNavigator opens the join screen once the app
// tree is mounted. See lib/pendingInvite.ts.
function stash(url: string | null): boolean {
  const code = url ? inviteCodeFromUrl(url) : null;
  if (code) void capturePendingInvite(code);
  return code !== null;
}

const linking = {
  prefixes: ['bandwagoner://', 'https://bandwagoner.com'],
  config: {
    screens: {
      ResetPassword: 'reset-password',
    },
  },
  async getInitialURL(): Promise<string | null> {
    const url = await Linking.getInitialURL();
    // Returning null for an invite keeps React Navigation from resolving a
    // path that has no screen in whichever tree is mounted; the effect in
    // RootNavigator picks it up from the stash instead.
    return stash(url) ? null : url;
  },
  subscribe(listener: (url: string) => void): () => void {
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (!stash(url)) listener(url);
    });
    return () => sub.remove();
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
  const [navReady, setNavReady] = useState(false);
  // Bumped when an invite arrives while the app is already foregrounded, so
  // the effect below re-runs instead of waiting for the next mount.
  const [inviteSignal, setInviteSignal] = useState(0);

  useEffect(() => onPendingInvite(() => setInviteSignal((n) => n + 1)), []);

  // A stashed invite can only be opened once the full app stack is mounted,
  // which is the same condition the AppStack branch below renders on. Until
  // then it stays stashed: a recruit signing up walks Intro -> Login ->
  // Onboarding first, and lands on the join screen at the end of it.
  const onboarded = !!user && user.username !== null;
  useEffect(() => {
    // isReady() is checked before the read, not after: takePendingInvite()
    // clears the stash, so reading against a ref that cannot navigate yet
    // would drop the invite instead of deferring it.
    if (!navReady || !onboarded || !navigationRef.isReady()) return;
    let cancelled = false;
    void takePendingInvite().then((code) => {
      if (!cancelled && code) navigationRef.navigate('LeagueJoin', { code });
    });
    return () => { cancelled = true; };
  }, [navReady, onboarded, inviteSignal, navigationRef]);

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
      onReady={() => { setNavReady(true); captureScreen(); }}
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
