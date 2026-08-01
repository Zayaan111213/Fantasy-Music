import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
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

// Auth-state-conditional navigator swap, replacing the web app's per-route
// RequireAuth/RequireOnboarded guard components (see migration plan §4) —
// three top-level trees (logged out / needs onboarding / full app) instead
// of per-route redirects.
export function RootNavigator() {
  const { user, isLoading } = useAuth();

  if (isLoading) return <FullPageSpinner />;

  return (
    <NavigationContainer>
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
