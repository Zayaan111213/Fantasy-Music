import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Image, Linking } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Music2, BarChart2, TrendingUp, Radio, ArrowLeftRight } from 'lucide-react-native';
import { api } from '../api/client';
import { posthog } from '../lib/posthog';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { Header } from '../components/Header';
import type { Artist, WeeklyScore, ChartBreakdown } from '@bandwagon/shared';

type ArtistWithScores = Artist & { weeklyScores: WeeklyScore[]; chartBreakdown?: ChartBreakdown | null };

function breakdownFromScore(ws: WeeklyScore): ChartBreakdown {
  return {
    song: ws.songRank !== null ? {
      rank: ws.songRank,
      title: ws.songTitle ?? '',
      movement: ws.songMovement,
      isDebut: ws.songIsDebut,
      positionPoints: ws.songPositionPoints,
      movementPoints: ws.songMovementPoints,
    } : null,
    album: ws.albumRank !== null ? {
      rank: ws.albumRank,
      title: ws.albumTitle ?? '',
      movement: ws.albumMovement,
      isDebut: ws.albumIsDebut,
      positionPoints: ws.albumPositionPoints,
      movementPoints: ws.albumMovementPoints,
    } : null,
  };
}

function isLegacyRow(ws: WeeklyScore): boolean {
  return ws.songRank === null && ws.albumRank === null
    && (ws.chartPositionPoints > 0 || ws.chartMovementPoints > 0);
}

function formatWeekLabel(ws: WeeklyScore): string {
  if (!ws.weekDate) return `Week ${ws.week}`;
  const formatted = new Date(ws.weekDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `Week of ${formatted}`;
}

function ScoreBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const isNegative = value < 0;
  const pct = max > 0 ? (Math.abs(value) / max) * 100 : 0;
  return (
    <View>
      <View className="flex-row justify-between gap-3 mb-1">
        <Text className="text-sm text-gray-400 flex-1" numberOfLines={1}>{label}</Text>
        <Text className={`text-sm font-semibold ${isNegative ? 'text-red-400' : 'text-white'}`}>{value.toFixed(1)}</Text>
      </View>
      <View className="h-1.5 bg-white/10 rounded-full overflow-hidden">
        <View className={`h-full rounded-full ${isNegative ? 'bg-red-500' : color}`} style={{ width: `${pct}%` }} />
      </View>
    </View>
  );
}

export function ArtistDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const artistId: string = route.params.artistId;
  const leagueId: string | undefined = route.params?.leagueId;

  const { data: artist, isLoading } = useQuery({
    queryKey: ['artist', artistId, leagueId],
    queryFn: () => api.get<ArtistWithScores>(`/artists/${artistId}${leagueId ? `?leagueId=${leagueId}` : ''}`),
  });

  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);

  useEffect(() => {
    if (artist) {
      posthog.capture('artist_viewed', {
        artistId: artist.id,
        artistName: artist.name,
        genre: artist.primaryGenre,
        leagueId,
      });
    }
  }, [artist?.id]);

  if (isLoading) {
    return (
      <View className="flex-1 bg-gray-950 items-center justify-center">
        <Spinner size="large" />
      </View>
    );
  }
  if (!artist) {
    return (
      <View className="flex-1 bg-gray-950 items-center justify-center">
        <Text className="text-gray-400">Artist not found</Text>
      </View>
    );
  }

  const latestScore = artist.weeklyScores[0];
  const maxTotal = Math.max(...artist.weeklyScores.map((s) => s.totalPoints), 1);
  const activeScore = artist.weeklyScores.find((s) => s.week === selectedWeek) ?? latestScore;
  const isViewingLatest = !!activeScore && activeScore.week === latestScore?.week;
  const activeBreakdown = activeScore
    ? (isViewingLatest ? artist.chartBreakdown ?? null : breakdownFromScore(activeScore))
    : null;
  const activeIsLegacy = !!activeScore && !isViewingLatest && isLegacyRow(activeScore);
  const activeIsOffChart = !activeIsLegacy && !activeBreakdown?.song && !activeBreakdown?.album;

  return (
    <View className="flex-1 bg-gray-950">
      <Header />
      <ScrollView contentContainerClassName="px-4 py-6 gap-6">
        <View className="flex-row items-start gap-5">
          <Image
            source={{ uri: artist.imageUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(artist.name)}&background=e8b23a&color=2c1e12&size=256` }}
            className="w-24 h-24 rounded-2xl"
          />
          <View className="flex-1 min-w-0 gap-3">
            <Text className="text-2xl font-bold text-white">{artist.name}</Text>
            <Badge genre={artist.primaryGenre}>{artist.primaryGenre}</Badge>
            <View className="flex-row flex-wrap gap-2">
              {leagueId && (
                <Pressable
                  onPress={() => navigation.navigate('TradePropose', { leagueId, artistId: artist.id })}
                  className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-lg border"
                  style={{ backgroundColor: 'rgba(217,160,44,0.2)', borderColor: 'rgba(217,160,44,0.3)' }}
                >
                  <ArrowLeftRight color="#D9A02C" size={14} />
                  <Text className="text-indigo-400 text-xs font-medium">Trade</Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => Linking.openURL(artist.appleArtistId
                  ? `https://music.apple.com/us/artist/${artist.appleArtistId}`
                  : `https://music.apple.com/us/search?term=${encodeURIComponent(artist.name)}`)}
                className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-lg border"
                style={{ backgroundColor: 'rgba(194,74,46,0.2)', borderColor: 'rgba(194,74,46,0.3)' }}
              >
                <Music2 color="#D5714F" size={14} />
                <Text className="text-xs font-medium" style={{ color: '#D5714F' }}>Apple Music</Text>
                <ExternalLink color="#D5714F" size={12} />
              </Pressable>
              {artist.spotifyId && (
                <Pressable
                  onPress={() => Linking.openURL(`https://open.spotify.com/artist/${artist.spotifyId}`)}
                  className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-lg border"
                  style={{ backgroundColor: 'rgba(143,191,173,0.2)', borderColor: 'rgba(143,191,173,0.3)' }}
                >
                  <Radio color="#8FBFAD" size={14} />
                  <Text className="text-xs font-medium text-green-400">Spotify</Text>
                  <ExternalLink color="#8FBFAD" size={12} />
                </Pressable>
              )}
            </View>
          </View>
        </View>

        {activeScore && (
          <Card className="p-5">
            <View className="flex-row items-center gap-2 mb-4">
              <BarChart2 color="#A88F70" size={16} />
              <Text className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex-1">
                {formatWeekLabel(activeScore)} Score Breakdown
              </Text>
              {!activeScore.isFinalized && <Text className="text-xs text-yellow-500">Provisional</Text>}
            </View>
            {activeIsLegacy ? (
              <Text className="text-xs text-gray-500 italic">
                Detailed breakdown isn't available for this week. It was scored before per-signal tracking was added. Total: {activeScore.totalPoints.toFixed(1)}
              </Text>
            ) : (
              <View className="gap-4">
                {activeIsOffChart ? (
                  <View className="gap-4">
                    <Text className="text-xs text-gray-500 italic">Not on the Most Played songs or albums charts this week</Text>
                    {(activeScore.songMovementPoints ?? 0) < 0 && (
                      <ScoreBar label="Song Movement · Fell Off Chart" value={activeScore.songMovementPoints} max={15} color="bg-pink-500" />
                    )}
                    {(activeScore.albumMovementPoints ?? 0) < 0 && (
                      <ScoreBar label="Album Movement · Fell Off Chart" value={activeScore.albumMovementPoints} max={15} color="bg-fuchsia-500" />
                    )}
                  </View>
                ) : (
                  <>
                    {activeBreakdown?.song ? (
                      <>
                        <ScoreBar
                          label={`Song Position · #${activeBreakdown.song.rank}${activeBreakdown.song.title ? ` · ${activeBreakdown.song.title}` : ''}`}
                          value={activeBreakdown.song.positionPoints}
                          max={25}
                          color="bg-sky-500"
                        />
                        <ScoreBar
                          label={`Song Movement · ${activeBreakdown.song.isDebut ? 'New Entry' : activeBreakdown.song.movement !== null ? `${activeBreakdown.song.movement > 0 ? '+' : ''}${activeBreakdown.song.movement}` : 'No change'}`}
                          value={activeBreakdown.song.movementPoints}
                          max={15}
                          color="bg-pink-500"
                        />
                      </>
                    ) : (activeScore.songMovementPoints ?? 0) < 0 ? (
                      <ScoreBar label="Song Movement · Fell Off Chart" value={activeScore.songMovementPoints} max={15} color="bg-pink-500" />
                    ) : (
                      <Text className="text-xs text-gray-500 italic">No song chart entry this week</Text>
                    )}
                    {activeBreakdown?.album ? (
                      <>
                        <ScoreBar
                          label={`Album Position · #${activeBreakdown.album.rank}${activeBreakdown.album.title ? ` · ${activeBreakdown.album.title}` : ''}`}
                          value={activeBreakdown.album.positionPoints}
                          max={25}
                          color="bg-violet-500"
                        />
                        <ScoreBar
                          label={`Album Movement · ${activeBreakdown.album.isDebut ? 'New Entry' : activeBreakdown.album.movement !== null ? `${activeBreakdown.album.movement > 0 ? '+' : ''}${activeBreakdown.album.movement}` : 'No change'}`}
                          value={activeBreakdown.album.movementPoints}
                          max={15}
                          color="bg-fuchsia-500"
                        />
                      </>
                    ) : (activeScore.albumMovementPoints ?? 0) < 0 ? (
                      <ScoreBar label="Album Movement · Fell Off Chart" value={activeScore.albumMovementPoints} max={15} color="bg-fuchsia-500" />
                    ) : (
                      <Text className="text-xs text-gray-500 italic">No album chart entry this week</Text>
                    )}
                    <ScoreBar label="Longevity" value={activeScore.longevityPoints ?? 0} max={12} color="bg-amber-500" />
                  </>
                )}
                <View className="flex-row justify-between items-center pt-3 border-t border-white/10">
                  <Text className="font-semibold text-white">Total</Text>
                  <Text className="text-2xl font-bold text-white">{activeScore.totalPoints.toFixed(1)}</Text>
                </View>
                {activeScore.dataMissing && !activeIsOffChart && (
                  <Text className="text-xs text-yellow-600">Note: some signals unavailable ({activeScore.dataMissing})</Text>
                )}
              </View>
            )}
          </Card>
        )}

        <Card className="p-5">
          <View className="flex-row items-center gap-2 mb-4">
            <TrendingUp color="#A88F70" size={16} />
            <Text className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex-1">Chart History</Text>
            <Text className="text-xs text-gray-600">Tap a week</Text>
          </View>
          <View className="gap-2">
            {artist.weeklyScores.map((score) => (
              <Pressable
                key={score.id}
                onPress={() => setSelectedWeek(score.week === activeScore?.week ? null : score.week ?? null)}
                className={`flex-row items-center gap-3 px-2 py-1 rounded-lg ${score.week === activeScore?.week ? 'bg-white/10' : ''}`}
              >
                <Text className="w-24 text-xs text-gray-500">{formatWeekLabel(score)}</Text>
                {score.totalPoints === 0 && score.songRank === null && score.albumRank === null ? (
                  <Text className="flex-1 text-xs text-gray-600 italic">Not on the charts</Text>
                ) : (
                  <View className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                    <View className="h-full bg-sky-500 rounded-full" style={{ width: `${(score.totalPoints / maxTotal) * 100}%` }} />
                  </View>
                )}
                <Text className={`w-12 text-right text-sm font-semibold ${score.totalPoints === 0 ? 'text-gray-600' : 'text-white'}`}>
                  {score.totalPoints.toFixed(1)}
                </Text>
                {!score.isFinalized && <Text className="text-xs text-yellow-600">~</Text>}
              </Pressable>
            ))}
          </View>
        </Card>
      </ScrollView>
    </View>
  );
}
