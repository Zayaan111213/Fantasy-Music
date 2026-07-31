import Svg, { Rect, Line, Circle } from 'react-native-svg';
import { Text } from 'react-native';

export function WagonMark({ size = 32 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120">
      <Rect x={30} y={45} width={60} height={26} rx={7} fill="#E8B23A" />
      <Rect x={30} y={45} width={60} height={7} rx={3.5} fill="#F0C766" />
      <Line x1={30} y1={58} x2={16} y2={51} stroke="#E8B23A" strokeWidth={6} strokeLinecap="round" />
      <Circle cx={42} cy={86} r={13} fill="#12100b" />
      <Circle cx={42} cy={86} r={4.5} fill="#E07A3E" />
      <Circle cx={82} cy={86} r={13} fill="#12100b" />
      <Circle cx={82} cy={86} r={4.5} fill="#E07A3E" />
    </Svg>
  );
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <Text className={`font-bold text-white ${className}`}>
      band<Text className="text-amber-400">wagoner</Text>
    </Text>
  );
}
