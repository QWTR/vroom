import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Polyline, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

interface Point { latitude: number; longitude: number; }

interface Props {
  points:  Point[];
  width?:  number;
  height?: number;
  color?:  string;
}

export function RouteMiniMap({ points, width = 120, height = 60, color = '#e33835' }: Props) {
  const svgPoints = useMemo(() => {
    if (points.length < 2) return null;

    const lats = points.map(p => p.latitude);
    const lngs = points.map(p => p.longitude);

    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const pad    = 8;
    const dLat   = maxLat - minLat || 0.0001;
    const dLng   = maxLng - minLng || 0.0001;

    // Zachowaj proporcje
    const scaleX = (width  - pad * 2) / dLng;
    const scaleY = (height - pad * 2) / dLat;
    const scale  = Math.min(scaleX, scaleY);

    // Wycentruj
    const offX = (width  - dLng * scale) / 2;
    const offY = (height - dLat * scale) / 2;

    const mapped = points.map(p => ({
      x: offX + (p.longitude - minLng) * scale,
      // SVG Y jest odwrócony względem lat
      y: height - (offY + (p.latitude - minLat) * scale),
    }));

    // Uprość — max 80 punktów żeby SVG był lekki
    const step    = Math.max(1, Math.floor(mapped.length / 80));
    const sampled = mapped.filter((_, i) => i % step === 0 || i === mapped.length - 1);

    return {
      polyline: sampled.map(p => `${p.x},${p.y}`).join(' '),
      start:    sampled[0],
      end:      sampled[sampled.length - 1],
    };
  }, [points, width, height]);

  if (!svgPoints) return null;

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id="routeGrad" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0"   stopColor="#4de926" stopOpacity="1" />
          <Stop offset="1"   stopColor={color}   stopOpacity="1" />
        </LinearGradient>
      </Defs>

      {/* Cień linii */}
      <Polyline
        points={svgPoints.polyline}
        fill="none"
        stroke="#00000060"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Główna linia */}
      <Polyline
        points={svgPoints.polyline}
        fill="none"
        stroke="url(#routeGrad)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Pin START — zielony */}
      <Circle cx={svgPoints.start.x} cy={svgPoints.start.y} r="5"   fill="#4de926" />
      <Circle cx={svgPoints.start.x} cy={svgPoints.start.y} r="3"   fill="#000" />

      {/* Pin KONIEC — czerwony */}
      <Circle cx={svgPoints.end.x}   cy={svgPoints.end.y}   r="5"   fill={color} />
      <Circle cx={svgPoints.end.x}   cy={svgPoints.end.y}   r="3"   fill="#000" />
    </Svg>
  );
}