import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Check, X } from 'lucide-react-native';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { posthog } from '../lib/posthog';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Avatar } from '../components/ui/Avatar';
import type { User } from '@bandwagon/shared';
import { WagonMark } from '../components/Logo';

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

export function OnboardingScreen() {
  const { updateUser } = useAuth();

  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!username) {
      setUsernameStatus('idle');
      return;
    }
    if (!USERNAME_REGEX.test(username)) {
      setUsernameStatus('invalid');
      return;
    }

    setUsernameStatus('checking');
    debounceRef.current = setTimeout(async () => {
      try {
        const { available } = await api.get<{ available: boolean }>(`/auth/check-username?username=${encodeURIComponent(username)}`);
        setUsernameStatus(available ? 'available' : 'taken');
      } catch {
        setUsernameStatus('idle');
      }
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [username]);

  async function pickAvatar() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (!result.canceled) setAvatarUri(result.assets[0].uri);
  }

  async function handleSubmit() {
    if (usernameStatus !== 'available') return;
    setError('');
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('username', username);
      if (avatarUri) {
        const filename = avatarUri.split('/').pop() ?? 'avatar.jpg';
        const ext = filename.split('.').pop()?.toLowerCase();
        formData.append('avatar', { uri: avatarUri, name: filename, type: `image/${ext === 'jpg' ? 'jpeg' : ext}` } as unknown as Blob);
      }

      const { user: updated } = await api.post<{ user: User }>('/auth/complete-onboarding', formData);
      updateUser(updated);
      posthog.capture('onboarding_completed', { has_avatar: !!avatarUri });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  const usernameError =
    usernameStatus === 'invalid' ? '3-20 characters: letters, numbers, underscores only' :
    usernameStatus === 'taken' ? 'Username already taken' :
    undefined;

  return (
    <View className="flex-1 bg-gray-950 items-center justify-center px-4">
      <View className="w-full max-w-md">
        <View className="items-center mb-8">
          <WagonMark size={56} />
          <Text className="text-3xl font-bold text-white mt-4">Set up your profile</Text>
          <Text className="text-gray-400 mt-1">Pick a username so friends can find you</Text>
        </View>

        <View className="bg-white/5 border border-white/10 rounded-2xl p-8">
          <View className="gap-5">
            <View className="items-center gap-3">
              <Avatar src={avatarUri} name={username || '?'} size="xl" />
              <Pressable onPress={pickAvatar}>
                <Text className="text-sm text-indigo-400">{avatarUri ? 'Change picture' : 'Upload a profile picture (optional)'}</Text>
              </Pressable>
            </View>

            <View>
              <Input
                label="Username"
                placeholder="e.g. chart_topper"
                autoCapitalize="none"
                value={username}
                onChangeText={setUsername}
                error={usernameError}
              />
              {username !== '' && usernameStatus !== 'idle' && usernameStatus !== 'invalid' && (
                <View className="absolute right-3 top-9">
                  {usernameStatus === 'checking' && <Text className="text-xs text-gray-500">Checking…</Text>}
                  {usernameStatus === 'available' && <Check color="#8FBFAD" size={16} />}
                  {usernameStatus === 'taken' && <X color="#D5714F" size={16} />}
                </View>
              )}
            </View>

            {error !== '' && (
              <View className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <Text className="text-sm text-red-400">{error}</Text>
              </View>
            )}

            <Button onPress={handleSubmit} disabled={loading || usernameStatus !== 'available'} size="lg" className="mt-2">
              {loading ? 'Saving…' : 'Continue'}
            </Button>
          </View>
        </View>
      </View>
    </View>
  );
}
