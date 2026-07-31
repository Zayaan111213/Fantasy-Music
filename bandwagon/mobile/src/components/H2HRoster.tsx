import { View, Text, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { RosterSpot } from '@bandwagon/shared';
import { Card } from './ui/Card';
import { Avatar } from './ui/Avatar';
import { SlotPill } from './SlotPill';
import { ALL_STARTER_SLOTS, ALL_BENCH_SLOTS } from '../constants/roster';
import { getRosterSpot } from './RosterRow';

function H2HArtistCell({ spot, right = false, leagueId }: { spot: RosterSpot; right?: boolean; leagueId?: string }) {
  const navigation = useNavigation<any>();
  return (
    <View className={`flex-1 min-w-0 ${right ? 'items-end' : 'items-start'}`}>
      {spot.artist ? (
        <Pressable onPress={() => navigation.navigate('ArtistDetail', { artistId: spot.artist!.id, leagueId })}>
          <Text className="text-[13px] font-semibold text-white" numberOfLines={1}>{spot.artist.name}</Text>
        </Pressable>
      ) : (
        <Text className="text-[13px] italic text-gray-500" numberOfLines={1}>Empty slot</Text>
      )}
    </View>
  );
}

function h2hScoreOf(spot: RosterSpot, prevScoreMap?: Record<string, number>): number | null {
  if (prevScoreMap) return spot.artistId ? prevScoreMap[spot.artistId] ?? null : null;
  const s = spot.artist?.weeklyScores?.[0];
  return s ? s.totalPoints : null;
}

export function H2HRoster({ leftTitle, rightTitle, leftRoster, rightRoster, leagueId, prevScoreMap, dimScores = false }: {
  leftTitle: string;
  rightTitle: string;
  leftRoster: RosterSpot[];
  rightRoster: RosterSpot[];
  leagueId?: string;
  prevScoreMap?: Record<string, number>;
  dimScores?: boolean;
}) {
  function renderRow(slot: string, last: boolean) {
    const l = getRosterSpot(leftRoster, slot);
    const r = getRosterSpot(rightRoster, slot);
    const ls = h2hScoreOf(l, prevScoreMap);
    const rs = h2hScoreOf(r, prevScoreMap);
    const isBench = slot.startsWith('Bench');
    const lHi = !dimScores && !isBench && ls != null && (rs == null || ls > rs);
    const rHi = !dimScores && !isBench && rs != null && (ls == null || rs > ls);
    return (
      <View key={slot} className={`flex-row items-center gap-1.5 py-2.5 ${last ? '' : 'border-b border-gray-900'}`}>
        <H2HArtistCell spot={l} leagueId={leagueId} />
        <Text className={`w-10 text-center font-serif text-sm ${lHi ? 'text-indigo-400 font-bold' : 'text-gray-500'}`}>{ls != null ? ls.toFixed(1) : '–'}</Text>
        <View className="w-16 items-center"><SlotPill slot={slot} /></View>
        <Text className={`w-10 text-center font-serif text-sm ${rHi ? 'text-indigo-400 font-bold' : 'text-gray-500'}`}>{rs != null ? rs.toFixed(1) : '–'}</Text>
        <H2HArtistCell spot={r} right leagueId={leagueId} />
      </View>
    );
  }

  return (
    <Card className="px-4 py-1.5">
      <View className="flex-row items-center py-3 border-b border-gray-700">
        <Text className="flex-1 text-[11px] font-bold uppercase tracking-widest text-gray-400" numberOfLines={1}>{leftTitle}</Text>
        <Text className="w-16 text-[11px] font-bold uppercase tracking-widest text-gray-400 text-center">Slot</Text>
        <Text className="flex-1 text-[11px] font-bold uppercase tracking-widest text-gray-400 text-right" numberOfLines={1}>{rightTitle}</Text>
      </View>
      {ALL_STARTER_SLOTS.map((slot, i) => renderRow(slot, i === ALL_STARTER_SLOTS.length - 1))}
      <Text className="text-[11px] font-bold uppercase tracking-widest text-gray-500 text-center pt-3 pb-1.5 border-t border-gray-900">Bench</Text>
      {ALL_BENCH_SLOTS.map((slot, i) => renderRow(slot, i === ALL_BENCH_SLOTS.length - 1))}
    </Card>
  );
}
