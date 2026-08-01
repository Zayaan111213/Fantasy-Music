import { View, Text, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Music } from 'lucide-react-native';
import type { ChartRow } from '@bandwagon/shared';
import { Card } from './ui/Card';
import { Avatar } from './ui/Avatar';

// Extracted from HomeScreen so the Intro screen's "top movers" preview can
// reuse the same rows.
function MoverRow({ row, interactive = true }: { row: ChartRow; interactive?: boolean }) {
  const navigation = useNavigation<any>();
  const up = (row.delta ?? 0) > 0;
  const a = row.artists[0];
  return (
    <Pressable
      disabled={!a || !interactive}
      onPress={() => interactive && a && navigation.navigate('ArtistDetail', { artistId: a.id })}
      className="flex-row items-center gap-3 py-2 border-b border-gray-900 last:border-0"
    >
      <Text className="w-6 font-serif text-base text-gray-500 text-center">{row.rank}</Text>
      {a ? (
        <Avatar src={a.imageUrl} name={a.name} size="sm" />
      ) : (
        <View className="w-8 h-8 rounded-lg bg-gray-800 border border-gray-700 items-center justify-center">
          <Text className="text-gray-500 text-xs">♪</Text>
        </View>
      )}
      <View className="flex-1 min-w-0">
        <Text className="text-sm font-semibold text-white" numberOfLines={1}>{row.title}</Text>
        <Text className="text-xs text-gray-400" numberOfLines={1}>{row.artists.map((x) => x.name).join(', ') || '—'}</Text>
      </View>
      <Text className={`text-[13px] font-bold ${up ? 'text-green-400' : 'text-red-400'}`}>
        {up ? '▲' : '▼'} {Math.abs(row.delta ?? 0)}
      </Text>
    </Pressable>
  );
}

export function MoversCard({ label, Icon, data, linkToCharts = true, interactive = true }: {
  label: string;
  Icon: typeof Music;
  data?: { risers: ChartRow[]; fallers: ChartRow[] };
  linkToCharts?: boolean;
  interactive?: boolean;
}) {
  const navigation = useNavigation<any>();
  const rows = [...(data?.risers.slice(0, 3) ?? []), ...(data?.fallers.slice(0, 2) ?? [])];
  return (
    <Card className="p-5">
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center gap-2">
          <Icon color="#A88F70" size={14} />
          <Text className="text-[11px] font-bold uppercase tracking-widest text-gray-400">{label} · This Week's Movers</Text>
        </View>
        {linkToCharts && (
          <Pressable onPress={() => navigation.navigate('Main', { screen: 'Charts' })}>
            <Text className="text-[11px] font-semibold text-indigo-400">Full chart →</Text>
          </Pressable>
        )}
      </View>
      {rows.length > 0 ? (
        rows.map((row) => <MoverRow key={row.rank} row={row} interactive={interactive} />)
      ) : (
        <Text className="text-sm text-gray-500 py-4 text-center">No chart movement yet this week.</Text>
      )}
    </Card>
  );
}
