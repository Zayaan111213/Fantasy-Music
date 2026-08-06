import { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, Linking, Switch } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Check, X } from 'lucide-react-native';
import { api, WEB_URL } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { getConsentStatus, isPostHogConfigured, setAnalyticsConsent } from '../lib/posthog';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { Avatar } from '../components/ui/Avatar';
import { Header } from '../components/Header';
import type { User } from '@bandwagon/shared';

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

export function AccountSettingsScreen() {
  const { user, updateUser, logout } = useAuth();
  const initialUsername = user?.username ?? '';
  const initialEmail = user?.email ?? '';

  const [username, setUsername] = useState(initialUsername);
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  const [email, setEmail] = useState(initialEmail);
  const [avatarUri, setAvatarUri] = useState<string | null>(user?.avatarUrl ?? null);
  const [avatarChanged, setAvatarChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [analyticsOn, setAnalyticsOn] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reflects the stored answer. Someone who never answered the banner, or
  // declined it, sees this off.
  useEffect(() => {
    let cancelled = false;
    void getConsentStatus().then((s) => {
      if (!cancelled) setAnalyticsOn(s === 'accepted');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleAnalyticsToggle(next: boolean) {
    setAnalyticsOn(next);
    void setAnalyticsConsent(next ? 'accepted' : 'declined');
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!username || username === initialUsername) {
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
  }, [username, initialUsername]);

  async function pickAvatar() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (!result.canceled) {
      setAvatarUri(result.assets[0].uri);
      setAvatarChanged(true);
    }
  }

  const usernameChanged = username !== initialUsername;
  const emailChanged = email !== initialEmail;
  const usernameBlocksSave = usernameChanged && usernameStatus !== 'available';
  const hasChanges = usernameChanged || emailChanged || avatarChanged;

  async function handleSubmit() {
    if (usernameBlocksSave || !hasChanges) return;
    setError('');
    setSaving(true);
    try {
      const formData = new FormData();
      if (usernameChanged) formData.append('username', username);
      if (emailChanged) formData.append('email', email);
      if (avatarChanged && avatarUri) {
        const filename = avatarUri.split('/').pop() ?? 'avatar.jpg';
        const ext = filename.split('.').pop()?.toLowerCase();
        formData.append('avatar', { uri: avatarUri, name: filename, type: `image/${ext === 'jpg' ? 'jpeg' : ext}` } as unknown as Blob);
      }

      const { user: updated } = await api.put<{ user: User }>('/auth/me', formData);
      updateUser(updated);
      setAvatarChanged(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAccount() {
    if (!deletePassword || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await api.del('/auth/me', { password: deletePassword });
      await logout();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed');
      setDeleting(false);
    }
  }

  const usernameError =
    usernameStatus === 'invalid' ? '3-20 characters: letters, numbers, underscores only' :
    usernameStatus === 'taken' ? 'Username already taken' :
    undefined;

  return (
    <View className="flex-1 bg-gray-950">
      <Header title="Account Settings" />
      <ScrollView className="px-4 py-6" contentContainerClassName="gap-4 pb-8">
        <Card className="p-6">
          <View className="gap-5">
            <View className="items-center gap-3">
              <Avatar src={avatarUri} name={username || '?'} size="xl" />
              <Pressable onPress={pickAvatar}>
                <Text className="text-sm text-indigo-400">Change picture</Text>
              </Pressable>
            </View>

            <View>
              <Input label="Username" autoCapitalize="none" value={username} onChangeText={setUsername} error={usernameError} />
              {usernameChanged && usernameStatus !== 'idle' && usernameStatus !== 'invalid' && (
                <View className="absolute right-3 top-9">
                  {usernameStatus === 'checking' && <Text className="text-xs text-gray-500">Checking…</Text>}
                  {usernameStatus === 'available' && <Check color="#8FBFAD" size={16} />}
                  {usernameStatus === 'taken' && <X color="#D5714F" size={16} />}
                </View>
              )}
            </View>

            <Input label="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />

            {error !== '' && (
              <View className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <Text className="text-sm text-red-400">{error}</Text>
              </View>
            )}

            <Button onPress={handleSubmit} disabled={saving || usernameBlocksSave || !hasChanges}>
              {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}
            </Button>
          </View>
        </Card>

        {isPostHogConfigured() && (
          <Card className="p-6">
            <Text className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Privacy</Text>
            <View className="flex-row items-center justify-between gap-4">
              <View className="flex-1">
                <Text className="text-sm text-white mb-1">Share usage analytics</Text>
                <Text className="text-xs text-gray-500">
                  Helps us see which features get used and where people get stuck. Turn this off
                  and we won't track you.
                </Text>
              </View>
              <Switch
                value={analyticsOn}
                onValueChange={handleAnalyticsToggle}
                trackColor={{ false: '#3F3F46', true: '#6366F1' }}
              />
            </View>
          </Card>
        )}

        <Card className="p-6">
          <Text className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">About</Text>
          <View className="gap-3">
            <Pressable onPress={() => Linking.openURL(`${WEB_URL}/privacy`)}>
              <Text className="text-sm text-indigo-400">Privacy Policy</Text>
            </Pressable>
            <Pressable onPress={() => Linking.openURL(`${WEB_URL}/terms`)}>
              <Text className="text-sm text-indigo-400">Terms of Service</Text>
            </Pressable>
            <Text className="text-xs text-gray-500">
              Bandwagoner is free to play. No entry fees, no prizes.
            </Text>
          </View>
        </Card>

        <Card className="p-6 border-red-500/20">
          <Text className="text-sm font-semibold text-red-400/70 uppercase tracking-wider mb-4">Danger Zone</Text>
          {!confirmDelete ? (
            <View>
              <Text className="text-sm text-gray-400 mb-4">Permanently delete your account. This cannot be undone.</Text>
              <Button variant="danger" onPress={() => setConfirmDelete(true)}>
                Delete Account
              </Button>
            </View>
          ) : (
            <View className="gap-3">
              <View className="gap-1">
                <Text className="text-sm text-red-300">• Leagues you run are handed to the next member who joined. If you are the only member, the league is deleted.</Text>
                <Text className="text-sm text-red-300">• Your teams in leagues that have already drafted stay behind, unmanaged.</Text>
                <Text className="text-sm text-red-300">• This cannot be undone.</Text>
              </View>
              <Input
                label="Confirm your password"
                secureTextEntry
                value={deletePassword}
                onChangeText={setDeletePassword}
              />
              {deleteError !== '' && (
                <View className="bg-red-500/10 border border-red-500/20 rounded-lg p-2">
                  <Text className="text-sm text-red-400">{deleteError}</Text>
                </View>
              )}
              <View className="flex-row gap-2">
                <Button variant="danger" className="flex-1" onPress={handleDeleteAccount} disabled={!deletePassword || deleting}>
                  {deleting ? 'Deleting…' : 'Permanently delete'}
                </Button>
                <Button
                  variant="secondary"
                  className="flex-1"
                  onPress={() => {
                    setConfirmDelete(false);
                    setDeletePassword('');
                    setDeleteError('');
                  }}
                  disabled={deleting}
                >
                  Cancel
                </Button>
              </View>
            </View>
          )}
        </Card>
      </ScrollView>
    </View>
  );
}
