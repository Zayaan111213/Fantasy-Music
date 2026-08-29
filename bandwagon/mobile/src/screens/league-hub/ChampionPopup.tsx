import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, Modal, Animated, Easing, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import Svg, { Defs, RadialGradient, LinearGradient, Stop, Polygon, Circle, Rect } from 'react-native-svg';
import { Trophy } from 'lucide-react-native';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import type { Bracket, League, StandingsEntry } from '@bandwagon/shared';

// Shown once, to the one person who actually won it. The season-complete banner
// still names the champion to everybody; this is the moment for the team that
// lifted the trophy, so it is deliberately gated on the viewer being the winner
// rather than on the league merely being over.
const CONFETTI_COLORS = ['#E8B23A', '#EFA36B', '#C24A2E', '#8FBFAD', '#F2E4CE'];
const CONFETTI_COUNT = 26;
const RAYS = 24;

type Piece = {
  key: number;
  left: number;
  size: number;
  color: string;
  delay: number;
  duration: number;
  drift: number;
  spin: number;
};

function Confetti({ width, height }: { width: number; height: number }) {
  // Seeded once per mount rather than per render, so a re-render (the query
  // settling, say) doesn't teleport every piece to a new column mid-fall.
  const pieces = useMemo<Piece[]>(
    () =>
      Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
        key: i,
        left: Math.random() * width,
        size: 6 + Math.random() * 8,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        delay: Math.random() * 1400,
        duration: 2600 + Math.random() * 2200,
        drift: (Math.random() - 0.5) * 90,
        spin: 360 + Math.random() * 720,
      })),
    [width],
  );

  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}>
      {pieces.map((p) => (
        <ConfettiPiece key={p.key} piece={p} height={height} />
      ))}
    </View>
  );
}

function ConfettiPiece({ piece, height }: { piece: Piece; height: number }) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // One fall, not a loop. Confetti that never stops turns a moment into
    // wallpaper, and it would keep animating behind everything for as long as
    // the popup is open.
    const anim = Animated.sequence([
      Animated.delay(piece.delay),
      Animated.timing(t, {
        toValue: 1,
        duration: piece.duration,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [piece.delay, piece.duration, t]);

  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [-40, height + 40] });
  const translateX = t.interpolate({ inputRange: [0, 1], outputRange: [0, piece.drift] });
  const rotate = t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${piece.spin}deg`] });
  // Fade only at the very end, so the pieces read as solid for most of the fall.
  const opacity = t.interpolate({ inputRange: [0, 0.08, 0.85, 1], outputRange: [0, 1, 1, 0] });

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: piece.left,
        top: 0,
        width: piece.size,
        height: piece.size * 1.6,
        borderRadius: 1.5,
        backgroundColor: piece.color,
        opacity,
        transform: [{ translateY }, { translateX }, { rotate }],
      }}
    />
  );
}

// A sunburst behind the trophy. Drawn once as static SVG and rotated as a whole,
// which is one native-driven transform rather than 24 animated polygons.
function Sunburst({ size }: { size: number }) {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 26_000, easing: Easing.linear, useNativeDriver: true }),
    );
    anim.start();
    return () => anim.stop();
  }, [spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const c = size / 2;

  return (
    <Animated.View
      pointerEvents="none"
      style={{ position: 'absolute', width: size, height: size, transform: [{ rotate }] }}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Defs>
          <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#E8B23A" stopOpacity={0.30} />
            <Stop offset="55%" stopColor="#E8B23A" stopOpacity={0.07} />
            <Stop offset="100%" stopColor="#E8B23A" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={c} cy={c} r={c} fill="url(#glow)" />
        {Array.from({ length: RAYS }, (_, i) => {
          const a = (i * 360) / RAYS;
          const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
          const spread = 3.4;
          const p = (deg: number, r: number) => `${c + r * Math.cos(rad(deg))},${c + r * Math.sin(rad(deg))}`;
          return (
            <Polygon
              key={i}
              points={`${p(a - spread, c)} ${p(a + spread, c)} ${c},${c}`}
              fill="#E8B23A"
              opacity={i % 2 === 0 ? 0.13 : 0.055}
            />
          );
        })}
      </Svg>
    </Animated.View>
  );
}

export function ChampionPopup({ leagueId, league }: { leagueId: string; league: League }) {
  const { user } = useAuth();
  const { width, height } = useWindowDimensions();
  const [visible, setVisible] = useState(false);
  const pop = useRef(new Animated.Value(0)).current;

  // Both of these are already in the cache from the Standings tab and the
  // season-complete banner, so sharing their keys costs no extra request.
  const { data: bracket } = useQuery({
    queryKey: ['bracket', leagueId],
    queryFn: () => api.get<Bracket | null>(`/leagues/${leagueId}/bracket`),
  });
  const { data: standings } = useQuery({
    queryKey: ['standings', leagueId],
    queryFn: () => api.get<StandingsEntry[]>(`/leagues/${leagueId}/standings`),
  });

  const me = standings?.find((s) => s.userId === user?.id);
  const final = bracket?.matchups.find((m) => m.matchupType === 'championship' && m.winnerId);
  const iWon = !!(final && me && final.winnerId === me.teamId);

  const storageKey = `bw_champion_${leagueId}_${league.seasonYear}`;

  useEffect(() => {
    if (!iWon) return;
    AsyncStorage.getItem(storageKey).then((seen) => {
      if (!seen) setVisible(true);
    });
  }, [iWon, storageKey]);

  useEffect(() => {
    if (!visible) return;
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 6, tension: 70, useNativeDriver: true }).start();
  }, [visible, pop]);

  if (!iWon || !final || !me) return null;

  const iWasHome = final.homeTeamId === me.teamId;
  const myScore = iWasHome ? final.homeScore : final.awayScore;
  const theirScore = iWasHome ? final.awayScore : final.homeScore;
  const runnerUp = iWasHome ? final.awayTeam.name : final.homeTeam.name;
  const mySeed = iWasHome ? final.homeSeed : final.awaySeed;

  function dismiss() {
    AsyncStorage.setItem(storageKey, 'seen');
    setVisible(false);
  }

  const burst = Math.min(width * 0.86, 360);

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={dismiss} statusBarTranslucent>
      <View className="flex-1 items-center justify-center px-5" style={{ backgroundColor: '#0A0603' }}>
        <Animated.View
          style={{
            width: '100%',
            maxWidth: 380,
            alignItems: 'center',
            opacity: pop,
            transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
          }}
        >
          <View className="items-center justify-center" style={{ height: burst * 0.78, width: '100%' }}>
            <Sunburst size={burst} />
            <View
              className="items-center justify-center rounded-full"
              style={{
                width: 116,
                height: 116,
                backgroundColor: 'rgba(232,178,58,0.12)',
                borderWidth: 2,
                borderColor: 'rgba(232,178,58,0.55)',
              }}
            >
              <Trophy color="#E8B23A" size={58} strokeWidth={1.6} />
            </View>
          </View>

          <Text
            className="font-serif text-[13px] text-center"
            style={{ color: '#E8B23A', letterSpacing: 6, marginTop: 4 }}
          >
            CHAMPION
          </Text>

          <Text className="font-serif text-white text-center mt-3" style={{ fontSize: 34, lineHeight: 40 }}>
            {me.teamName}
          </Text>

          <Text className="text-center mt-2 text-sm" style={{ color: '#A88F70' }}>
            {league.seasonYear} {league.name}
          </Text>

          {/* The line that makes it feel earned: who you beat, and by how much. */}
          <View
            className="w-full mt-6 rounded-2xl px-5 py-4"
            style={{ backgroundColor: 'rgba(232,178,58,0.07)', borderWidth: 1, borderColor: 'rgba(232,178,58,0.25)' }}
          >
            <Text className="text-center text-[11px] uppercase" style={{ color: '#A88F70', letterSpacing: 1.6 }}>
              Championship · Week {final.week}
            </Text>
            <View className="flex-row items-end justify-center gap-5 mt-3">
              <View className="items-center flex-1">
                <Text className="text-xs mb-1" style={{ color: '#F2E4CE' }} numberOfLines={1}>
                  {me.teamName}
                </Text>
                <Text className="font-serif" style={{ color: '#E8B23A', fontSize: 30 }}>
                  {myScore.toFixed(1)}
                </Text>
              </View>
              <Text className="text-xs mb-2" style={{ color: '#6B564180' }}>
                def.
              </Text>
              <View className="items-center flex-1">
                <Text className="text-xs mb-1" style={{ color: '#A88F70' }} numberOfLines={1}>
                  {runnerUp}
                </Text>
                <Text className="font-serif" style={{ color: '#8B7355', fontSize: 30 }}>
                  {theirScore.toFixed(1)}
                </Text>
              </View>
            </View>
          </View>

          <Text className="text-center text-xs mt-4" style={{ color: '#7C6650' }}>
            {mySeed ? `${ordinal(mySeed)} seed` : 'Playoff run'} · {me.wins}-{me.losses} regular season
          </Text>

          <Pressable
            onPress={dismiss}
            className="w-full rounded-xl py-3.5 items-center mt-6"
            style={{ backgroundColor: '#E8B23A' }}
          >
            <Text className="font-semibold text-base" style={{ color: '#1A1108' }}>
              Lift the trophy
            </Text>
          </Pressable>
        </Animated.View>

        <Confetti width={width} height={height} />
      </View>
    </Modal>
  );
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
