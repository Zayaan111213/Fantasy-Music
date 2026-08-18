import { View, Text } from 'react-native';
import type { ReactNode } from 'react';
import type { RosterSpot, Team } from '@bandwagon/shared';
import { Card } from './ui/Card';
import { Avatar } from './ui/Avatar';

export function MatchupHeader({ my, opp, myScore, oppScore, showScores, dim = false, footerRight, children }: {
  my?: (Team & { rosterSpots?: RosterSpot[] }) | null;
  opp?: (Team & { rosterSpots?: RosterSpot[] }) | null;
  myScore: number;
  oppScore: number;
  showScores: boolean;
  dim?: boolean;
  footerRight?: string;
  children: ReactNode;
}) {
  const total = myScore + oppScore;
  const iLead = myScore > oppScore;
  const oppLead = oppScore > myScore;
  const myPct = total > 0 ? (myScore / total) * 100 : 50;
  const scoreColor = (lead: boolean) => (dim || !showScores ? '#7C6650' : lead ? '#F0C766' : 'rgba(255,255,255,0.75)');
  const myName = my?.name ?? 'Your Team';
  const oppName = opp?.name ?? 'Opponent';

  return (
    <Card className="p-5">
      <View className="flex-row items-center justify-center gap-2 mb-4 flex-wrap">{children}</View>
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-row items-center gap-3 flex-1 min-w-0">
          <Avatar src={my?.logoUrl} name={myName} size="md" />
          <View className="min-w-0">
            <Text className="text-sm font-semibold text-white" numberOfLines={1}>{myName}</Text>
            <Text className="font-serif text-3xl font-bold" style={{ color: scoreColor(iLead) }}>{showScores ? myScore.toFixed(1) : '–'}</Text>
          </View>
        </View>
        <Text className="text-xs font-bold text-gray-500">VS</Text>
        <View className="flex-row items-center gap-3 flex-1 min-w-0 justify-end">
          <View className="min-w-0 items-end">
            <Text className="text-sm font-semibold text-white" numberOfLines={1}>{oppName}</Text>
            <Text className="font-serif text-3xl font-bold" style={{ color: scoreColor(oppLead) }}>{showScores ? oppScore.toFixed(1) : '–'}</Text>
          </View>
          <Avatar src={opp?.logoUrl} name={oppName} size="md" />
        </View>
      </View>
      {showScores && !dim && total > 0 && (
        <>
          <View className="mt-4 h-[7px] rounded-md bg-gray-900 overflow-hidden flex-row">
            <View style={{ width: `${myPct}%` }} className="h-full bg-indigo-400" />
            <View style={{ width: `${100 - myPct}%`, backgroundColor: 'rgba(124,102,80,0.6)' }} className="h-full" />
          </View>
          <View className="flex-row justify-between mt-1.5">
            <Text className="text-[11px] text-gray-400">
              {iLead
                ? `${myName} leads by ${(myScore - oppScore).toFixed(1)}`
                : oppLead
                  ? `${oppName} leads by ${(oppScore - myScore).toFixed(1)}`
                  : 'All tied up'}
            </Text>
            <Text className="text-[11px] text-gray-400">{footerRight ?? (iLead ? 'Winning' : oppLead ? 'Losing' : 'Tied')}</Text>
          </View>
        </>
      )}
    </Card>
  );
}
