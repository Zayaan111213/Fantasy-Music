import { View, Text } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

const R = 36;
const CIRC = 2 * Math.PI * R;

export function TimerRing({ seconds, total = 60 }: { seconds: number; total?: number }) {
  const pct = seconds / total;
  const dash = pct * CIRC;
  const color = seconds > 20 ? '#E8B23A' : seconds > 10 ? '#E07A3E' : '#C24A2E';

  return (
    <View className="w-24 h-24 items-center justify-center self-center">
      <Svg width={88} height={88} viewBox="0 0 88 88" style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={44} cy={44} r={R} fill="none" stroke="#3A2A1C" strokeWidth={6} />
        <Circle
          cx={44} cy={44} r={R} fill="none"
          stroke={color} strokeWidth={6}
          strokeDasharray={`${dash} ${CIRC}`}
          strokeLinecap="round"
        />
      </Svg>
      <Text className="text-2xl font-bold text-white">{seconds}</Text>
    </View>
  );
}

export function CountdownRing({ seconds, total = 900 }: { seconds: number; total?: number }) {
  const pct = Math.max(0, seconds / total);
  const dash = pct * CIRC;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;

  return (
    <View className="w-24 h-24 items-center justify-center self-center">
      <Svg width={88} height={88} viewBox="0 0 88 88" style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={44} cy={44} r={R} fill="none" stroke="#3A2A1C" strokeWidth={6} />
        <Circle
          cx={44} cy={44} r={R} fill="none"
          stroke="#E8B23A" strokeWidth={6}
          strokeDasharray={`${dash} ${CIRC}`}
          strokeLinecap="round"
        />
      </Svg>
      <Text className="text-sm font-bold text-white font-mono">{m}:{String(s).padStart(2, '0')}</Text>
    </View>
  );
}
