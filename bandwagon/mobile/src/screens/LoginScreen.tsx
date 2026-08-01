import { useState } from 'react';
import { View, Text, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import type { User } from '@bandwagon/shared';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { WagonMark, Wordmark } from '../components/Logo';

// Ported from frontend/src/pages/Auth.tsx — login/signup only, no invite-code
// redirect handling or How-It-Works modal (those depend on flows not built
// in this phase; invite deep-linking also needs the scheme/universal-link
// infra flagged in ResetPasswordScreen).
export function LoginScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'login' | 'signup'>(route.params?.mode === 'signup' ? 'signup' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  async function handleSubmit() {
    setError('');
    setLoading(true);
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/signup';
      const { token, user } = await api.post<{ token: string; user: User }>(path, { email, password });
      await login(token, user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-gray-950 items-center justify-center px-4"
    >
      {navigation.canGoBack() && (
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} className="absolute left-4" style={{ top: insets.top + 12 }}>
          <ChevronLeft color="#A88F70" size={22} />
        </Pressable>
      )}
      <View className="w-full max-w-md">
        <View className="items-center mb-8">
          <WagonMark size={56} />
          <View className="mt-3">
            <Wordmark className="text-3xl" />
          </View>
          <Text className="text-gray-400 mt-1">Fantasy sports for music fans</Text>
        </View>

        <View className="bg-white/5 border border-white/10 rounded-2xl p-8">
          <View className="flex-row bg-white/5 rounded-lg p-1 mb-6">
            <Pressable onPress={() => setMode('login')} className={`flex-1 py-2 rounded-md ${mode === 'login' ? 'bg-indigo-500' : ''}`}>
              <Text className={`text-center text-sm font-medium ${mode === 'login' ? 'text-gray-950' : 'text-gray-400'}`}>Log In</Text>
            </Pressable>
            <Pressable onPress={() => setMode('signup')} className={`flex-1 py-2 rounded-md ${mode === 'signup' ? 'bg-indigo-500' : ''}`}>
              <Text className={`text-center text-sm font-medium ${mode === 'signup' ? 'text-gray-950' : 'text-gray-400'}`}>Sign Up</Text>
            </Pressable>
          </View>

          <View className="gap-4">
            <Input
              label="Email"
              placeholder="you@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <Input
              label="Password"
              placeholder="••••••••"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
            {mode === 'login' && (
              <Pressable onPress={() => navigation.navigate('ForgotPassword')} className="items-end -mt-2">
                <Text className="text-xs text-indigo-400">Forgot password?</Text>
              </Pressable>
            )}

            {error !== '' && (
              <View className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <Text className="text-sm text-red-400">{error}</Text>
              </View>
            )}

            <Button onPress={handleSubmit} disabled={loading || !email || !password} size="lg" className="mt-2">
              {loading ? 'Loading…' : mode === 'login' ? 'Log In' : 'Create Account'}
            </Button>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
