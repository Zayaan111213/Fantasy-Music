import { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Disc3, Music } from 'lucide-react-native';
import { api } from '../api/client';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { Avatar } from '../components/ui/Avatar';
import { Header } from '../components/Header';
import type { ChartRow, ChartsPayload } from '@bandwagon/shared';

function MovePill({ row }: { row: ChartRow }) {
  if (row.isNew) {
    return (
      <View className="border rounded-full px-2 py-0.5" style={{ borderColor: 'rgba(217,160,44,0.4)', backgroundColor: 'rgba(217,160,44,0.1)' }}>
        <Text className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">New</Text>
      </View>
    );
  }
  if (row.delta === 0) return <Text className="text-xs text-gray-600">–</Text>;
  const up = (row.delta ?? 0) > 0;
  return (
    <Text className={`text-[13px] font-bold ${up ? 'text-green-400' : 'text-red-400'}`}>
      {up ? '▲' : '▼'} {Math.abs(row.delta ?? 0)}
    </Text>
  );
}

function ChartTable({ rows }: { rows: ChartRow[] }) {
  const navigation = useNavigation<any>();
  if (rows.length === 0) {
    return <Text className="text-center py-12 text-gray-500 text-sm">No chart data yet this week.</Text>;
  }
  return (
    <View>
      <View className="flex-row items-center gap-2 px-3 py-2 border-b border-gray-700">
        <Text className="w-8 text-center text-[11px] font-bold uppercase tracking-widest text-gray-400">#</Text>
        <Text className="flex-1 text-[11px] font-bold uppercase tracking-widest text-gray-400">Title</Text>
        <Text className="w-16 text-center text-[11px] font-bold uppercase tracking-widest text-gray-400">Move</Text>
      </View>
      {rows.map((row) => (
        <View key={row.rank} className="flex-row items-center gap-2 px-3 py-2.5 border-b border-gray-900 last:border-0">
          <Text className="w-8 font-serif text-lg text-gray-400 text-center">{row.rank}</Text>
          <View className="flex-1 flex-row items-center gap-3 min-w-0">
            {row.artists[0] ? (
              <Avatar src={row.artists[0].imageUrl} name={row.artists[0].name} size="sm" />
            ) : (
              <View className="w-8 h-8 rounded-lg bg-gray-800 border border-gray-700 items-center justify-center">
                <Text className="text-gray-500 text-xs">♪</Text>
              </View>
            )}
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-semibold text-white" numberOfLines={1}>{row.title}</Text>
              {row.artists.length > 0 ? (
                <Pressable onPress={() => navigation.navigate('ArtistDetail', { artistId: row.artists[0].id })}>
                  <Text className="text-xs text-gray-400" numberOfLines={1}>
                    {row.artists.map((a) => a.name).join(', ')}
                  </Text>
                </Pressable>
              ) : (
                <Text className="text-xs text-gray-400">—</Text>
              )}
            </View>
          </View>
          <View className="w-16 items-center"><MovePill row={row} /></View>
        </View>
      ))}
    </View>
  );
}

export function ChartsScreen() {
  const navigation = useNavigation<any>();
  const [tab, setTab] = useState<'songs' | 'albums'>('songs');

  const { data, isLoading } = useQuery({
    queryKey: ['charts'],
    queryFn: () => api.get<ChartsPayload>('/charts'),
  });

  const weekLabel = data?.weekDate
    ? new Date(`${data.weekDate}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
    : null;

  return (
    <View className="flex-1 bg-gray-950">
      <Header showWordmark onBackPress={() => navigation.navigate('Main', { screen: 'Home' })} />
      <ScrollView contentContainerClassName="px-4 py-6 gap-4">
        <View>
          <Text className="font-serif font-bold text-white text-lg">Apple Music Charts</Text>
          {weekLabel && <Text className="text-xs text-gray-500">Most Played · week of {weekLabel}</Text>}
        </View>

        <View className="flex-row gap-2">
          <Pressable
            onPress={() => setTab('songs')}
            className={`flex-1 flex-row items-center justify-center gap-2 py-2.5 rounded-xl ${tab === 'songs' ? 'bg-indigo-500' : 'bg-gray-800 border border-gray-700'}`}
          >
            <Music color={tab === 'songs' ? '#140D09' : '#D3BF9E'} size={16} />
            <Text className={`text-sm font-semibold ${tab === 'songs' ? 'text-gray-950' : 'text-gray-300'}`}>Top 100 Songs</Text>
          </Pressable>
          <Pressable
            onPress={() => setTab('albums')}
            className={`flex-1 flex-row items-center justify-center gap-2 py-2.5 rounded-xl ${tab === 'albums' ? 'bg-indigo-500' : 'bg-gray-800 border border-gray-700'}`}
          >
            <Disc3 color={tab === 'albums' ? '#140D09' : '#D3BF9E'} size={16} />
            <Text className={`text-sm font-semibold ${tab === 'albums' ? 'text-gray-950' : 'text-gray-300'}`}>Top 100 Albums</Text>
          </Pressable>
        </View>

        <Card>
          {isLoading ? (
            <View className="py-16 items-center"><Spinner size="large" /></View>
          ) : (
            <ChartTable rows={tab === 'songs' ? (data?.songs ?? []) : (data?.albums ?? [])} />
          )}
        </Card>
      </ScrollView>
    </View>
  );
}
