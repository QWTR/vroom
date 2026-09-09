import React, { memo } from 'react';
import Svg, { Path, Circle, G, Text as SvgText } from 'react-native-svg';

/** Direction comes from the resolved cue, including the side of forks and ramps. */
export const ManeuverGraphic = memo(function ManeuverGraphic({ maneuver = 'straight', modifier = '', color = '#FFFFFF', size = 48, exit }: {
  maneuver?: string; modifier?: string; color?: string; size?: number; exit?: number;
}) {
  const kind = `${maneuver} ${modifier}`.toLowerCase();
  const left = kind.includes('left');
  const roundabout = kind.includes('roundabout') || kind.includes('rotary');
  const uturn = kind.includes('uturn') || kind.includes('u-turn');
  const fork = kind.includes('fork') || kind.includes('ramp');
  const slight = kind.includes('slight') || fork;
  const sharp = kind.includes('sharp');
  const turn = left || kind.includes('right');
  const merge = kind.includes('merge');
  const arrive = kind.includes('arriv') || kind.includes('destination');
  let path = 'M32 54V10 M20 22L32 10L44 22';
  if (uturn) path = 'M46 54V24C46 6 18 6 18 24V40 M8 30L18 40L28 30';
  else if (sharp) path = 'M20 54V22Q20 12 28 20L48 40 M34 40H48V26';
  else if (slight && turn) path = 'M22 54V39Q22 33 27 28L47 8 M30 8H47V25';
  else if (merge) path = 'M32 54V10 M20 22L32 10L44 22 M52 48L32 30';
  else if (turn) path = 'M22 54V31Q22 20 33 20H52 M40 8L52 20L40 32';
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessible={false}>
      <G fill="none" stroke={color} strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round">
        {arrive ? <><Path d="M18 55V10M18 12H47V33H18" /><Path d="M20 14H31V22H44V30H33V22H20Z" fill={color} strokeWidth={0} /></>
          : roundabout ? <G transform={left ? 'translate(64 0) scale(-1 1)' : undefined}><Circle cx={32} cy={29} r={15} opacity={0.3} /><Path d="M32 55V44C52 44 52 14 32 14C22 14 17 20 17 29 M9 22L17 31L26 23" /></G>
          : <G transform={(uturn ? !left : left) ? 'translate(64 0) scale(-1 1)' : undefined}>
            {fork && <Path d="M22 40V10" opacity={0.25} />}
            <Path d={path} />
          </G>}
      </G>
      {roundabout && exit != null && exit > 0 ? <SvgText x={32} y={34} textAnchor="middle" fill={color} fontSize={15} fontWeight="bold">{exit}</SvgText> : null}
    </Svg>
  );
});
