import { View, Pressable, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ChevronLeft } from 'lucide-react-native';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './ui/Avatar';
import { Button } from './ui/Button';
import { WagonMark, Wordmark } from './Logo';

interface HeaderProps {
  showBack?: boolean;
  title?: string;
  actions?: React.ReactNode;
  showWordmark?: boolean;
  // Overrides the default goBack() action — for screens that need a back
  // chevron even though they're a tab root (navigation.canGoBack() is
  // false there), e.g. Charts linking back to Home.
  onBackPress?: () => void;
}

// Ported from frontend/src/components/Header.tsx. The web version's backTo
// (named route) / onBack (handler) split collapses to a single goBack() —
// all authenticated RN screens are stack siblings (see RootNavigator), so
// "back" always means the native stack's back action, unless onBackPress
// overrides it.
export function Header({ showBack = true, title, actions, showWordmark = false, onBackPress }: HeaderProps) {
  const navigation = useNavigation<any>();
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-row items-center gap-3 px-4 pb-3 border-b border-white/10 bg-gray-950"
      style={{ paddingTop: insets.top + 12 }}
    >
      {showBack && (onBackPress || navigation.canGoBack()) && (
        <Pressable onPress={() => (onBackPress ? onBackPress() : navigation.goBack())} hitSlop={8}>
          <ChevronLeft color="#A88F70" size={20} />
        </Pressable>
      )}

      <Pressable onPress={() => navigation.navigate('Main')} className="flex-row items-center gap-2">
        <WagonMark size={showWordmark ? 32 : 20} />
        {showWordmark && <Wordmark className="text-lg" />}
      </Pressable>

      {title && <Text className="font-semibold text-white text-sm flex-1" numberOfLines={1}>{title}</Text>}
      {!title && <View className="flex-1" />}

      {actions}

      <Pressable onPress={() => navigation.navigate('AccountSettings')} className="flex-row items-center gap-2">
        <Avatar src={user?.avatarUrl} name={user?.username ?? '?'} size="sm" />
      </Pressable>
      <Button variant="ghost" size="sm" onPress={() => logout()}>
        Sign out
      </Button>
    </View>
  );
}
