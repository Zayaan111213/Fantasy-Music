import { View, Text, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { RosterSpot } from '@bandwagon/shared';
import { SlotPill, genreLabel } from './SlotPill';
import { Avatar } from './ui/Avatar';
import { Badge } from './ui/Badge';

export function getRosterSpot(roster: RosterSpot[], slot: string): RosterSpot {
  return roster.find((s) => s.slot === slot) ?? { id: '', teamId: '', artistId: null, slot, artist: null };
}

export function RosterRow({ spot, onSwapSelect, selectedSlot, readOnly = false, leagueId, prevScore }: {
  spot: RosterSpot;
  onSwapSelect?: (slot: string) => void;
  selectedSlot?: string | null;
  readOnly?: boolean;
  leagueId?: string;
  prevScore?: number | null;
}) {
  const navigation = useNavigation<any>();
  const score = spot.artist?.weeklyScores?.[0];
  const isBench = spot.slot.startsWith('Bench');
  const isSelected = !readOnly && selectedSlot === spot.slot;

  return (
    <Pressable
      onPress={readOnly ? undefined : () => onSwapSelect?.(spot.slot)}
      className={`flex-row items-center gap-3 rounded-lg p-3 ${isSelected ? 'bg-indigo-500/20 border border-indigo-500/50' : 'border border-transparent'}`}
    >
      <View className="w-20 shrink-0">
        <SlotPill slot={spot.slot} />
      </View>
      {spot.artist ? (
        <>
          <Avatar src={spot.artist.imageUrl} name={spot.artist.name} size="sm" />
          <Pressable
            className="flex-1 min-w-0"
            onPress={() => navigation.navigate('ArtistDetail', { artistId: spot.artist!.id, leagueId })}
          >
            <Text className="font-medium text-white text-sm" numberOfLines={1}>{spot.artist.name}</Text>
            {(spot.slot === 'Other' || spot.slot === 'Flex' || spot.slot.startsWith('Bench')) && (
              <Badge genre={spot.artist.primaryGenre} className="mt-0.5">{genreLabel(spot.artist.primaryGenre)}</Badge>
            )}
          </Pressable>
          <View className="items-end shrink-0">
            {prevScore != null ? (
              <Text className="font-serif font-bold text-base text-gray-500">{prevScore.toFixed(1)}</Text>
            ) : (
              <Text className={`font-serif font-bold text-base ${isBench ? 'text-gray-500' : 'text-white'}`}>{score ? score.totalPoints.toFixed(1) : '-'}</Text>
            )}
            <Text className="text-xs text-gray-600">{prevScore != null ? 'prev' : 'pts'}</Text>
          </View>
        </>
      ) : (
        <>
          <View className="flex-1 min-w-0">
            <Text className="text-gray-600 italic text-sm">Empty slot</Text>
          </View>
          <Text className="text-xs text-gray-600">-</Text>
        </>
      )}
    </Pressable>
  );
}
