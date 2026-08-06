import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trophy } from 'lucide-react-native';
import { api } from '../../api/client';
import { posthog } from '../../lib/posthog';
import type { Bracket, League } from '@bandwagon/shared';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { minDraftTime, pacificInputValueToUtcIso } from '../../utils/draftTime';

function dateToPacificInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SeasonCompleteBanner({ leagueId, league, isCommissioner }: { leagueId: string; league: League; isCommissioner: boolean }) {
  const queryClient = useQueryClient();
  const [renewOpen, setRenewOpen] = useState(false);
  const [draftTime, setDraftTime] = useState<Date | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [renewError, setRenewError] = useState('');

  const { data: bracket } = useQuery({
    queryKey: ['bracket', leagueId],
    queryFn: () => api.get<Bracket | null>(`/leagues/${leagueId}/bracket`),
  });
  const final = bracket?.matchups.find((m) => m.matchupType === 'championship' && m.winnerId);
  const championName = final ? (final.winnerId === final.homeTeamId ? final.homeTeam.name : final.awayTeam.name) : null;

  const renewMutation = useMutation({
    mutationFn: () => api.post(`/leagues/${leagueId}/renew`, { draftTime: pacificInputValueToUtcIso(dateToPacificInputValue(draftTime!)) }),
    onSuccess: () => {
      posthog.capture('season_renewed', { leagueId });
      setRenewOpen(false);
      setRenewError('');
      queryClient.invalidateQueries();
    },
    onError: (err: Error) => setRenewError(err.message),
  });

  return (
    <Card className="p-4 mb-6" style={{ borderColor: 'rgba(239,163,107,0.3)', backgroundColor: 'rgba(239,163,107,0.05)' }}>
      <View className="flex-row items-center gap-3">
        <Trophy color="#EFA36B" size={32} />
        <View className="flex-1 min-w-0">
          <Text className="text-white font-semibold">
            {championName ? `${championName} are the ${league.seasonYear} champions!` : `The ${league.seasonYear} season is complete!`}
          </Text>
          <Text className="text-xs text-gray-400 mt-0.5">
            {isCommissioner ? 'Renew the league to run it back. Everyone keeps their team, and the worst team drafts first.' : 'Ask your commissioner to renew the league for another season.'}
          </Text>
        </View>
        {isCommissioner && !renewOpen && <Button size="sm" onPress={() => setRenewOpen(true)}>Renew League</Button>}
      </View>
      {isCommissioner && renewOpen && (
        <View className="mt-4 pt-4 border-t border-white/10 gap-2">
          <Text className="text-xs text-gray-400">Draft time for the {league.seasonYear + 1} season (at least 1 hour from now, Pacific Time)</Text>
          <Pressable onPress={() => setShowPicker(true)} className="bg-white/10 border border-white/20 rounded-lg px-3 py-2.5">
            <Text className="text-white text-sm">{draftTime ? dateToPacificInputValue(draftTime).replace('T', ' ') : 'Select date & time'}</Text>
          </Pressable>
          {showPicker && (
            <DateTimePicker
              value={draftTime ?? minDraftTime()}
              mode="datetime"
              minimumDate={minDraftTime()}
              onChange={(_, selected) => { setShowPicker(false); if (selected) setDraftTime(selected); }}
            />
          )}
          <View className="flex-row gap-2">
            <Button size="sm" disabled={!draftTime || renewMutation.isPending} onPress={() => renewMutation.mutate()}>
              {renewMutation.isPending ? 'Renewing…' : 'Start New Season'}
            </Button>
            <Pressable onPress={() => { setRenewOpen(false); setRenewError(''); }} className="bg-white/10 rounded-lg px-3 py-2 justify-center">
              <Text className="text-gray-300 text-sm font-medium">Cancel</Text>
            </Pressable>
          </View>
          {renewError !== '' && <Text className="text-xs text-red-400">{renewError}</Text>}
        </View>
      )}
    </Card>
  );
}
