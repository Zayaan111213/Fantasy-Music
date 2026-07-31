import { View, Text, Pressable } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronUp, ChevronDown } from 'lucide-react-native';
import { api } from '../api/client';
import type { WaiversResponse } from '@bandwagon/shared';
import { Card } from './ui/Card';
import { Avatar } from './ui/Avatar';

export function WaiverClaimsCard({ leagueId }: { leagueId: string }) {
  const queryClient = useQueryClient();
  const { data: waivers } = useQuery({
    queryKey: ['waivers', leagueId],
    queryFn: () => api.get<WaiversResponse>(`/leagues/${leagueId}/waivers`),
  });

  const cancelClaim = useMutation({
    mutationFn: (claimId: string) => api.post(`/leagues/${leagueId}/waivers/${claimId}/cancel`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['waivers', leagueId] }),
  });

  const reorder = useMutation({
    mutationFn: (claimIds: string[]) => api.put(`/leagues/${leagueId}/waivers/order`, { claimIds }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['waivers', leagueId] }),
  });

  const claims = waivers?.claims ?? [];
  if (claims.length === 0) return null;

  const busy = cancelClaim.isPending || reorder.isPending;

  function move(index: number, delta: number) {
    const ids = claims.map((c) => c.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + delta, 0, id);
    reorder.mutate(ids);
  }

  return (
    <Card>
      <View className="p-3 border-b border-white/10 gap-0.5">
        <Text className="text-sm font-semibold text-white">Pending waiver claims</Text>
        <Text className="text-xs text-gray-500">Waiver position #{waivers!.waiverPosition} · processes Sunday night</Text>
      </View>
      <View>
        {claims.map((claim, i) => (
          <View key={claim.id} className="flex-row items-center gap-3 p-3 border-b border-white/5 last:border-0">
            <Text className="w-5 text-center text-xs text-gray-500 font-mono">{i + 1}</Text>
            <View className="gap-0.5">
              <Pressable onPress={() => move(i, -1)} disabled={i === 0 || busy} hitSlop={4}>
                <ChevronUp color="#7C6650" size={16} style={{ opacity: i === 0 ? 0.3 : 1 }} />
              </Pressable>
              <Pressable onPress={() => move(i, 1)} disabled={i === claims.length - 1 || busy} hitSlop={4}>
                <ChevronDown color="#7C6650" size={16} style={{ opacity: i === claims.length - 1 ? 0.3 : 1 }} />
              </Pressable>
            </View>
            <Avatar src={claim.artist.imageUrl} name={claim.artist.name} size="sm" />
            <View className="flex-1 min-w-0">
              <Text className="text-sm font-medium text-white" numberOfLines={1}>{claim.artist.name}</Text>
              <Text className="text-xs text-gray-500" numberOfLines={1}>
                {claim.dropArtist ? `Drop: ${claim.dropArtist.name} (${claim.dropSlot})` : `Fill empty slot (${claim.dropSlot})`}
              </Text>
            </View>
            <Pressable onPress={() => cancelClaim.mutate(claim.id)} disabled={busy} className="bg-white/10 rounded-md px-2 py-1">
              <Text className="text-gray-300 text-xs font-medium">Cancel</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </Card>
  );
}
