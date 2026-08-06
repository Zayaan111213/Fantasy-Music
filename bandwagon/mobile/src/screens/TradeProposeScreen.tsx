import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Check } from 'lucide-react-native';
import { api } from '../api/client';
import { posthog } from '../lib/posthog';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Avatar } from '../components/ui/Avatar';
import { Spinner } from '../components/ui/Spinner';
import { Header } from '../components/Header';
import { dropsNeededFor } from '../components/TradesSection';
import type { League, PlayerEntry, TradesResponse } from '@bandwagon/shared';

type TradeDraft = { teamId: string; give: string[]; receive: string[]; drops: string[] };

function draftKey(leagueId: string) {
  return `bw_trade_draft_${leagueId}`;
}

function PlayerRow({ player, selected, onToggle, leagueId }: {
  player: PlayerEntry;
  selected: boolean;
  onToggle: () => void;
  leagueId: string;
}) {
  const navigation = useNavigation<any>();
  return (
    <Pressable onPress={onToggle} className={`flex-row items-center gap-2 p-2 rounded-lg ${selected ? 'bg-indigo-500/20 border border-indigo-500/50' : 'border border-transparent'}`}>
      <Avatar src={player.imageUrl} name={player.name} size="sm" />
      <Pressable className="flex-1 min-w-0" onPress={(e) => { e.stopPropagation(); navigation.navigate('ArtistDetail', { artistId: player.id, leagueId }); }}>
        <Text className="text-sm text-white" numberOfLines={1}>{player.name}</Text>
        <Badge genre={player.primaryGenre}>{player.primaryGenre}</Badge>
      </Pressable>
      <View className="items-end">
        <Text className="text-sm font-mono font-semibold text-white">{(player.lastWeekPoints ?? 0).toFixed(1)}</Text>
        <Text className="text-[10px] text-gray-600">{(player.avgLast5Points ?? 0).toFixed(1)} avg</Text>
      </View>
      <View className="w-4">{selected && <Check color="#D9A02C" size={16} />}</View>
    </Pressable>
  );
}

export function TradeProposeScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const leagueId: string = route.params.leagueId;
  const initialArtistId: string | undefined = route.params?.artistId;
  const queryClient = useQueryClient();

  const [draftLoaded, setDraftLoaded] = useState(false);
  const [targetTeamId, setTargetTeamId] = useState('');
  const [give, setGive] = useState<Set<string>>(new Set());
  const [receive, setReceive] = useState<Set<string>>(new Set());
  const [drops, setDrops] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [artistParam, setArtistParam] = useState(initialArtistId ?? null);

  // In-progress proposal survives navigating to an artist's stats page and
  // back — AsyncStorage replaces the web version's sessionStorage.
  useEffect(() => {
    AsyncStorage.getItem(draftKey(leagueId)).then((raw) => {
      if (raw) {
        try {
          const d = JSON.parse(raw) as TradeDraft;
          setTargetTeamId(d.teamId);
          setGive(new Set(d.give));
          setReceive(new Set(d.receive));
          setDrops(new Set(d.drops));
        } catch {
          // ignore corrupt draft
        }
      }
      setDraftLoaded(true);
    });
  }, [leagueId]);

  const { data: league } = useQuery({
    queryKey: ['league', leagueId],
    queryFn: () => api.get<League & { teams: { id: string; name: string; logoUrl: string | null }[] }>(`/leagues/${leagueId}`),
  });
  const { data: players } = useQuery({
    queryKey: ['players', leagueId, '', ''],
    queryFn: () => api.get<PlayerEntry[]>(`/leagues/${leagueId}/players`),
  });
  const { data: tradesMeta } = useQuery({
    queryKey: ['trades', leagueId],
    queryFn: () => api.get<TradesResponse>(`/leagues/${leagueId}/trades`),
  });

  const myTeamId = tradesMeta?.myTeamId;

  useEffect(() => {
    if (!draftLoaded) return;
    AsyncStorage.setItem(draftKey(leagueId), JSON.stringify({ teamId: targetTeamId, give: [...give], receive: [...receive], drops: [...drops] } satisfies TradeDraft));
  }, [draftLoaded, leagueId, targetTeamId, give, receive, drops]);

  useEffect(() => {
    if (!artistParam || !players || !myTeamId) return;
    const player = players.find((p) => p.id === artistParam);
    if (!player) {
      setNotice('That artist could not be found in this league.');
    } else if (!player.rosteredBy) {
      setNotice(`${player.name} is a free agent. Claim them from the Players tab instead of trading.`);
    } else if (player.rosteredBy.id === myTeamId) {
      setGive((prev) => new Set(prev).add(player.id));
    } else {
      setTargetTeamId((prevTeam) => {
        if (prevTeam && prevTeam === player.rosteredBy!.id) {
          setReceive((prev) => new Set(prev).add(player.id));
          return prevTeam;
        }
        setReceive(new Set([player.id]));
        setDrops(new Set());
        return player.rosteredBy!.id;
      });
    }
    setArtistParam(null);
  }, [artistParam, players, myTeamId]);

  const effectiveDrops = new Set([...drops].filter((d) => !give.has(d)));
  const proposeMutation = useMutation({
    mutationFn: () => api.post(`/leagues/${leagueId}/trades`, { toTeamId: targetTeamId, give: [...give], receive: [...receive], drops: [...effectiveDrops] }),
    onSuccess: () => {
      posthog.capture('trade_proposed', { leagueId, giveCount: give.size, receiveCount: receive.size });
      AsyncStorage.removeItem(draftKey(leagueId));
      queryClient.invalidateQueries({ queryKey: ['trades', leagueId] });
      navigation.replace('LeagueHub', { leagueId });
    },
    onError: (err: Error) => setError(err.message),
  });

  if (!league || !players || !tradesMeta || !draftLoaded) {
    return <View className="flex-1 bg-gray-950 items-center justify-center"><Spinner size="large" /></View>;
  }

  const myArtists = players.filter((p) => p.rosteredBy?.id === myTeamId);
  const theirArtists = players.filter((p) => p.rosteredBy?.id === targetTeamId);
  const otherTeams = league.teams.filter((t) => t.id !== myTeamId);

  const dropsNeeded = dropsNeededFor(myArtists.length, give.size, receive.size);
  const dropCandidates = myArtists.filter((p) => !give.has(p.id));

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id_: string, cap?: number) => {
    const next = new Set(set);
    if (next.has(id_)) next.delete(id_);
    else if (cap === undefined || next.size < cap) next.add(id_);
    setter(next);
  };

  const selectTeam = (teamId: string) => {
    if (teamId !== targetTeamId) {
      setTargetTeamId(teamId);
      setReceive(new Set());
      setDrops(new Set());
    }
  };

  const clearDraftAndLeave = () => {
    AsyncStorage.removeItem(draftKey(leagueId));
    navigation.goBack();
  };

  const canSubmit = !tradesMeta.tradingClosed && targetTeamId !== '' && give.size > 0 && receive.size > 0 && effectiveDrops.size === dropsNeeded && !proposeMutation.isPending;

  return (
    <View className="flex-1 bg-gray-950">
      <Header title="Propose Trade" />
      <ScrollView contentContainerClassName="px-4 py-6 gap-4">
        {tradesMeta.tradingClosed && (
          <View className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
            <Text className="text-sm text-amber-400">{tradesMeta.tradingClosed}</Text>
          </View>
        )}
        {notice !== '' && (
          <View className="bg-white/5 border border-white/10 rounded-lg p-3">
            <Text className="text-sm text-gray-400">{notice}</Text>
          </View>
        )}

        <Card className="p-4">
          <Text className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-2">Trade with</Text>
          <View className="flex-row flex-wrap gap-2">
            {otherTeams.map((t) => (
              <Pressable
                key={t.id}
                onPress={() => selectTeam(t.id)}
                className={`flex-row items-center gap-2 px-3 py-2 rounded-lg border ${targetTeamId === t.id ? 'bg-indigo-500/20 border-indigo-500/50' : 'bg-white/5 border-white/10'}`}
              >
                <Avatar src={t.logoUrl} name={t.name} size="sm" />
                <Text className="text-sm text-gray-300 max-w-36" numberOfLines={1}>{t.name}</Text>
                {targetTeamId === t.id && <Check color="#D9A02C" size={14} />}
              </Pressable>
            ))}
          </View>
        </Card>

        {targetTeamId !== '' && (
          <View className="gap-4">
            <Card className="p-4">
              <Text className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-2">You send ({give.size})</Text>
              {myArtists.map((p) => <PlayerRow key={p.id} player={p} leagueId={leagueId} selected={give.has(p.id)} onToggle={() => toggle(give, setGive, p.id)} />)}
            </Card>
            <Card className="p-4">
              <Text className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-2">You receive ({receive.size})</Text>
              {theirArtists.map((p) => <PlayerRow key={p.id} player={p} leagueId={leagueId} selected={receive.has(p.id)} onToggle={() => toggle(receive, setReceive, p.id)} />)}
            </Card>
          </View>
        )}

        {dropsNeeded > 0 && (
          <Card className="p-4">
            <Text className="text-[10px] text-amber-400 uppercase tracking-wider font-medium mb-2">
              You receive more than you send. Drop {dropsNeeded} ({effectiveDrops.size}/{dropsNeeded} selected)
            </Text>
            {dropCandidates.map((p) => <PlayerRow key={p.id} player={p} leagueId={leagueId} selected={effectiveDrops.has(p.id)} onToggle={() => toggle(effectiveDrops, setDrops, p.id, dropsNeeded)} />)}
          </Card>
        )}

        {error !== '' && <Text className="text-xs text-red-400">{error}</Text>}

        <View className="flex-row gap-2">
          <Pressable onPress={clearDraftAndLeave} className="flex-1 bg-white/10 rounded-lg py-2.5 items-center">
            <Text className="text-gray-300 text-sm font-medium">Cancel</Text>
          </Pressable>
          <Pressable
            onPress={() => proposeMutation.mutate()}
            disabled={!canSubmit}
            className="flex-1 bg-indigo-600 rounded-lg py-2.5 items-center"
            style={{ opacity: canSubmit ? 1 : 0.4 }}
          >
            <Text className="text-gray-950 text-sm font-medium">{proposeMutation.isPending ? 'Proposing…' : 'Propose Trade'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
