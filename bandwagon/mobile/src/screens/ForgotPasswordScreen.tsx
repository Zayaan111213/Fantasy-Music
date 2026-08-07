import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { MailCheck } from 'lucide-react-native';
import { api } from '../api/client';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { WagonMark } from '../components/Logo';

export function ForgotPasswordScreen() {
  const navigation = useNavigation<any>();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
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
          <Text className="text-3xl font-bold text-white mt-4">Reset your password</Text>
          <Text className="text-gray-400 mt-1">We'll email you a link to set a new one</Text>
        </View>

        <View className="bg-white/5 border border-white/10 rounded-2xl p-8">
          {sent ? (
            <View className="items-center gap-3">
              <View className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/30 items-center justify-center">
                <MailCheck color="#6FA595" size={24} />
              </View>
              <Text className="text-white font-medium">Check your inbox</Text>
              {/*
                The emailed link is an https://bandwagoner.com URL and opens the
                web reset page, not this app (universal links aren't set up yet).
                Say so, rather than letting someone tap it and wonder why they
                ended up in Safari.
              */}
              <Text className="text-sm text-gray-400 text-center">
                We sent a reset link to <Text className="text-white">{email}</Text>. Opening it takes
                you to bandwagoner.com to choose a new password, then you can come back here and log
                in. The link expires in 1 hour.
              </Text>
            </View>
          ) : (
            <View className="gap-4">
              <Input
                label="Email"
                placeholder="you@example.com"
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
              {error !== '' && (
                <View className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  <Text className="text-sm text-red-400">{error}</Text>
                </View>
              )}
              <Button onPress={handleSubmit} disabled={loading || !email} size="lg" className="mt-2">
                {loading ? 'Sending…' : 'Send Reset Link'}
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
