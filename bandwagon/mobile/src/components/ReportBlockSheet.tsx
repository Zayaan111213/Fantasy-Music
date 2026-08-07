import { useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Button } from './ui/Button';
import { Input } from './ui/Input';

/**
 * Report and block, the two things App Store guideline 1.2 expects an app with
 * user-generated content to offer. The UGC here is names and images, so this is
 * reachable wherever another member's name is shown.
 *
 * Blocking does not remove someone from your league. A league is a fixed roster
 * for a season and the schedule references their team, so a block redacts their
 * name and pictures instead. The copy says so rather than implying otherwise.
 */

export type ReportTargetType = 'user' | 'team' | 'league';

const REASONS: { value: string; label: string }[] = [
  { value: 'offensive_name', label: 'Offensive name' },
  { value: 'offensive_image', label: 'Offensive picture' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'spam', label: 'Spam' },
  { value: 'other', label: 'Something else' },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  targetType: ReportTargetType;
  targetId: string;
  /** Display name, used in the copy. */
  targetName: string;
  /** Owning user. Omitted for a league, which can be reported but not blocked. */
  userId?: string;
}

export function ReportBlockSheet({ visible, onClose, targetType, targetId, targetName, userId }: Props) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<'reported' | 'blocked' | null>(null);

  function reset() {
    setReason(null);
    setDetails('');
    setError('');
    setDone(null);
    setBusy(false);
  }

  function close() {
    reset();
    onClose();
  }

  async function submitReport() {
    if (!reason) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/reports', { targetType, targetId, reason, details: details || undefined });
      setDone('reported');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that report');
    } finally {
      setBusy(false);
    }
  }

  async function blockUser() {
    if (!userId) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/users/${userId}/block`, {});
      // Standings is where the redaction shows up, and the block list feeds
      // Account Settings.
      queryClient.invalidateQueries({ queryKey: ['standings'] });
      queryClient.invalidateQueries({ queryKey: ['blocks'] });
      setDone('blocked');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not block that user');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View className="flex-1 bg-black/70 justify-end">
        <View className="bg-gray-950 border-t border-white/10 rounded-t-2xl p-6 gap-4">
          {done ? (
            <View className="gap-3">
              <Text className="text-lg font-semibold text-white">
                {done === 'reported' ? 'Thanks, we got it' : `${targetName} is blocked`}
              </Text>
              <Text className="text-sm text-gray-400">
                {done === 'reported'
                  ? 'Our team reviews reports and will take action if this breaks our rules.'
                  : "You won't see their name or pictures anymore. They stay in the league, since the season's schedule depends on their team."}
              </Text>
              <Button onPress={close}>Done</Button>
            </View>
          ) : (
            <ScrollView className="max-h-[500px]" keyboardShouldPersistTaps="handled">
              <View className="gap-4">
                <View>
                  <Text className="text-lg font-semibold text-white">Report {targetName}</Text>
                  <Text className="text-sm text-gray-400 mt-1">What's wrong?</Text>
                </View>

                <View className="gap-2">
                  {REASONS.map((r) => (
                    <Pressable
                      key={r.value}
                      onPress={() => setReason(r.value)}
                      className={`px-4 py-3 rounded-lg border ${
                        reason === r.value ? 'bg-indigo-500/20 border-indigo-500/50' : 'bg-white/5 border-white/10'
                      }`}
                    >
                      <Text className={`text-sm ${reason === r.value ? 'text-white' : 'text-gray-300'}`}>{r.label}</Text>
                    </Pressable>
                  ))}
                </View>

                <Input
                  label="Anything else? (optional)"
                  placeholder="Add any detail that would help"
                  value={details}
                  onChangeText={setDetails}
                  multiline
                />

                {error !== '' && (
                  <View className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                    <Text className="text-sm text-red-400">{error}</Text>
                  </View>
                )}

                <Button onPress={submitReport} disabled={busy || !reason}>
                  {busy ? 'Sending…' : 'Send Report'}
                </Button>

                {userId && (
                  <Button variant="danger" onPress={blockUser} disabled={busy}>
                    Block {targetName}
                  </Button>
                )}

                <Pressable onPress={close} className="items-center py-2">
                  <Text className="text-sm text-gray-400">Cancel</Text>
                </Pressable>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}
