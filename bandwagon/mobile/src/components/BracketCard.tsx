import { View, Text } from 'react-native';
import { Trophy } from 'lucide-react-native';
import type { Bracket, BracketMatchup } from '@bandwagon/shared';
import { Card } from './ui/Card';

const PLAYOFF_FINAL_WEEK = 12;

const PLAYOFF_TAGS: Record<string, { label: string; color: string }> = {
  semifinal: { label: 'Semifinal', color: '#8E6FA8' },
  championship: { label: '🏆 Championship', color: '#EFA36B' },
  third_place: { label: '🥉 3rd Place Game', color: '#E07A3E' },
  consolation_semifinal: { label: 'Consolation', color: '#7FA0BF' },
  fifth_place: { label: '5th Place Game', color: '#7FA0BF' },
  seventh_place: { label: '7th Place Game', color: '#7FA0BF' },
};

export function PlayoffTag({ matchupType }: { matchupType?: string }) {
  const tag = matchupType ? PLAYOFF_TAGS[matchupType] : undefined;
  if (!tag) return null;
  return (
    <View className="border rounded px-2 py-0.5" style={{ borderColor: `${tag.color}55` }}>
      <Text className="text-xs font-semibold" style={{ color: tag.color }}>{tag.label}</Text>
    </View>
  );
}

// Simplified from the web version's connector-line bracket layout (fiddly
// CSS border tricks with little payoff on a narrow phone screen) — same
// functional info (seeds, scores, winner highlight, TBD placeholders) as a
// plain stacked list of rounds instead.
function BracketGame({ m }: { m: BracketMatchup }) {
  const tag = m.week === PLAYOFF_FINAL_WEEK || m.matchupType === 'fifth_place' ? PLAYOFF_TAGS[m.matchupType] : undefined;
  const row = (team: BracketMatchup['homeTeam'], seed: number | null, score: number) => {
    const isWinner = m.isFinalized && m.winnerId === team.id;
    return (
      <View className="flex-row items-center gap-1.5 py-0.5">
        <View className="w-5 h-4 items-center justify-center rounded bg-white/10">
          <Text className="text-[10px] font-mono text-gray-400">{seed ?? '-'}</Text>
        </View>
        <Text className={`flex-1 text-sm ${isWinner ? 'text-green-400 font-semibold' : 'text-white'}`} numberOfLines={1}>{team.name}</Text>
        <Text className="text-[10px] font-mono text-gray-500">{team.wins}-{team.losses}</Text>
        <Text className={`ml-auto font-mono text-xs ${isWinner ? 'text-green-400' : 'text-gray-400'}`}>{score.toFixed(1)}</Text>
      </View>
    );
  };
  return (
    <View className="bg-white/5 border border-white/10 rounded-lg px-3 py-2">
      {tag && (
        <View className="self-start border rounded px-1.5 py-0.5 mb-1" style={{ borderColor: `${tag.color}55` }}>
          <Text className="text-[10px] font-semibold" style={{ color: tag.color }}>{tag.label}</Text>
        </View>
      )}
      {row(m.homeTeam, m.homeSeed, m.homeScore)}
      {row(m.awayTeam, m.awaySeed, m.awayScore)}
    </View>
  );
}

function BracketTbd({ matchupType, label }: { matchupType: string; label: string }) {
  const tag = PLAYOFF_TAGS[matchupType];
  return (
    <View className="bg-white/5 rounded-lg px-3 py-2 border border-dashed border-white/15">
      {tag && (
        <View className="self-start border rounded px-1.5 py-0.5 mb-1" style={{ borderColor: `${tag.color}55` }}>
          <Text className="text-[10px] font-semibold" style={{ color: tag.color }}>{tag.label}</Text>
        </View>
      )}
      <Text className="text-xs text-gray-500 italic py-1">{label}</Text>
    </View>
  );
}

function RoundLabel({ children }: { children: string }) {
  return <Text className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1.5 mt-3">{children}</Text>;
}

export function BracketCard({ bracket }: { bracket: Bracket }) {
  const ms = bracket.matchups;
  const bySeed = (a: BracketMatchup, b: BracketMatchup) => (a.homeSeed ?? 99) - (b.homeSeed ?? 99);
  const semis = ms.filter((m) => m.matchupType === 'semifinal').sort(bySeed);
  const consSemis = ms.filter((m) => m.matchupType === 'consolation_semifinal').sort(bySeed);
  const championship = ms.find((m) => m.matchupType === 'championship');
  const third = ms.find((m) => m.matchupType === 'third_place');
  const fifth = ms.find((m) => m.matchupType === 'fifth_place');
  const seventh = ms.find((m) => m.matchupType === 'seventh_place');
  const fifthInRound1 = fifth && fifth.week !== PLAYOFF_FINAL_WEEK ? fifth : undefined;
  const fifthInFinals = fifth && fifth.week === PLAYOFF_FINAL_WEEK ? fifth : undefined;
  const hasConsolation = consSemis.length > 0 || fifthInRound1 != null;

  return (
    <Card className="p-4">
      <View className="flex-row items-center gap-2 mb-1">
        <Trophy color="#EFA36B" size={16} />
        <Text className="text-sm font-semibold text-white">Playoff Bracket</Text>
        {bracket.projected && (
          <View className="bg-white/10 border border-white/10 rounded px-1.5 py-0.5">
            <Text className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Projected</Text>
          </View>
        )}
      </View>
      {bracket.projected && <Text className="text-xs text-gray-500 mb-1">If the season ended today</Text>}

      <RoundLabel>Semifinals · Week 11</RoundLabel>
      <View className="gap-2">{semis.map((m) => <BracketGame key={m.id} m={m} />)}</View>

      <RoundLabel>Championship Week · Week 12</RoundLabel>
      <View className="gap-2">
        {championship ? <BracketGame m={championship} /> : <BracketTbd matchupType="championship" label="Semifinal winners" />}
        {third ? <BracketGame m={third} /> : <BracketTbd matchupType="third_place" label="Semifinal losers" />}
      </View>

      {hasConsolation && (
        <View className="mt-4 pt-3 border-t border-white/10">
          <Text className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-2">Consolation Bracket</Text>
          {fifthInRound1 ? (
            <BracketGame m={fifthInRound1} />
          ) : (
            <View className="gap-2">
              {consSemis.map((m) => <BracketGame key={m.id} m={m} />)}
              {fifthInFinals ? (
                <BracketGame m={fifthInFinals} />
              ) : (
                <BracketTbd matchupType="fifth_place" label={consSemis.length === 2 ? 'Consolation winners' : 'Seed 5 vs consolation winner'} />
              )}
              {consSemis.length === 2 && (
                seventh ? <BracketGame m={seventh} /> : <BracketTbd matchupType="seventh_place" label="Consolation losers" />
              )}
            </View>
          )}
        </View>
      )}
    </Card>
  );
}
