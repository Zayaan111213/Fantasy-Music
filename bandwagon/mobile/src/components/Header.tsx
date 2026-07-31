import { View, Pressable, Text } from 'react-native';
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
}

// Ported from frontend/src/components/Header.tsx. The web version's backTo
// (named route) / onBack (handler) split collapses to a single goBack() —
// all authenticated RN screens are stack siblings (see RootNavigator), so
// "back" always means the native stack's back action.
export function Header({ showBack = true, title, actions, showWordmark = false }: HeaderProps) {
  const navigation = useNavigation<any>();
  const { user, logout } = useAuth();

  return (
    <View className="flex-row items-center gap-3 px-4 py-3 border-b border-white/10 bg-gray-950">
      {showBack && navigation.canGoBack() && (
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
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
