import { useState, useEffect } from 'react';
import { View, Text, Pressable, Modal, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ChevronDown, Swords, ArrowUpDown, Lock } from 'lucide-react-native';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import type { League, LeagueMatchup, Matchup, RosterSpot } from '@bandwagon/shared';
import { Card } from '../../components/ui/Card';
import { Avatar } from '../../components/ui/Avatar';
import { Spinner } from '../../components/ui/Spinner';
import { H2HRoster } from '../../components/H2HRoster';
import { MatchupHeader } from '../../components/MatchupHeader';
import { PlayoffTag } from '../../components/BracketCard';
import { REGULAR_SEASON_WEEKS, type WeekPhase } from '../../utils/weekPhase';

// Reference total for the Monday view: starters only, from whatever week the
// matchup query was scored against.
function startersTotal(spots?: RosterSpot[]): number {
  return (spots ?? [])
    .filter((s) => !s.slot.startsWith('Bench'))
    .reduce((total, s) => total + (s.artist?.weeklyScores?.[0]?.totalPoints ?? 0), 0);
}

function weekTitle(week: number): string {
  if (week === 11) return 'Week 11 · Semifinals';
  if (week === 12) return 'Week 12 · Championship Week';
  return `Week ${week}`;
}

function MatchupDetailPanel({ leagueId, matchupId, referenceWeek }: { leagueId: string; matchupId: string; referenceWeek?: number | null }) {
  const { data, isLoading } = useQuery({
    queryKey: ['matchupDetail', leagueId, matchupId, referenceWeek ?? null],
    queryFn: () => api.get<Matchup>(
      `/leagues/${leagueId}/matchups/${matchupId}${referenceWeek ? `?scoresFromWeek=${referenceWeek}` : ''}`,
    ),
  });
  if (isLoading) return <View className="py-4 items-center"><Spinner size="small" /></View>;
  if (!data) return null;
  return (
    <View className="pt-2">
      <H2HRoster
        leftTitle={data.homeTeam?.name ?? 'Home'}
        rightTitle={data.awayTeam?.name ?? 'Away'}
        leftRoster={data.homeTeam?.rosterSpots ?? []}
        rightRoster={data.awayTeam?.rosterSpots ?? []}
        leagueId={leagueId}
        dimScores={!!referenceWeek}
      />
    </View>
  );
}

// referenceWeek: the Monday view. This week's stored scores are all 0, so the
// row reads "vs" like an upcoming game, and expanding it shows last week's
// numbers against today's rosters.
function LeagueMatchupsCard({ leagueId, week, myTeamId, upcoming = false, referenceWeek }: {
  leagueId: string;
  week: number;
  myTeamId?: string;
  upcoming?: boolean;
  referenceWeek?: number | null;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ['leagueMatchups', leagueId, week],
    queryFn: () => api.get<LeagueMatchup[]>(`/leagues/${leagueId}/matchups?week=${week}`),
  });
  if (!data || data.length === 0) return null;

  return (
    <Card className="p-4">
      <View className="flex-row items-center gap-2 mb-2">
        <Swords color="#A88F70" size={16} />
        <Text className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Around the League</Text>
      </View>
      {data.map((m) => {
        const homeWon = m.isFinalized && m.winnerId === m.homeTeamId;
        const awayWon = m.isFinalized && m.winnerId === m.awayTeamId;
        const mine = myTeamId != null && (m.homeTeamId === myTeamId || m.awayTeamId === myTeamId);
        const open = openId === m.id;
        const row = (
          <View className="flex-row items-center gap-2">
            <View className="flex-1 flex-row items-center gap-2 min-w-0">
              <Avatar src={m.homeTeam.logoUrl} name={m.homeTeam.name} size="sm" />
              <Text className={`flex-1 text-sm ${homeWon ? 'text-green-400 font-semibold' : 'text-white'}`} numberOfLines={1}>{m.homeTeam.name}</Text>
            </View>
            <View className="items-center gap-0.5">
              <Text className="font-serif text-sm">
                {upcoming || referenceWeek ? (
                  <Text className="text-gray-600">vs</Text>
                ) : (
                  <>
                    <Text className={homeWon ? 'text-green-400 font-bold' : m.homeScore >= m.awayScore ? 'text-white font-bold' : 'text-gray-400'}>{m.homeScore.toFixed(1)}</Text>
                    <Text className="text-gray-600"> – </Text>
                    <Text className={awayWon ? 'text-green-400 font-bold' : m.awayScore > m.homeScore ? 'text-white font-bold' : 'text-gray-400'}>{m.awayScore.toFixed(1)}</Text>
                  </>
                )}
              </Text>
              <PlayoffTag matchupType={m.matchupType} />
            </View>
            <View className="flex-1 flex-row items-center gap-2 justify-end min-w-0">
              <Text className={`flex-1 text-sm text-right ${awayWon ? 'text-green-400 font-semibold' : 'text-white'}`} numberOfLines={1}>{m.awayTeam.name}</Text>
              <Avatar src={m.awayTeam.logoUrl} name={m.awayTeam.name} size="sm" />
              {!upcoming && <ChevronDown color="#7C6650" size={14} />}
            </View>
          </View>
        );
        return (
          <View key={m.id} className={`py-2.5 px-3 rounded-xl ${mine ? 'bg-indigo-500/10 border border-indigo-500/30' : ''}`}>
            {upcoming ? row : <Pressable onPress={() => setOpenId(open ? null : m.id)}>{row}</Pressable>}
            {open && !upcoming && <MatchupDetailPanel leagueId={leagueId} matchupId={m.id} referenceWeek={referenceWeek} />}
          </View>
        );
      })}
    </Card>
  );
}

export function MatchupTab({ leagueId, league, phase }: { leagueId: string; league: League; phase: WeekPhase }) {
  const { user } = useAuth();
  const [viewWeek, setViewWeek] = useState(league.currentWeek);
  const [weekMenuOpen, setWeekMenuOpen] = useState(false);
  const [showResultPopup, setShowResultPopup] = useState(false);

  const isCurrentWeek = viewWeek === league.currentWeek && phase !== 'complete';
  const isPastWeek = viewWeek < league.currentWeek || phase === 'complete';
  const isFutureWeek = viewWeek > league.currentWeek && phase !== 'complete';

  // On Monday the new week hasn't been played yet, so both rosters are scored
  // against last week as a reference. /matchups/previous only knows about last
  // week's opponent — the new opponent's column came back all dashes — so the
  // reference week is asked for on the current-week matchup itself.
  const referenceWeek = isCurrentWeek && phase === 'adjustment' && league.currentWeek > 1 ? league.currentWeek - 1 : null;

  const { data: matchup, isLoading } = useQuery({
    queryKey: ['matchup', leagueId, 'week', viewWeek, referenceWeek],
    queryFn: () => api.get<Matchup | null>(
      `/leagues/${leagueId}/matchups/week/${viewWeek}${referenceWeek ? `?scoresFromWeek=${referenceWeek}` : ''}`,
    ),
    enabled: phase !== 'pre_season',
  });

  const { data: prevMatchup } = useQuery({
    queryKey: ['matchup', leagueId, 'previous'],
    queryFn: () => api.get<Matchup | null>(`/leagues/${leagueId}/matchups/previous`),
    enabled: isCurrentWeek && phase === 'adjustment' && league.currentWeek > 1,
  });

  useEffect(() => {
    if (!prevMatchup?.isFinalized || !prevMatchup?.winnerId || phase !== 'adjustment') return;
    const key = `bw_result_${leagueId}_w${prevMatchup.week}`;
    AsyncStorage.getItem(key).then((seen) => { if (!seen) setShowResultPopup(true); });
  }, [prevMatchup?.isFinalized, prevMatchup?.winnerId, prevMatchup?.week, phase, leagueId]);

  useEffect(() => { setViewWeek(league.currentWeek); }, [league.currentWeek]);

  if (phase === 'pre_season') {
    return <Text className="text-center py-12 text-gray-400">Your matchup will appear here after the draft.</Text>;
  }

  const totalWeeks = league.currentWeek > REGULAR_SEASON_WEEKS || league.status === 'complete' ? 12 : REGULAR_SEASON_WEEKS;

  function WeekNav() {
    return (
      <>
        <View className="flex-row items-center justify-between bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5">
          <Pressable onPress={() => setViewWeek((w) => Math.max(1, w - 1))} disabled={viewWeek <= 1} className="p-1">
            <ChevronLeft color="#A88F70" size={16} style={{ opacity: viewWeek <= 1 ? 0.3 : 1 }} />
          </Pressable>
          <View className="flex-row items-center gap-2">
            <Pressable onPress={() => setWeekMenuOpen(true)} className="flex-row items-center gap-1">
              <Text className="font-serif text-[15px] font-semibold text-white">{weekTitle(viewWeek)}</Text>
              <ChevronDown color="#A88F70" size={14} />
            </Pressable>
            {isCurrentWeek && (
              <View className="border rounded-full px-2.5 py-0.5" style={{ borderColor: 'rgba(217,160,44,0.4)' }}>
                <Text className="text-[11px] font-bold text-indigo-400">Current</Text>
              </View>
            )}
            {isPastWeek && matchup?.isFinalized && (
              <View className="bg-gray-700/50 rounded-full px-2.5 py-0.5"><Text className="text-[11px] font-bold text-gray-400">Final</Text></View>
            )}
          </View>
          <Pressable onPress={() => setViewWeek((w) => Math.min(totalWeeks, w + 1))} disabled={viewWeek >= totalWeeks} className="p-1">
            <ChevronRight color="#A88F70" size={16} style={{ opacity: viewWeek >= totalWeeks ? 0.3 : 1 }} />
          </Pressable>
        </View>
        <Modal transparent animationType="fade" visible={weekMenuOpen} onRequestClose={() => setWeekMenuOpen(false)}>
          <Pressable className="flex-1 items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={() => setWeekMenuOpen(false)}>
            <View className="w-full max-w-xs max-h-96 bg-gray-900 border border-white/10 rounded-lg py-1">
              <ScrollView>
                {Array.from({ length: totalWeeks }, (_, i) => i + 1).map((w) => (
                  <Pressable
                    key={w}
                    onPress={() => { setViewWeek(w); setWeekMenuOpen(false); }}
                    className={`flex-row items-center justify-between px-3 py-2.5 ${w === viewWeek ? 'bg-indigo-500/20' : ''}`}
                  >
                    <Text className={w === viewWeek ? 'text-indigo-300' : 'text-gray-300'}>{weekTitle(w)}</Text>
                    {w === league.currentWeek && phase !== 'complete' && (
                      <View className="border rounded px-1 py-0.5" style={{ borderColor: 'rgba(217,160,44,0.3)' }}>
                        <Text className="text-[10px] text-indigo-400">Current</Text>
                      </View>
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </Pressable>
        </Modal>
      </>
    );
  }

  if (isLoading) {
    return <View className="gap-4"><WeekNav /><View className="py-12 items-center"><Spinner size="large" /></View></View>;
  }

  if (!matchup) {
    return (
      <View className="gap-4">
        <WeekNav />
        <Text className="text-center py-12 text-gray-400">
          {viewWeek > REGULAR_SEASON_WEEKS ? `You don't have a Week ${viewWeek} playoff game.` : isFutureWeek ? `Week ${viewWeek} matchup hasn't been played yet.` : 'No matchup found for this week.'}
        </Text>
        <LeagueMatchupsCard leagueId={leagueId} week={viewWeek} upcoming={isFutureWeek} />
      </View>
    );
  }

  const isHome = matchup.homeTeam?.userId === user?.id;
  const myTeamData = isHome ? matchup.homeTeam : matchup.awayTeam;
  const oppTeamData = isHome ? matchup.awayTeam : matchup.homeTeam;
  const myScore = isHome ? matchup.homeScore : matchup.awayScore;
  const oppScore = isHome ? matchup.awayScore : matchup.homeScore;
  const myTeamId = isHome ? matchup.homeTeamId : matchup.awayTeamId;
  const iWon = matchup.isFinalized && matchup.winnerId === myTeamId;
  const iLost = matchup.isFinalized && matchup.winnerId != null && matchup.winnerId !== myTeamId;

  const prevIsHome = prevMatchup?.homeTeam?.userId === user?.id;
  const prevMyTeamId = prevIsHome ? prevMatchup?.homeTeamId : prevMatchup?.awayTeamId;
  const wonPrev = prevMatchup?.winnerId === prevMyTeamId;
  const prevMyScore = prevIsHome ? (prevMatchup?.homeScore ?? 0) : (prevMatchup?.awayScore ?? 0);
  const prevOppScore = prevIsHome ? (prevMatchup?.awayScore ?? 0) : (prevMatchup?.homeScore ?? 0);
  const prevMyTeamName = (prevIsHome ? prevMatchup?.homeTeam?.name : prevMatchup?.awayTeam?.name) ?? 'Your Team';
  const prevMyTeamData = prevIsHome ? prevMatchup?.homeTeam : prevMatchup?.awayTeam;
  const prevFellOff = (prevMyTeamData?.rosterSpots ?? [])
    .filter((spot) => spot.artist && !spot.slot.startsWith('Bench'))
    .flatMap((spot) => {
      const ws = spot.artist!.weeklyScores?.[0];
      if (!ws) return [];
      let points = 0;
      if (ws.songRank === null && ws.songMovementPoints < 0) points += ws.songMovementPoints;
      if (ws.albumRank === null && ws.albumMovementPoints < 0) points += ws.albumMovementPoints;
      return points < 0 ? [{ id: spot.artist!.id, name: spot.artist!.name, points }] : [];
    });
  const prevOppTeamName = (prevIsHome ? prevMatchup?.awayTeam?.name : prevMatchup?.homeTeam?.name) ?? 'Opponent';

  function dismissPopup() {
    if (prevMatchup) AsyncStorage.setItem(`bw_result_${leagueId}_w${prevMatchup.week}`, 'seen');
    setShowResultPopup(false);
  }

  if (isPastWeek) {
    return (
      <View className="gap-4">
        <WeekNav />
        <MatchupHeader my={myTeamData} opp={oppTeamData} myScore={myScore} oppScore={oppScore} showScores footerRight="Final">
          <Text className="text-xs text-gray-400">Week {viewWeek} · Final</Text>
          <PlayoffTag matchupType={matchup.matchupType} />
          {iWon && <View className="bg-green-400/10 rounded px-2 py-0.5"><Text className="text-xs font-semibold text-green-400">Win</Text></View>}
          {iLost && <View className="bg-red-400/10 rounded px-2 py-0.5"><Text className="text-xs font-semibold text-red-400">Loss</Text></View>}
        </MatchupHeader>
        <H2HRoster leftTitle={myTeamData?.name ?? 'Your Team'} rightTitle={oppTeamData?.name ?? 'Opponent'} leftRoster={myTeamData?.rosterSpots ?? []} rightRoster={oppTeamData?.rosterSpots ?? []} leagueId={leagueId} />
        <LeagueMatchupsCard leagueId={leagueId} week={viewWeek} myTeamId={myTeamId} />
      </View>
    );
  }

  if (isFutureWeek) {
    return (
      <View className="gap-4">
        <WeekNav />
        <MatchupHeader my={myTeamData} opp={oppTeamData} myScore={0} oppScore={0} showScores={false}>
          <Text className="text-xs text-gray-400">Week {viewWeek} · Upcoming</Text>
          <PlayoffTag matchupType={matchup.matchupType} />
        </MatchupHeader>
        <LeagueMatchupsCard leagueId={leagueId} week={viewWeek} myTeamId={myTeamId} upcoming />
      </View>
    );
  }

  if (phase === 'adjustment') {
    return (
      <View className="gap-4">
        <Modal transparent animationType="fade" visible={showResultPopup && !!prevMatchup} onRequestClose={dismissPopup}>
          <View className="flex-1 items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
            <View className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-sm p-6 items-center">
              <Text className="text-5xl mb-3">{wonPrev ? '🏆' : '😤'}</Text>
              <Text className={`text-2xl font-bold mb-1 ${wonPrev ? 'text-green-400' : 'text-red-400'}`}>{wonPrev ? 'You Won!' : 'You Lost'}</Text>
              <Text className="text-gray-500 text-sm mb-5">Week {prevMatchup?.week} final result</Text>
              <View className="flex-row items-center justify-center gap-8 mb-6">
                <View className="items-center">
                  <Text className="text-xs text-gray-500 mb-1">{prevMyTeamName}</Text>
                  <Text className={`text-2xl font-bold ${wonPrev ? 'text-green-400' : 'text-white'}`}>{prevMyScore.toFixed(1)}</Text>
                </View>
                <Text className="text-gray-600 text-sm">vs</Text>
                <View className="items-center">
                  <Text className="text-xs text-gray-500 mb-1">{prevOppTeamName}</Text>
                  <Text className={`text-2xl font-bold ${!wonPrev ? 'text-green-400' : 'text-white'}`}>{prevOppScore.toFixed(1)}</Text>
                </View>
              </View>
              {prevFellOff.length > 0 && (
                <View className="mb-5 w-full bg-red-500/10 border border-red-500/20 rounded-lg p-3 gap-1.5">
                  <Text className="text-xs font-semibold text-red-400 uppercase tracking-wider">Fell off the charts</Text>
                  {prevFellOff.map((a) => (
                    <View key={a.id} className="flex-row justify-between">
                      <Text className="text-sm text-gray-300">{a.name}</Text>
                      <Text className="text-sm text-red-400 font-semibold">{a.points.toFixed(1)}</Text>
                    </View>
                  ))}
                </View>
              )}
              <Pressable onPress={dismissPopup} className="w-full bg-indigo-500 rounded-lg py-2.5 items-center">
                <Text className="text-gray-950 font-medium">Set Lineup for Week {league.currentWeek}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <WeekNav />

        <View className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 flex-row items-center gap-2">
          <ArrowUpDown color="#8FBFAD" size={16} />
          <Text className="text-sm text-green-400">Lineup open · adjust on My Team before Tuesday</Text>
        </View>

        <MatchupHeader
          my={myTeamData}
          opp={oppTeamData}
          myScore={referenceWeek ? startersTotal(myTeamData?.rosterSpots) : 0}
          oppScore={referenceWeek ? startersTotal(oppTeamData?.rosterSpots) : 0}
          showScores={!!referenceWeek}
          dim
        >
          <Text className="text-xs text-gray-400">Week {league.currentWeek} · starts Tuesday</Text>
          <PlayoffTag matchupType={matchup.matchupType} />
        </MatchupHeader>

        <H2HRoster
          leftTitle={myTeamData?.name ?? 'Your Team'}
          rightTitle={oppTeamData?.name ?? 'Opponent'}
          leftRoster={myTeamData?.rosterSpots ?? []}
          rightRoster={oppTeamData?.rosterSpots ?? []}
          leagueId={leagueId}
          dimScores
        />
        {!!referenceWeek && <Text className="text-xs text-center text-gray-600">Scores shown are from Week {referenceWeek} · this week's lineup</Text>}
        <LeagueMatchupsCard leagueId={leagueId} week={league.currentWeek} myTeamId={myTeamId} referenceWeek={referenceWeek} />
      </View>
    );
  }

  return (
    <View className="gap-4">
      <WeekNav />
      <MatchupHeader my={myTeamData} opp={oppTeamData} myScore={myScore} oppScore={oppScore} showScores>
        <Text className="text-xs text-gray-400">Week {league.currentWeek}</Text>
        <PlayoffTag matchupType={matchup.matchupType} />
        <View className="flex-row items-center gap-1">
          <Lock color="#E07A3E" size={12} />
          <Text className="text-xs text-amber-500">Lineup locked · updates daily</Text>
        </View>
      </MatchupHeader>
      <H2HRoster leftTitle={myTeamData?.name ?? 'Your Team'} rightTitle={oppTeamData?.name ?? 'Opponent'} leftRoster={myTeamData?.rosterSpots ?? []} rightRoster={oppTeamData?.rosterSpots ?? []} leagueId={leagueId} />
      <LeagueMatchupsCard leagueId={leagueId} week={league.currentWeek} myTeamId={myTeamId} />
    </View>
  );
}
