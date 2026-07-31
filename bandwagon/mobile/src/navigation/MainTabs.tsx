import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Home, ListMusic, Trophy, User } from 'lucide-react-native';
import { HomeScreen } from '../screens/HomeScreen';
import { ChartsScreen } from '../screens/ChartsScreen';
import { LeaguesTabScreen } from '../screens/LeaguesTabScreen';
import { AccountSettingsScreen } from '../screens/AccountSettingsScreen';

const Tab = createBottomTabNavigator();

const tabBarStyle = { backgroundColor: '#241811', borderTopColor: '#43301F' };

export function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle,
        tabBarActiveTintColor: '#D9A02C',
        tabBarInactiveTintColor: '#7C6650',
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarIcon: ({ color, size }) => <Home color={color} size={size} /> }} />
      <Tab.Screen name="Charts" component={ChartsScreen} options={{ tabBarIcon: ({ color, size }) => <ListMusic color={color} size={size} /> }} />
      <Tab.Screen name="Leagues" component={LeaguesTabScreen} options={{ tabBarIcon: ({ color, size }) => <Trophy color={color} size={size} /> }} />
      <Tab.Screen name="Account" component={AccountSettingsScreen} options={{ tabBarIcon: ({ color, size }) => <User color={color} size={size} /> }} />
    </Tab.Navigator>
  );
}
