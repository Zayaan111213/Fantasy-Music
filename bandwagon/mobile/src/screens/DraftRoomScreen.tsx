import { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, Pressable, TextInput, FlatList, AppState } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { io, type Socket } from 'socket.io-client';
import * as SecureStore from 'expo-secure-store';
import { Search, CheckCircle, Circle, X } from 'lucide-react-native';
import { useAuth } from '../context/AuthContext';
import { Badge } from '../components/ui/Badge';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { Header } from '../components/Header';
import { SlotPill, genreLabel } from '../components/SlotPill';
import { TimerRing, CountdownRing } from '../components/draft/Rings';
import type { DraftState, DraftPick, Artist } from '@bandwagon/shared';
import { api, SOCKET_URL, TOKEN_KEY } from '../api/client';

const ALL_SLOTS = ['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country', 'Other', 'Flex', 'Bench-1', 'Bench-2', 'Bench-3'];
const MAIN_GENRES_DRAFT = new Set(['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country']);
function hasEligibleSlot(genre: string, openSlots: string[]): boolean {
  return openSlots.some((slot) => {
    if (slot.startsWith('Bench') || slot === 'Flex') return true;
    if (slot === 'Other') return !MAIN_GENRES_DRAFT.has(genre);
    return genre === slot;
  });
}

const GENRES = ['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country', 'Other'];

export function DraftRoomScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const leagueId: string = route.params.leagueId;
  const { user } = useAuth();

  const socketRef = useRef<Socket | null>(null);
  const tokenRef = useRef('');
  const [state, setState] = useState<DraftState | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const [countdownSeconds, setCountdownSeconds] = useState(900);
  const [search, setSearch] = useState('');
  const [genreFilter, setGenreFilter] = useState('');
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const toastIdRef = useRef(0);
  const [availableArtists, setAvailableArtists] = useState<Artist[]>([]);
  const [loadingArtists, setLoadingArtists] = useState(false);
  const [sort, setSort] = useState<{ field: 'name' | 'last' | 'avg'; dir: 'desc' | 'asc' }>({ field: 'last', dir: 'desc' });

  // Local pre-draft countdown, ticked from the server-provided end time.
  useEffect(() => {
    if (!state?.countdownEndsAt) return;
    const tick = () => setCountdownSeconds(Math.max(0, Math.round((new Date(state.countdownEndsAt!).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [state?.countdownEndsAt]);

  function addToast(msg: string) {
    const id = ++toastIdRef.current;
    setToasts((prev) => [{ id, msg }, ...prev.slice(0, 4)]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 10000);
  }

  useEffect(() => {
    const socket = io(SOCKET_URL, { path: '/socket.io', transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', async () => {
      const token = (await SecureStore.getItemAsync(TOKEN_KEY)) ?? '';
      tokenRef.current = token;
      socket.emit('draft:join', { leagueId, token });
    });

    socket.on('draft:state', (s: DraftState) => {
      setState(s);
      if (s.timerEndsAt) setSecondsLeft(Math.max(0, Math.round((new Date(s.timerEndsAt).getTime() - Date.now()) / 1000)));
    });

    socket.on('draft:tick', (s: number) => setSecondsLeft(s));

    socket.on('draft:pick-made', (pick: DraftPick & { artist: Artist; team: { name: string }; isAutoDraft: boolean }) => {
      setState((prev) => (prev ? { ...prev, picks: [...prev.picks, pick], currentPickIndex: prev.currentPickIndex + 1 } : prev));
      setSecondsLeft(60);
      addToast(pick.isAutoDraft
        ? `Auto: ${pick.team.name} drafts ${pick.artist.name} (${pick.slot})`
        : `${pick.team.name} drafts ${pick.artist.name} (${pick.slot})`);
    });

    socket.on('draft:complete', () => {
      addToast('Draft complete! Loading scores…');
      setTimeout(() => navigation.replace('LeagueHub', { leagueId }), 5000);
    });

    socket.on('draft:error', (msg: string) => addToast(`Error: ${msg}`));

    return () => { socket.disconnect(); };
  }, [leagueId]);

  // Mobile backgrounding pauses the JS timer and can drop the socket in a
  // way a browser tab never does — force a reconnect (which re-runs the
  // 'connect' handler above and re-fetches draft:state) on foreground return
  // instead of trusting a possibly-stale local countdown (see migration plan §6).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && socketRef.current && !socketRef.current.connected) {
        socketRef.current.connect();
      }
    });
    return () => sub.remove();
  }, []);

  const fetchArtists = useCallback(async () => {
    setLoadingArtists(true);
    try {
      const data = await api.get<Artist[]>(`/artists?q=${search}&genre=${genreFilter}&limit=5000`);
      const draftedIds = new Set(state?.picks.map((p) => p.artistId) ?? []);
      setAvailableArtists(data.filter((a) => !draftedIds.has(a.id)));
    } finally {
      setLoadingArtists(false);
    }
  }, [search, genreFilter, state?.picks.length]);

  useEffect(() => { fetchArtists(); }, [fetchArtists]);

  function makePick(artistId: string) {
    socketRef.current?.emit('draft:pick', { leagueId, artistId, token: tokenRef.current });
  }

  function skipCountdown() {
    socketRef.current?.emit('draft:skip-countdown', { leagueId, token: tokenRef.current });
  }

  if (!state) {
    return (
      <View className="flex-1 bg-gray-950 items-center justify-center">
        <Spinner size="large" />
        <Text className="text-gray-400 mt-4">Connecting to draft…</Text>
      </View>
    );
  }

  const isPreDraft = state.status === 'pre_draft';
  const onClockTeamId = state.pickOrder[state.currentPickIndex];
  const onClockTeam = state.teams.find((t) => t.id === onClockTeamId);
  const isMyTurn = !isPreDraft && onClockTeam?.userId === user?.id;
  const myTeam = state.teams.find((t) => t.userId === user?.id);
  const filledSlots = new Set(state.picks.filter((p) => p.teamId === myTeam?.id).map((p) => p.slot));
  const openSlots = ALL_SLOTS.filter((s) => !filledSlots.has(s));

  const totalPicks = state.teams.length * ALL_SLOTS.length;
  const round = Math.floor(state.currentPickIndex / state.teams.length) + 1;

  const sortedArtists = [...availableArtists].sort((a, b) => {
    let cmp = 0;
    if (sort.field === 'name') cmp = a.name.localeCompare(b.name);
    else if (sort.field === 'last') cmp = (a.lastWeekPoints ?? 0) - (b.lastWeekPoints ?? 0);
    else cmp = (a.avgLast5Points ?? 0) - (b.avgLast5Points ?? 0);
    return sort.dir === 'desc' ? -cmp : cmp;
  });

  function toggleSort(field: 'name' | 'last' | 'avg') {
    setSort((p) => (p.field === field ? { field, dir: p.dir === 'desc' ? 'asc' : 'desc' } : { field, dir: 'desc' }));
  }

  const header = (
    <View className="gap-4 mb-3">
      <Card className="p-4 items-center">
        {isPreDraft ? (
          <>
            <Text className="text-xs text-gray-500 mb-2">Draft starting in</Text>
            <CountdownRing seconds={countdownSeconds} />
            <View className="mt-3 gap-2 w-full items-center">
              <Text className="text-gray-400 text-xs">Browse artists while you wait</Text>
              <Button size="sm" onPress={skipCountdown} className="w-full">Start Now</Button>
              <Text className="text-xs text-gray-600">Commissioner only</Text>
            </View>
          </>
        ) : (
          <>
            <Text className="font-serif text-sm text-gray-400 mb-2">Round {round} · Pick {state.currentPickIndex + 1} of {totalPicks}</Text>
            <TimerRing seconds={secondsLeft} />
            <View className="mt-3 items-center">
              {state.isComplete ? (
                <View className="gap-2 w-full items-center">
                  <Text className="text-green-400 font-semibold text-sm">Draft Complete!</Text>
                  <Button size="sm" onPress={() => navigation.replace('LeagueHub', { leagueId })}>Go to My Team</Button>
                </View>
              ) : isMyTurn ? (
                <Text className="text-indigo-400 font-semibold text-sm">Your pick!</Text>
              ) : (
                <Text className="text-gray-400 text-sm text-center"><Text className="text-white font-medium">{onClockTeam?.name}</Text>{'\n'}is on the clock</Text>
              )}
            </View>
          </>
        )}
      </Card>

      <Card className="p-4">
        <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">My Slots</Text>
        {ALL_SLOTS.map((slot) => {
          const filled = filledSlots.has(slot);
          const pick = state.picks.find((p) => p.teamId === myTeam?.id && p.slot === slot);
          return (
            <View key={slot} className="flex-row items-center gap-2 py-1">
              {filled ? <CheckCircle color="#6FA595" size={16} /> : <Circle color="#43301F" size={16} />}
              <SlotPill slot={slot} />
              {filled && pick && <Text className="text-xs text-white flex-1" numberOfLines={1}>{pick.artist?.name}</Text>}
            </View>
          );
        })}
      </Card>

      <View className="flex-row items-center gap-2 bg-white/10 border border-white/20 rounded-lg px-3">
        <Search color="#7C6650" size={16} />
        <TextInput value={search} onChangeText={setSearch} placeholder="Search artists…" placeholderTextColor="#7C6650" className="flex-1 text-white py-2.5" />
      </View>
      <View className="flex-row gap-2 -mt-2">
        <Pressable onPress={() => setGenreFilter('')} className={`px-3 py-1.5 rounded-lg ${genreFilter === '' ? 'bg-indigo-500' : 'bg-white/10'}`}>
          <Text className={`text-xs font-medium ${genreFilter === '' ? 'text-gray-950' : 'text-gray-300'}`}>All</Text>
        </Pressable>
        {GENRES.map((g) => (
          <Pressable key={g} onPress={() => setGenreFilter(g)} className={`px-3 py-1.5 rounded-lg ${genreFilter === g ? 'bg-indigo-500' : 'bg-white/10'}`}>
            <Text className={`text-xs font-medium ${genreFilter === g ? 'text-gray-950' : 'text-gray-300'}`}>{g}</Text>
          </Pressable>
        ))}
      </View>

      <View className="flex-row items-center px-3 py-2 border-b border-gray-700">
        <Pressable onPress={() => toggleSort('name')} className="flex-1">
          <Text className={`text-xs uppercase tracking-wider font-medium ${sort.field === 'name' ? 'text-indigo-400' : 'text-gray-500'}`}>
            Artist {sort.field === 'name' ? (sort.dir === 'desc' ? '↓' : '↑') : '↕'}
          </Text>
        </Pressable>
        <Pressable onPress={() => toggleSort('last')} className="w-16 items-end">
          <Text className={`text-xs uppercase tracking-wider font-medium ${sort.field === 'last' ? 'text-indigo-400' : 'text-gray-500'}`}>
            Last {sort.field === 'last' ? (sort.dir === 'desc' ? '↓' : '↑') : '↕'}
          </Text>
        </Pressable>
        <View className="w-16" />
      </View>
    </View>
  );

  const footer = (
    <Card className="p-4 mt-4">
      {isPreDraft ? (
        <>
          <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Teams ({state.teams.length})</Text>
          {state.teams.map((team) => (
            <View key={team.id} className="flex-row items-center gap-2 py-1">
              <Avatar src={team.user?.avatarUrl ?? null} name={team.user?.username ?? team.name} size="sm" />
              <View className="min-w-0 flex-1">
                <Text className="text-xs font-medium text-white" numberOfLines={1}>{team.name}</Text>
                <Text className="text-xs text-gray-600">{team.user?.username ?? ''}</Text>
              </View>
              {team.draftPosition != null && <Text className="text-xs text-gray-600 font-serif">#{team.draftPosition}</Text>}
            </View>
          ))}
        </>
      ) : (
        <>
          <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Recent Picks</Text>
          {[...state.picks].reverse().map((pick) => (
            <View key={pick.id} className="flex-row items-center gap-2 py-1.5 border-b border-gray-900 last:border-0">
              <Avatar src={pick.artist?.imageUrl} name={pick.artist?.name ?? '?'} size="sm" />
              <View className="flex-1 min-w-0">
                <Text className="text-xs font-medium text-white" numberOfLines={1}>{pick.artist?.name}</Text>
                <Text className="text-xs text-gray-600">{pick.team?.name} · {pick.slot}</Text>
              </View>
              <Text className="text-xs text-gray-600 font-serif">#{pick.pickNumber}</Text>
            </View>
          ))}
          {state.picks.length === 0 && <Text className="text-xs text-gray-600 text-center py-4">No picks yet</Text>}
        </>
      )}
    </Card>
  );

  return (
    <View className="flex-1 bg-gray-950">
      <Header title={isPreDraft ? 'Draft Lobby' : 'Live Draft'} />

      <View className="absolute top-16 right-4 z-50 gap-2 w-64">
        {toasts.map(({ id, msg }) => (
          <View key={id} className="flex-row items-start gap-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2">
            <Text className="flex-1 text-sm text-white">{msg}</Text>
            <Pressable onPress={() => setToasts((prev) => prev.filter((t) => t.id !== id))}>
              <X color="#7C6650" size={14} />
            </Pressable>
          </View>
        ))}
      </View>

      <FlatList
        data={sortedArtists}
        keyExtractor={(a) => a.id}
        contentContainerClassName="px-4 py-6"
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        ListEmptyComponent={loadingArtists ? <View className="py-8 items-center"><Spinner size="large" /></View> : <Text className="text-center py-8 text-gray-500 text-sm">No artists found</Text>}
        renderItem={({ item: artist }) => {
          const canDraft = isMyTurn && hasEligibleSlot(artist.primaryGenre, openSlots);
          return (
            <Pressable
              onPress={() => navigation.navigate('ArtistDetail', { artistId: artist.id, leagueId })}
              className="flex-row items-center gap-2 py-3 border-b border-gray-900"
            >
              <Avatar src={artist.imageUrl} name={artist.name} size="sm" />
              <View className="flex-1 min-w-0">
                <Text className="text-sm font-medium text-white" numberOfLines={1}>{artist.name}</Text>
                <Badge genre={artist.primaryGenre}>{genreLabel(artist.primaryGenre)}</Badge>
              </View>
              <Text className="w-14 text-right font-serif text-[15px] text-gray-300">{(artist.lastWeekPoints ?? 0).toFixed(1)}</Text>
              {isMyTurn && (
                <Pressable
                  onPress={(e) => { e.stopPropagation(); makePick(artist.id); }}
                  disabled={!canDraft}
                  className="bg-indigo-500 rounded-lg px-3 py-1.5 ml-2"
                  style={{ opacity: canDraft ? 1 : 0.4 }}
                >
                  <Text className="text-gray-950 text-xs font-medium">Draft</Text>
                </Pressable>
              )}
            </Pressable>
          );
        }}
      />
    </View>
  );
}
