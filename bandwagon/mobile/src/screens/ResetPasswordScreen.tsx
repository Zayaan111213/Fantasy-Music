import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import type { User } from '@bandwagon/shared';
import { passwordPolicyError } from '../utils/passwordPolicy';
import { WagonMark } from '../components/Logo';

// The web version reads `token` from the URL query string of an emailed link.
// Here it arrives as a route param: the universal link
// https://bandwagoner.com/reset-password?token=... is claimed by the AASA file
// (backend/src/server.ts) and mapped to this screen by the `linking` config in
// RootNavigator, and React Navigation parses the query string into params.
//
// `token` is still optional. Opening this screen any other way, or tapping the
// link before iOS has fetched the AASA for a fresh install, leaves it
// undefined, which is what the invalid-link state below is for.
export function ResetPasswordScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const token: string | undefined = route.params?.token;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  async function handleSubmit() {
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    const policyError = passwordPolicyError(password);
    if (policyError) {
      setError(policyError);
      return;
    }
    setLoading(true);
    try {
      const { token: jwt, user } = await api.post<{ token: string; user: User }>('/auth/reset-password', {
        token,
        password,
      });
      await login(jwt, user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View className="flex-1 bg-gray-950 items-center justify-center px-4">
      <View className="w-full max-w-md">
        <View className="items-center mb-8">
          <WagonMark size={56} />
          <Text className="text-3xl font-bold text-white mt-4">Choose a new password</Text>
          <Text className="text-gray-400 mt-1">You'll be logged in right after</Text>
        </View>

        <View className="bg-white/5 border border-white/10 rounded-2xl p-8">
          {!token ? (
            <View className="items-center gap-4">
              <Text className="text-white font-medium">This reset link is invalid.</Text>
              <Pressable onPress={() => navigation.navigate('ForgotPassword')}>
                <Text className="text-sm text-indigo-400">Request a new link</Text>
              </Pressable>
            </View>
          ) : (
            <View className="gap-4">
              <Input label="New Password" placeholder="••••••••" secureTextEntry value={password} onChangeText={setPassword} />
              <Input label="Confirm Password" placeholder="••••••••" secureTextEntry value={confirm} onChangeText={setConfirm} />

              {error !== '' && (
                <View className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  <Text className="text-sm text-red-400">{error}</Text>
                  {error === 'Invalid or expired reset link' && (
                    <Pressable onPress={() => navigation.navigate('ForgotPassword')} className="mt-1">
                      <Text className="text-indigo-400">Request a new link</Text>
                    </Pressable>
                  )}
                </View>
              )}

              <Button onPress={handleSubmit} disabled={loading} size="lg" className="mt-2">
                {loading ? 'Saving…' : 'Set New Password'}
              </Button>
            </View>
          )}

          <Pressable onPress={() => navigation.goBack()} className="mt-6 items-center">
            <Text className="text-sm text-indigo-400">Back to log in</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
