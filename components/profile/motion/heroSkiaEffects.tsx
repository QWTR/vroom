/**
 * VROOM Premium Animations — Skia + Reanimated v3
 * All effects run 100% on the UI thread — zero JS drops.
 */
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Blur,
  Canvas,
  Circle,
  Group,
  LinearGradient,
  Paint,
  Path,
  RadialGradient,
  Rect,
  Skia,
  SweepGradient,
  vec,
} from '@shopify/react-native-skia';
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

// ─── Palette ────────────────────────────────────────────────────────────────
const C = {
  red:    '#e33835',
  gold:   '#FFD700',
  cyan:   '#38bdf8',
  purple: '#a855f7',
  pink:   '#ff0044',
  green:  '#4ade80',
  orange: '#ff8c42',
  white:  '#ffffff',
};

type SizeProps  = { width: number; height: number };
type VisitProps = SizeProps & { onDone: () => void };

// ─── Utility ─────────────────────────────────────────────────────────────────
function GlowLayer({ blur, children }: { blur: number; children: React.ReactNode }) {
  return (
    <Group layer={<Paint><Blur blur={blur} mode="clamp" /></Paint>}>
      {children}
    </Group>
  );
}

function useVisitDone(ms: number, fn: () => void) {
  useEffect(() => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  }, [ms, fn]);
}

// ═══════════════════════════════════════════════════════════════════
// HERO BACKGROUND EFFECTS (looping ambient)
// ═══════════════════════════════════════════════════════════════════

// ── 1. AURORA ─────────────────────────────────────────────────────
// Three thick neon bands float across the banner at different speeds.
// High opacity, heavy blur = that Discord Nitro ethereal glow.
export function AuroraSkiaEffect({ width, height }: SizeProps) {
  const a = useSharedValue(0); // band 1 phase
  const b = useSharedValue(0); // band 2 phase
  const c = useSharedValue(0); // band 3 phase
  const glow = useSharedValue(0); // central radial pulse

  useEffect(() => {
    a.value = withRepeat(withTiming(1, { duration: 7000, easing: Easing.inOut(Easing.sin) }), -1, true);
    b.value = withRepeat(withTiming(1, { duration: 5400, easing: Easing.inOut(Easing.quad) }), -1, true);
    c.value = withRepeat(withTiming(1, { duration: 9200, easing: Easing.inOut(Easing.cubic) }), -1, true);
    glow.value = withRepeat(withTiming(1, { duration: 3000, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [a, b, c, glow]);

  // band positions sweep across full width
  const x1 = useDerivedValue(() => -width * 0.3 + a.value * (width * 1.4));
  const x2 = useDerivedValue(() => -width * 0.2 + (1 - b.value) * (width * 1.2));
  const x3 = useDerivedValue(() => -width * 0.15 + c.value * (width * 1.1));
  const glowR = useDerivedValue(() => width * (0.45 + glow.value * 0.18));
  const glowOp = useDerivedValue(() => 0.32 + glow.value * 0.28);
  const cx = width * 0.5;
  const cy = height * 0.48;

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Radial core glow */}
      <GlowLayer blur={55}>
        <Circle cx={cx} cy={cy} r={glowR} opacity={glowOp}>
          <RadialGradient
            c={vec(cx, cy)}
            r={width * 0.65}
            colors={[`${C.gold}cc`, `${C.red}88`, `${C.cyan}44`, 'transparent']}
          />
        </Circle>
      </GlowLayer>

      {/* Band 1 — gold/red */}
      <GlowLayer blur={38}>
        <Rect x={x1} y={0} width={width * 0.55} height={height} opacity={0.72}>
          <LinearGradient
            start={vec(0, 0)} end={vec(width * 0.55, 0)}
            colors={['transparent', `${C.gold}ee`, `${C.red}cc`, `${C.gold}88`, 'transparent']}
          />
        </Rect>
      </GlowLayer>

      {/* Band 2 — cyan/purple */}
      <GlowLayer blur={44}>
        <Rect x={x2} y={height * 0.15} width={width * 0.5} height={height * 0.7} opacity={0.68}>
          <LinearGradient
            start={vec(0, 0)} end={vec(width * 0.5, 0)}
            colors={['transparent', `${C.cyan}dd`, `${C.purple}bb`, 'transparent']}
          />
        </Rect>
      </GlowLayer>

      {/* Band 3 — pink/orange, thinner */}
      <GlowLayer blur={30}>
        <Rect x={x3} y={height * 0.3} width={width * 0.35} height={height * 0.45} opacity={0.55}>
          <LinearGradient
            start={vec(0, 0)} end={vec(width * 0.35, 0)}
            colors={['transparent', `${C.pink}cc`, `${C.orange}aa`, 'transparent']}
          />
        </Rect>
      </GlowLayer>
    </Canvas>
  );
}

// ── 2. VORTEX ─────────────────────────────────────────────────────
// Spinning galaxy spiral centred in the banner.
// Multiple spinning arms + central supernova pulse.
export function VortexSkiaEffect({ width, height }: SizeProps) {
  const spin1 = useSharedValue(0);
  const spin2 = useSharedValue(0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    spin1.value = withRepeat(withTiming(360, { duration: 8000,  easing: Easing.linear }), -1, false);
    spin2.value = withRepeat(withTiming(360, { duration: 14000, easing: Easing.linear }), -1, true);
    pulse.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [spin1, spin2, pulse]);

  const cx = width * 0.5;
  const cy = height * 0.5;
  const maxR = Math.min(width, height) * 0.52;

  const rot1 = useDerivedValue(() => [{ rotate: (spin1.value * Math.PI) / 180 }]);
  const rot2 = useDerivedValue(() => [{ rotate: (spin2.value * Math.PI) / 180 }]);
  const coreR = useDerivedValue(() => maxR * (0.18 + pulse.value * 0.1));
  const coreOp = useDerivedValue(() => 0.7 + pulse.value * 0.3);
  const outerR = useDerivedValue(() => maxR * (1.0 + pulse.value * 0.12));

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Outer sweeping ring */}
      <GlowLayer blur={50}>
        <Group transform={rot1} origin={vec(cx, cy)}>
          <Circle cx={cx} cy={cy} r={outerR} opacity={0.7}>
            <SweepGradient c={vec(cx, cy)} colors={[
              `${C.red}00`, `${C.red}ff`, `${C.gold}ee`, `${C.cyan}cc`,
              `${C.purple}99`, `${C.pink}cc`, `${C.red}00`,
            ]} />
          </Circle>
        </Group>
      </GlowLayer>

      {/* Inner counter-rotating ring */}
      <GlowLayer blur={35}>
        <Group transform={rot2} origin={vec(cx, cy)}>
          <Circle cx={cx} cy={cy} r={useDerivedValue(() => outerR.value * 0.6)} opacity={0.8}>
            <SweepGradient c={vec(cx, cy)} colors={[
              `${C.cyan}00`, `${C.cyan}ff`, `${C.gold}dd`, `${C.red}99`, `${C.cyan}00`,
            ]} />
          </Circle>
        </Group>
      </GlowLayer>

      {/* Supernova core */}
      <GlowLayer blur={40}>
        <Circle cx={cx} cy={cy} r={coreR} opacity={coreOp}>
          <RadialGradient
            c={vec(cx, cy)} r={maxR * 0.28}
            colors={[C.white, `${C.gold}ff`, `${C.red}88`, 'transparent']}
          />
        </Circle>
      </GlowLayer>
    </Canvas>
  );
}

// ── 3. EMBERS ─────────────────────────────────────────────────────
// 30 glowing fire particles rising from the bottom with glow trails.
const EMBER_COUNT = 30;
const SEEDS = [...Array(EMBER_COUNT)].map((_, i) => ({
  xFrac: 0.04 + ((i * 0.0631) % 0.92),
  phase: (i * 0.1317) % 1,
  size:  4 + (i % 5) * 1.4,
  drift: (i % 2 === 0 ? 1 : -1) * (15 + (i % 6) * 5),
  speed: 0.7 + (i % 4) * 0.1,
  color: [C.gold, C.red, C.orange, C.pink, C.white][i % 5],
}));

function EmberDot({ w, h, seed, clock }: {
  w: number; h: number; seed: typeof SEEDS[0]; clock: SharedValue<number>;
}) {
  const cx = useDerivedValue(() => {
    const p = ((clock.value * seed.speed) + seed.phase) % 1;
    return seed.xFrac * w + seed.drift * Math.sin(p * Math.PI);
  });
  const cy = useDerivedValue(() => {
    const p = ((clock.value * seed.speed) + seed.phase) % 1;
    return h * (0.95 - p * 0.9);
  });
  const op = useDerivedValue(() => {
    const p = ((clock.value * seed.speed) + seed.phase) % 1;
    if (p < 0.06) return p / 0.06;
    if (p > 0.80) return (1 - p) / 0.20;
    return 0.75 + Math.sin(p * Math.PI) * 0.25;
  });
  return <Circle cx={cx} cy={cy} r={seed.size} color={seed.color} opacity={op} />;
}

export function EmbersSkiaEffect({ width, height }: SizeProps) {
  const clock = useSharedValue(0);
  useEffect(() => {
    clock.value = withRepeat(withTiming(1, { duration: 3800, easing: Easing.linear }), -1, false);
  }, [clock]);

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Warm base glow at bottom */}
      <GlowLayer blur={55}>
        <Rect x={0} y={height * 0.65} width={width} height={height * 0.35} opacity={0.55}>
          <LinearGradient
            start={vec(0, height * 0.65)} end={vec(0, height)}
            colors={['transparent', `${C.red}cc`, `${C.gold}aa`]}
          />
        </Rect>
      </GlowLayer>
      {/* Particles */}
      <GlowLayer blur={20}>
        <Group>
          {SEEDS.map((seed, i) => (
            <EmberDot key={i} w={width} h={height} seed={seed} clock={clock} />
          ))}
        </Group>
      </GlowLayer>
    </Canvas>
  );
}

// ── 4. GLITCH ─────────────────────────────────────────────────────
// Aggressive RGB-channel split + multiple scan lines every 1.5 s.
export function GlitchSkiaEffect({ width, height }: SizeProps) {
  const g = useSharedValue(0);
  const scanA = useSharedValue(0);
  const scanB = useSharedValue(0);

  useEffect(() => {
    const burst = () => {
      g.value = withSequence(
        withTiming(1, { duration: 60 }),
        withTiming(0.4, { duration: 50 }),
        withTiming(0.9, { duration: 40 }),
        withTiming(0, { duration: 90 }),
      );
      scanA.value = height * 0.2 + Math.random() * height * 0.5;
      scanB.value = height * 0.1 + Math.random() * height * 0.6;
    };
    burst();
    const id = setInterval(burst, 1600);
    return () => clearInterval(id);
  }, [g, scanA, scanB]);

  const rX = useDerivedValue(() => g.value * 22);
  const gX = useDerivedValue(() => -g.value * 18);
  const bX = useDerivedValue(() => g.value * 8);
  const op = useDerivedValue(() => g.value * 0.82);
  const scanOp = useDerivedValue(() => g.value * 0.9);

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* RGB channel layers */}
      <Rect x={rX} y={0} width={width} height={height} color={`${C.red}99`}   opacity={op} />
      <Rect x={gX} y={0} width={width} height={height} color={`${C.cyan}88`}  opacity={op} />
      <Rect x={bX} y={0} width={width} height={height} color={`${C.purple}77`} opacity={useDerivedValue(() => op.value * 0.7)} />
      {/* Scan lines */}
      <Rect x={0} y={scanA} width={width} height={4} color={C.white}   opacity={scanOp} />
      <Rect x={0} y={scanB} width={width} height={2} color={`${C.cyan}ff`} opacity={scanOp} />
      {/* Horizontal tear */}
      <Rect x={rX} y={useDerivedValue(() => height * 0.42)} width={width} height={useDerivedValue(() => 14 * g.value)} color={`${C.gold}cc`} opacity={useDerivedValue(() => g.value * 0.6)} />
    </Canvas>
  );
}

// ── 5. SHIMMER ────────────────────────────────────────────────────
// Three staggered wide gleam bands sweeping across continuously.
export function ShimmerSkiaEffect({ width, height }: SizeProps) {
  const s1 = useSharedValue(0);
  const s2 = useSharedValue(0);
  const s3 = useSharedValue(0);

  useEffect(() => {
    s1.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.quad) }), -1, false);
    s2.value = withRepeat(withDelay(750, withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.quad) })), -1, false);
    s3.value = withRepeat(withDelay(1400, withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.quad) })), -1, false);
  }, [s1, s2, s3]);

  const x1 = useDerivedValue(() => -200 + s1.value * (width + 400));
  const x2 = useDerivedValue(() => -200 + s2.value * (width + 400));
  const x3 = useDerivedValue(() => -200 + s3.value * (width + 400));
  const w1 = 160;

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <GlowLayer blur={28}>
        <Rect x={x1} y={0} width={w1} height={height} opacity={0.8}>
          <LinearGradient start={vec(0,0)} end={vec(w1,0)} colors={['transparent', `${C.white}ee`, `${C.gold}cc`, `${C.white}88`, 'transparent']} />
        </Rect>
        <Rect x={x2} y={0} width={120} height={height} opacity={0.65}>
          <LinearGradient start={vec(0,0)} end={vec(120,0)} colors={['transparent', `${C.cyan}cc`, `${C.white}aa`, 'transparent']} />
        </Rect>
        <Rect x={x3} y={0} width={90} height={height} opacity={0.55}>
          <LinearGradient start={vec(0,0)} end={vec(90,0)} colors={['transparent', `${C.purple}bb`, 'transparent']} />
        </Rect>
      </GlowLayer>
    </Canvas>
  );
}

// ── 6. PULSE ──────────────────────────────────────────────────────
// Dramatic radial heartbeat from the center — expands and contracts.
export function PulseSkiaEffect({ width, height }: SizeProps) {
  const beat = useSharedValue(0);
  const secondary = useSharedValue(0);

  useEffect(() => {
    beat.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 450, easing: Easing.out(Easing.cubic) }),
        withTiming(0, { duration: 800, easing: Easing.in(Easing.sin) }),
      ), -1, false,
    );
    secondary.value = withRepeat(
      withSequence(
        withDelay(300, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) })),
        withTiming(0, { duration: 700, easing: Easing.in(Easing.sin) }),
      ), -1, false,
    );
  }, [beat, secondary]);

  const cx = width * 0.5;
  const cy = height * 0.5;
  const maxR = Math.max(width, height) * 0.75;

  const r1 = useDerivedValue(() => maxR * (0.12 + beat.value * 0.88));
  const op1 = useDerivedValue(() => (1 - beat.value) * 0.85);
  const r2 = useDerivedValue(() => maxR * (0.12 + secondary.value * 0.66));
  const op2 = useDerivedValue(() => (1 - secondary.value) * 0.6);

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <GlowLayer blur={45}>
        <Circle cx={cx} cy={cy} r={r1} opacity={op1}>
          <RadialGradient c={vec(cx, cy)} r={maxR} colors={[`${C.gold}ff`, `${C.red}cc`, `${C.purple}66`, 'transparent']} />
        </Circle>
        <Circle cx={cx} cy={cy} r={r2} opacity={op2}>
          <RadialGradient c={vec(cx, cy)} r={maxR * 0.7} colors={[`${C.white}dd`, `${C.cyan}88`, 'transparent']} />
        </Circle>
      </GlowLayer>
    </Canvas>
  );
}

// ═══════════════════════════════════════════════════════════════════
// VISIT ENTRANCE EFFECTS (one-shot, 1.5–2.2 s)
// ═══════════════════════════════════════════════════════════════════

// ── 1. SHOCKWAVE ─────────────────────────────────────────────────
// White nuclear flash → 5 neon rings explode outward from center.
function ShockwaveRing({ i, prog, fade, cx, cy, maxR }: {
  i: number; prog: SharedValue<number>; fade: SharedValue<number>;
  cx: number; cy: number; maxR: number;
}) {
  const delay = i * 0.12;
  const r = useDerivedValue(() => {
    const p = Math.max(0, prog.value - delay) / (1 - delay);
    return maxR * 0.04 + p * maxR * (0.55 + i * 0.18);
  });
  const op = useDerivedValue(() => {
    const p = Math.max(0, prog.value - delay) / (1 - delay);
    return Math.max(0, 1 - p) * (0.9 - i * 0.12) * fade.value;
  });
  const colors = [C.white, C.gold, C.red, C.cyan, C.purple];
  return (
    <Circle cx={cx} cy={cy} r={r} style="stroke"
      strokeWidth={6 - i * 0.8} color={colors[i]} opacity={op} />
  );
}

export function ShockwaveSkiaEffect({ width, height, onDone }: VisitProps) {
  useVisitDone(1800, onDone);
  const flash = useSharedValue(0);
  const prog  = useSharedValue(0);
  const fade  = useSharedValue(1);

  useEffect(() => {
    // Nuclear flash first
    flash.value = withSequence(
      withTiming(1,   { duration: 60  }),
      withTiming(0.4, { duration: 80  }),
      withTiming(0.8, { duration: 50  }),
      withTiming(0,   { duration: 600 }),
    );
    // Rings follow
    prog.value = withTiming(1, { duration: 1400, easing: Easing.out(Easing.cubic) });
    fade.value = withTiming(0, { duration: 1500, easing: Easing.out(Easing.quad)  });
  }, [flash, prog, fade]);

  const cx = width * 0.5;
  const cy = height * 0.45;
  const maxR = Math.hypot(width, height) * 0.65;

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Flash */}
      <Rect x={0} y={0} width={width} height={height} color={C.white} opacity={flash} />
      {/* Rings */}
      <GlowLayer blur={22}>
        <Group>
          {[0, 1, 2, 3, 4].map(i => (
            <ShockwaveRing key={i} i={i} prog={prog} fade={fade} cx={cx} cy={cy} maxR={maxR} />
          ))}
        </Group>
      </GlowLayer>
    </Canvas>
  );
}

// ── 2. CONFETTI ───────────────────────────────────────────────────
// 50-piece firework burst — gravity + spin + trails.
const CONF_N = 50;
const CONF_SEEDS = [...Array(CONF_N)].map((_, i) => {
  const angle = (i / CONF_N) * Math.PI * 2 + (i % 5) * 0.15;
  return {
    angle,
    speed:    160 + (i % 9) * 28,
    gravity:  280 + (i % 6) * 30,
    color:    [C.gold, C.red, C.cyan, C.green, C.purple, C.orange, C.pink, C.white][i % 8],
    w: 6 + (i % 4) * 3,
    h: 11 + (i % 5) * 2,
    spinDir: i % 2 === 0 ? 1 : -1,
  };
});

function ConfettiPiece({ seed, t, cx, cy }: {
  seed: typeof CONF_SEEDS[0]; t: SharedValue<number>; cx: number; cy: number;
}) {
  const transform = useDerivedValue(() => {
    const tx = cx + Math.cos(seed.angle) * seed.speed * t.value;
    const ty = cy + Math.sin(seed.angle) * seed.speed * t.value + seed.gravity * t.value * t.value;
    const rot = seed.spinDir * t.value * 9;
    return [{ translateX: tx }, { translateY: ty }, { rotate: rot }];
  });
  const op = useDerivedValue(() => Math.max(0, 1 - t.value * 0.9));
  return (
    <Group transform={transform}>
      <Rect x={-seed.w / 2} y={-seed.h / 2} width={seed.w} height={seed.h}
        color={seed.color} opacity={op} />
    </Group>
  );
}

export function ConfettiSkiaEffect({ width, height, onDone }: VisitProps) {
  useVisitDone(2000, onDone);
  const t    = useSharedValue(0);

  useEffect(() => {
    t.value = withTiming(1, { duration: 1700, easing: Easing.out(Easing.cubic) });
  }, [t]);

  const cx = width * 0.5;
  const cy = height * 0.38;

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Centre burst glow */}
      <GlowLayer blur={50}>
        <Circle cx={cx} cy={cy} r={useDerivedValue(() => 30 + (1 - t.value) * 120)}
          opacity={useDerivedValue(() => (1 - t.value) * 0.9)}>
          <RadialGradient c={vec(cx, cy)} r={150}
            colors={[`${C.white}ff`, `${C.gold}cc`, 'transparent']} />
        </Circle>
      </GlowLayer>
      {CONF_SEEDS.map((s, i) => (
        <ConfettiPiece key={i} seed={s} t={t} cx={cx} cy={cy} />
      ))}
    </Canvas>
  );
}

// ── 3. LIGHTNING ──────────────────────────────────────────────────
// Double zigzag bolt + neon glow + triple-flash.
function buildBolt(w: number, h: number, flip: boolean) {
  const p = Skia.Path.Make();
  const ox = flip ? w * 0.15 : 0;
  p.moveTo(ox + w * 0.52, h * 0.04);
  p.lineTo(ox + w * 0.38, h * 0.35);
  p.lineTo(ox + w * 0.55, h * 0.36);
  p.lineTo(ox + w * 0.31, h * 0.72);
  p.lineTo(ox + w * 0.48, h * 0.52);
  p.lineTo(ox + w * 0.30, h * 0.52);
  p.close();
  return p;
}

export function LightningSkiaEffect({ width, height, onDone }: VisitProps) {
  useVisitDone(1600, onDone);
  const flash = useSharedValue(0);
  const bolt  = useSharedValue(0);
  const glow  = useSharedValue(0);

  useEffect(() => {
    flash.value = withSequence(
      withTiming(1,    { duration: 50  }),
      withTiming(0.2,  { duration: 80  }),
      withTiming(0.85, { duration: 40  }),
      withTiming(0,    { duration: 500 }),
    );
    bolt.value  = withSequence(
      withDelay(60,  withTiming(1, { duration: 120 })),
      withDelay(300, withTiming(0, { duration: 500 })),
    );
    glow.value = withSequence(
      withDelay(60, withTiming(1, { duration: 180 })),
      withTiming(0, { duration: 600 }),
    );
  }, [flash, bolt, glow]);

  const path1 = React.useMemo(() => buildBolt(width, height, false), [width, height]);
  const path2 = React.useMemo(() => buildBolt(width, height, true),  [width, height]);

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Rect x={0} y={0} width={width} height={height} color="#ddf4ff" opacity={flash} />
      <GlowLayer blur={30}>
        <Path path={path1} color={C.gold}  style="fill"   opacity={bolt}  />
        <Path path={path1} color={C.white} style="stroke" strokeWidth={3} opacity={bolt} />
      </GlowLayer>
      <GlowLayer blur={16}>
        <Path path={path2} color={C.cyan}  style="fill"   opacity={useDerivedValue(() => bolt.value * 0.6)} />
      </GlowLayer>
    </Canvas>
  );
}

// ── 4. PORTAL ─────────────────────────────────────────────────────
// Black void opens at centre, spinning rainbow ring expands and fades.
export function PortalSkiaEffect({ width, height, onDone }: VisitProps) {
  useVisitDone(1900, onDone);
  const scale = useSharedValue(0.02);
  const spin  = useSharedValue(0);
  const fade  = useSharedValue(1);
  const inner = useSharedValue(0);

  useEffect(() => {
    scale.value = withSpring(3.2, { damping: 10, stiffness: 60 });
    spin.value  = withRepeat(withTiming(360, { duration: 800, easing: Easing.linear }), -1, false);
    fade.value  = withTiming(0, { duration: 1200, easing: Easing.in(Easing.quad) });
    inner.value = withSequence(
      withTiming(1, { duration: 200 }),
      withTiming(0, { duration: 900 }),
    );
  }, [scale, spin, fade, inner]);

  const cx = width * 0.5;
  const cy = height * 0.46;
  const baseR = width * 0.24;
  const r  = useDerivedValue(() => baseR * scale.value);
  const ri = useDerivedValue(() => r.value * 0.55);
  const rot = useDerivedValue(() => [{ rotate: (spin.value * Math.PI) / 180 }]);
  const op  = useDerivedValue(() => fade.value);
  const voidR = useDerivedValue(() => r.value * 0.48);

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Dark void growing */}
      <Circle cx={cx} cy={cy} r={voidR} color="#000000" opacity={useDerivedValue(() => fade.value * 0.88)} />
      {/* Spinning outer ring */}
      <GlowLayer blur={36}>
        <Group transform={rot} origin={vec(cx, cy)} opacity={op}>
          <Circle cx={cx} cy={cy} r={r} style="stroke" strokeWidth={7}>
            <SweepGradient c={vec(cx, cy)}
              colors={[C.gold, C.red, C.cyan, C.purple, C.green, C.pink, C.gold]} />
          </Circle>
          <Circle cx={cx} cy={cy} r={ri} style="stroke" strokeWidth={3} color={`${C.cyan}cc`} />
        </Group>
      </GlowLayer>
      {/* Inner flash */}
      <GlowLayer blur={50}>
        <Circle cx={cx} cy={cy} r={useDerivedValue(() => baseR * 0.8)} opacity={inner}>
          <RadialGradient c={vec(cx, cy)} r={baseR}
            colors={[`${C.white}ff`, `${C.gold}bb`, 'transparent']} />
        </Circle>
      </GlowLayer>
    </Canvas>
  );
}

// ── 5. CURTAIN ────────────────────────────────────────────────────
// Cinematic dark panels slam shut then burst open, revealing profile.
export function CurtainSkiaEffect({ width, height, onDone }: VisitProps) {
  useVisitDone(1700, onDone);
  const stage = useSharedValue(0); // 0→1 close, 1→2 open

  useEffect(() => {
    stage.value = withSequence(
      // slam shut fast
      withSpring(1, { damping: 22, stiffness: 220 }),
      // flash hold
      withTiming(1, { duration: 120 }),
      // burst open with spring
      withSpring(2, { damping: 14, stiffness: 130 }),
    );
  }, [stage]);

  const leftX = useAnimatedStyle(() => {
    const s = stage.value <= 1
      ? -(width * 0.52) * (1 - stage.value)         // closing: slide in from left
      : -(width * 0.52) * (stage.value - 1);          // opening: slide out to left
    return { position: 'absolute', top: 0, bottom: 0, left: 0, width: width * 0.52,
      backgroundColor: '#060606', transform: [{ translateX: s }] };
  });
  const rightX = useAnimatedStyle(() => {
    const s = stage.value <= 1
      ? (width * 0.52) * (1 - stage.value)
      : (width * 0.52) * (stage.value - 1);
    return { position: 'absolute', top: 0, bottom: 0, right: 0, width: width * 0.52,
      backgroundColor: '#060606', transform: [{ translateX: s }] };
  });
  const seam = useAnimatedStyle(() => ({
    position: 'absolute', top: 0, bottom: 0,
    left: width * 0.5 - 3, width: 6,
    opacity: stage.value <= 1 ? stage.value : Math.max(0, 2 - stage.value),
  }));

  return (
    <>
      <Animated.View pointerEvents="none" style={leftX}  />
      <Animated.View pointerEvents="none" style={rightX} />
      {/* Neon seam at centre */}
      <Animated.View pointerEvents="none" style={seam}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Rect x={0} y={0} width={6} height={height}>
            <LinearGradient start={vec(0,0)} end={vec(0,height)}
              colors={[C.gold, C.red, C.purple, C.cyan, C.gold]} />
          </Rect>
        </Canvas>
      </Animated.View>
    </>
  );
}

// ── 6. RINGS ─────────────────────────────────────────────────────
// Three massive concentric rings pulse outward from the avatar zone.
export function RingsSkiaEffect({ width, height, onDone }: VisitProps) {
  useVisitDone(2000, onDone);
  const p1 = useSharedValue(0), o1 = useSharedValue(1);
  const p2 = useSharedValue(0), o2 = useSharedValue(1);
  const p3 = useSharedValue(0), o3 = useSharedValue(1);

  useEffect(() => {
    p1.value = withTiming(1, { duration: 1600, easing: Easing.out(Easing.cubic) });
    o1.value = withTiming(0, { duration: 1600 });
    p2.value = withDelay(180, withTiming(1, { duration: 1500, easing: Easing.out(Easing.cubic) }));
    o2.value = withDelay(180, withTiming(0, { duration: 1500 }));
    p3.value = withDelay(360, withTiming(1, { duration: 1400, easing: Easing.out(Easing.cubic) }));
    o3.value = withDelay(360, withTiming(0, { duration: 1400 }));
  }, [p1, o1, p2, o2, p3, o3]);

  const cx = width * 0.5;
  const cy = height * 0.42;
  const maxR = Math.hypot(width, height) * 0.6;
  const colors = [C.gold, C.cyan, C.purple];

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <GlowLayer blur={28}>
        {([{ p: p1, o: o1 }, { p: p2, o: o2 }, { p: p3, o: o3 }] as const).map(({ p, o }, i) => (
          <Circle key={i}
            cx={cx} cy={cy}
            r={useDerivedValue(() => maxR * 0.06 + p.value * maxR)}
            style="stroke" strokeWidth={8 - i * 1.5}
            color={colors[i]}
            opacity={useDerivedValue(() => o.value * (1 - i * 0.15))}
          />
        ))}
      </GlowLayer>
    </Canvas>
  );
}

// ── 7. GLOW ───────────────────────────────────────────────────────
// Supernova radial burst from the avatar — three pulses.
export function GlowSkiaEffect({ width, height, onDone }: VisitProps) {
  useVisitDone(1800, onDone);
  const b1 = useSharedValue(0);
  const b2 = useSharedValue(0);

  useEffect(() => {
    b1.value = withSequence(
      withTiming(1,   { duration: 400, easing: Easing.out(Easing.cubic) }),
      withTiming(0.5, { duration: 200 }),
      withTiming(0.85,{ duration: 200 }),
      withTiming(0,   { duration: 700 }),
    );
    b2.value = withDelay(250, withSequence(
      withTiming(1,   { duration: 350, easing: Easing.out(Easing.cubic) }),
      withTiming(0,   { duration: 900 }),
    ));
  }, [b1, b2]);

  const cx = width * 0.5;
  const cy = height * 0.44;
  const maxR = Math.max(width, height) * 0.85;

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <GlowLayer blur={60}>
        <Circle cx={cx} cy={cy} r={useDerivedValue(() => maxR * (0.08 + b1.value * 0.92))} opacity={useDerivedValue(() => b1.value * 0.85)}>
          <RadialGradient c={vec(cx, cy)} r={maxR} colors={[`${C.white}ff`, `${C.gold}ee`, `${C.red}99`, 'transparent']} />
        </Circle>
      </GlowLayer>
      <GlowLayer blur={40}>
        <Circle cx={cx} cy={cy} r={useDerivedValue(() => maxR * (0.05 + b2.value * 0.65))} opacity={useDerivedValue(() => b2.value * 0.7)}>
          <RadialGradient c={vec(cx, cy)} r={maxR * 0.7} colors={[`${C.cyan}cc`, `${C.purple}88`, 'transparent']} />
        </Circle>
      </GlowLayer>
    </Canvas>
  );
}

// ── 8. SWEEP ──────────────────────────────────────────────────────
// Two blazing neon gleam bands slash across diagonally.
export function SweepSkiaEffect({ width, height, onDone }: VisitProps) {
  useVisitDone(1500, onDone);
  const s1 = useSharedValue(0);
  const s2 = useSharedValue(0);
  const fade = useSharedValue(1);

  useEffect(() => {
    s1.value = withTiming(1, { duration: 800, easing: Easing.out(Easing.cubic) });
    s2.value = withDelay(180, withTiming(1, { duration: 800, easing: Easing.out(Easing.cubic) }));
    fade.value = withDelay(600, withTiming(0, { duration: 600 }));
  }, [s1, s2, fade]);

  const x1 = useDerivedValue(() => -220 + s1.value * (width + 440));
  const x2 = useDerivedValue(() => -180 + s2.value * (width + 360));
  const bw = 200;

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <GlowLayer blur={32}>
        <Rect x={x1} y={-height * 0.1} width={bw} height={height * 1.2} opacity={fade}>
          <LinearGradient start={vec(0, 0)} end={vec(bw, 0)}
            colors={['transparent', `${C.white}ff`, `${C.gold}ee`, `${C.white}88`, 'transparent']} />
        </Rect>
        <Rect x={x2} y={-height * 0.1} width={110} height={height * 1.2} opacity={useDerivedValue(() => fade.value * 0.65)}>
          <LinearGradient start={vec(0, 0)} end={vec(110, 0)}
            colors={['transparent', `${C.cyan}dd`, 'transparent']} />
        </Rect>
      </GlowLayer>
    </Canvas>
  );
}

// ── 9. SPARKLE ────────────────────────────────────────────────────
// 40 gold sparkle stars burst from centre with glow trails.
const SPARKLE_N = 40;
const SPARKLE_SEEDS = [...Array(SPARKLE_N)].map((_, i) => {
  const angle = (i / SPARKLE_N) * Math.PI * 2 + (i % 7) * 0.08;
  return {
    angle,
    dist: 60 + (i % 8) * 28,
    size: 2.5 + (i % 5) * 1.2,
    color: [C.gold, C.white, C.cyan, '#fffacd', C.orange, C.pink][i % 6],
    delay: (i % 5) * 0.06,
  } as const;
});

function SparkleDot({ seed, t }: { seed: typeof SPARKLE_SEEDS[0]; t: SharedValue<number>; }) {
  const tx = useDerivedValue(() => {
    const p = Math.max(0, (t.value - seed.delay) / (1 - seed.delay));
    return Math.cos(seed.angle) * seed.dist * p;
  });
  const ty = useDerivedValue(() => {
    const p = Math.max(0, (t.value - seed.delay) / (1 - seed.delay));
    return Math.sin(seed.angle) * seed.dist * p;
  });
  const op = useDerivedValue(() => {
    const p = Math.max(0, (t.value - seed.delay) / (1 - seed.delay));
    return p < 0.5 ? p * 2 : (1 - p) * 2;
  });
  return <Circle cx={tx} cy={ty} r={seed.size} color={seed.color} opacity={op} />;
}

export function SparkleSkiaEffect({ width, height, onDone }: VisitProps) {
  useVisitDone(1600, onDone);
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withTiming(1, { duration: 1400, easing: Easing.out(Easing.cubic) });
  }, [t]);

  const cx = width * 0.5;
  const cy = height * 0.42;

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Burst core flash */}
      <GlowLayer blur={55}>
        <Circle cx={cx} cy={cy} r={useDerivedValue(() => 20 + (1 - t.value) * 100)}
          opacity={useDerivedValue(() => (1 - t.value) * 0.9)}>
          <RadialGradient c={vec(cx, cy)} r={120} colors={[`${C.white}ff`, `${C.gold}cc`, 'transparent']} />
        </Circle>
      </GlowLayer>
      {/* Sparkle dots */}
      <GlowLayer blur={10}>
        <Group transform={[{ translateX: cx }, { translateY: cy }]}>
          {SPARKLE_SEEDS.map((s, i) => <SparkleDot key={i} seed={s} t={t} />)}
        </Group>
      </GlowLayer>
    </Canvas>
  );
}

// ── 10. METEOR ────────────────────────────────────────────────────
// 10 bright meteors rain diagonally with glowing tails.
const METEOR_N = 10;
const METEOR_SEEDS = [...Array(METEOR_N)].map((_, i) => ({
  yFrac: 0.02 + (i * 0.098) % 0.65,
  delay: i * 0.07,
  len:   90 + (i % 5) * 35,
  color: [C.white, C.gold, C.cyan, C.orange, C.purple][i % 5],
  dir:   i % 2 === 0 ? 1 : -1,
}));

export function MeteorSkiaEffect({ width, height, onDone }: VisitProps) {
  useVisitDone(1800, onDone);
  const t    = useSharedValue(0);
  const fade = useSharedValue(1);

  useEffect(() => {
    t.value    = withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.cubic) });
    fade.value = withDelay(900, withTiming(0, { duration: 600 }));
  }, [t, fade]);

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <GlowLayer blur={14}>
        <Group>
          {METEOR_SEEDS.map((seed, i) => {
            const startX = seed.dir > 0 ? -seed.len : width + seed.len;
            const travel = width * 1.4;
            const tx = useDerivedValue(() => {
              const p = Math.max(0, (t.value - seed.delay) / (1 - seed.delay));
              return startX + seed.dir * travel * p;
            });
            const ty = useDerivedValue(() => {
              const p = Math.max(0, (t.value - seed.delay) / (1 - seed.delay));
              return height * seed.yFrac + p * height * 0.25;
            });
            const op = useDerivedValue(() => {
              const p = Math.max(0, (t.value - seed.delay) / (1 - seed.delay));
              return (p < 0.15 ? p / 0.15 : p > 0.75 ? (1 - p) / 0.25 : 1) * fade.value;
            });
            const angle = seed.dir > 0 ? 0.42 : -0.42;
            const transform = useDerivedValue(() => [
              { translateX: tx.value }, { translateY: ty.value }, { rotate: angle },
            ]);
            return (
              <Group key={i} transform={transform} opacity={op}>
                <Rect x={0} y={-3} width={seed.len} height={6}>
                  <LinearGradient start={vec(0,0)} end={vec(seed.len, 0)}
                    colors={['transparent', `${seed.color}ff`, `${seed.color}44`]} />
                </Rect>
              </Group>
            );
          })}
        </Group>
      </GlowLayer>
    </Canvas>
  );
}

// ── 11. IRIS ──────────────────────────────────────────────────────
// Cinematic: dark veil recedes as a gold iris expands open.
export function IrisSkiaEffect({ width, height, onDone }: VisitProps) {
  useVisitDone(1900, onDone);
  const scale  = useSharedValue(0.08);
  const veil   = useSharedValue(0.95);
  const ring   = useSharedValue(0);

  useEffect(() => {
    scale.value = withSpring(3.8, { damping: 12, stiffness: 50 });
    veil.value  = withTiming(0,   { duration: 1500, easing: Easing.out(Easing.quad) });
    ring.value  = withSequence(
      withTiming(1, { duration: 400 }),
      withTiming(0, { duration: 900 }),
    );
  }, [scale, veil, ring]);

  const cx = width * 0.5;
  const cy = height * 0.44;
  const baseR = width * 0.3;
  const r  = useDerivedValue(() => baseR * scale.value);
  const r2 = useDerivedValue(() => r.value * 0.68);

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Dark veil */}
      <Rect x={0} y={0} width={width} height={height} color="#000000" opacity={veil} />
      {/* Expanding rings */}
      <GlowLayer blur={28}>
        <Circle cx={cx} cy={cy} r={r}  style="stroke" strokeWidth={6} color={C.gold}   opacity={useDerivedValue(() => ring.value * 0.9)} />
        <Circle cx={cx} cy={cy} r={r2} style="stroke" strokeWidth={3} color={C.cyan}   opacity={useDerivedValue(() => ring.value * 0.7)} />
      </GlowLayer>
    </Canvas>
  );
}

// ── 12. TURBO ─────────────────────────────────────────────────────
// Speed lines converge from the sides — whiplash entrance.
const TURBO_LINES = [...Array(16)].map((_, i) => ({
  yFrac: 0.05 + (i * 0.059) % 0.9,
  wFrac: 0.35 + (i % 6) * 0.08,
  dir:   i % 2 === 0 ? 1 : -1,
  color: [C.white, C.gold, C.cyan][i % 3],
  thick: 2 + (i % 3),
  delay: i * 0.04,
}));

export function TurboSkiaEffect({ width, height, onDone }: VisitProps) {
  useVisitDone(1400, onDone);
  const t    = useSharedValue(0);
  const fade = useSharedValue(1);

  useEffect(() => {
    t.value    = withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) });
    fade.value = withDelay(500, withTiming(0, { duration: 600 }));
  }, [t, fade]);

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <GlowLayer blur={12}>
        <Group>
          {TURBO_LINES.map((line, i) => {
            const lineW = width * line.wFrac;
            const startX = line.dir > 0 ? -lineW : width;
            const endX   = line.dir > 0 ? width * 0.5 - lineW * 0.5 : width * 0.5 - lineW * 0.5;
            const tx = useDerivedValue(() => {
              const p = Math.max(0, (t.value - line.delay) / (1 - line.delay));
              return startX + (endX - startX) * p;
            });
            const op = useDerivedValue(() => {
              const p = Math.max(0, (t.value - line.delay) / (1 - line.delay));
              return (p < 0.2 ? p * 5 : p > 0.7 ? (1 - p) / 0.3 : 1) * fade.value * 0.85;
            });
            const transform = useDerivedValue(() => [{ translateX: tx.value }]);
            return (
              <Group key={i} transform={transform} opacity={op}>
                <Rect x={0} y={height * line.yFrac} width={lineW} height={line.thick}>
                  <LinearGradient start={vec(0, 0)} end={vec(lineW, 0)}
                    colors={line.dir > 0
                      ? ['transparent', `${line.color}bb`, `${line.color}ff`]
                      : [`${line.color}ff`, `${line.color}bb`, 'transparent']
                    }
                  />
                </Rect>
              </Group>
            );
          })}
        </Group>
      </GlowLayer>
    </Canvas>
  );
}

// ── 13. SIGNAL ────────────────────────────────────────────────────
// Digital TV static / transmission error → clears to profile.
export function SignalSkiaEffect({ width, height, onDone }: VisitProps) {
  useVisitDone(1600, onDone);
  const noise = useSharedValue(1);
  const rX = useSharedValue(0), gX = useSharedValue(0), bX = useSharedValue(0);

  useEffect(() => {
    noise.value = withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.cubic) });
    const glitch = () => {
      rX.value = withSequence(withTiming(12 * (Math.random() > 0.5 ? 1 : -1), { duration: 40 }), withTiming(0, { duration: 40 }));
      gX.value = withSequence(withTiming(-9 * (Math.random() > 0.5 ? 1 : -1), { duration: 40 }), withTiming(0, { duration: 40 }));
      bX.value = withSequence(withTiming(6  * (Math.random() > 0.5 ? 1 : -1), { duration: 40 }), withTiming(0, { duration: 40 }));
    };
    glitch();
    const id = setInterval(glitch, 120);
    const stop = setTimeout(() => clearInterval(id), 1300);
    return () => { clearInterval(id); clearTimeout(stop); };
  }, [noise, rX, gX, bX]);

  const scanCount = 28;

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* RGB channel split */}
      <Rect x={rX} y={0} width={width} height={height} color={`${C.red}55`}   opacity={noise} />
      <Rect x={gX} y={0} width={width} height={height} color={`${C.cyan}44`}  opacity={noise} />
      <Rect x={bX} y={0} width={width} height={height} color={`${C.purple}33`} opacity={noise} />
      {/* Horizontal noise bands */}
      {[...Array(scanCount)].map((_, i) => (
        <Rect key={i}
          x={0} y={(i / scanCount) * height} width={width} height={height / scanCount - 1}
          color={i % 3 === 0 ? '#ffffff' : i % 3 === 1 ? '#aaaaaa' : '#333333'}
          opacity={useDerivedValue(() => noise.value * (0.15 + (i % 5) * 0.06))}
        />
      ))}
    </Canvas>
  );
}

// ── 14. CHROMABURST ───────────────────────────────────────────────
// RGB channels explode outward then snap back — prismatic bomb.
export function ChromaBurstSkiaEffect({ width, height, onDone }: VisitProps) {
  useVisitDone(1700, onDone);
  const r = useSharedValue(0);
  const g = useSharedValue(0);
  const b = useSharedValue(0);
  const flash = useSharedValue(0);

  useEffect(() => {
    flash.value = withSequence(
      withTiming(1,   { duration: 60 }),
      withTiming(0.4, { duration: 100 }),
      withTiming(0,   { duration: 600 }),
    );
    r.value = withSequence(
      withTiming(30,  { duration: 150, easing: Easing.out(Easing.cubic) }),
      withTiming(-10, { duration: 120 }),
      withTiming(0,   { duration: 500 }),
    );
    g.value = withSequence(
      withTiming(-24, { duration: 140, easing: Easing.out(Easing.cubic) }),
      withTiming(8,   { duration: 120 }),
      withTiming(0,   { duration: 500 }),
    );
    b.value = withSequence(
      withDelay(60, withTiming(18, { duration: 150, easing: Easing.out(Easing.cubic) })),
      withTiming(-6,  { duration: 120 }),
      withTiming(0,   { duration: 500 }),
    );
  }, [r, g, b, flash]);

  const rOp = useDerivedValue(() => Math.min(1, Math.abs(r.value) / 10) * 0.85);
  const gOp = useDerivedValue(() => Math.min(1, Math.abs(g.value) / 10) * 0.8);
  const bOp = useDerivedValue(() => Math.min(1, Math.abs(b.value) / 10) * 0.75);

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Rect x={0} y={0} width={width} height={height} color={C.white}          opacity={flash} />
      <Rect x={r} y={0} width={width} height={height} color={`${C.red}aa`}     opacity={rOp}  />
      <Rect x={g} y={0} width={width} height={height} color={`${C.green}99`}   opacity={gOp}  />
      <Rect x={b} y={0} width={width} height={height} color={`${C.cyan}88`}    opacity={bOp}  />
      <GlowLayer blur={40}>
        <Circle cx={width * 0.5} cy={height * 0.44} r={useDerivedValue(() => Math.abs(r.value) * 4 + 30)}
          opacity={useDerivedValue(() => rOp.value * 0.9)}>
          <RadialGradient c={vec(width * 0.5, height * 0.44)} r={width * 0.5}
            colors={[`${C.white}ff`, `${C.gold}aa`, 'transparent']} />
        </Circle>
      </GlowLayer>
    </Canvas>
  );
}

// ── 15. HERO-FLASH ────────────────────────────────────────────────
// Instant white nuclear flash — simplest but still satisfying.
export function HeroFlashSkiaEffect({ width, height, onDone }: VisitProps) {
  useVisitDone(700, onDone);
  const op = useSharedValue(1);
  useEffect(() => {
    op.value = withSequence(
      withTiming(1,   { duration: 40 }),
      withTiming(0.5, { duration: 80 }),
      withTiming(0.9, { duration: 40 }),
      withTiming(0,   { duration: 400 }),
    );
  }, [op]);
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Rect x={0} y={0} width={width} height={height} color={C.white} opacity={op} />
      <GlowLayer blur={50}>
        <Rect x={0} y={0} width={width} height={height} opacity={useDerivedValue(() => op.value * 0.5)}>
          <RadialGradient c={vec(width * 0.5, height * 0.44)} r={width * 0.7}
            colors={[`${C.gold}ff`, `${C.white}aa`, 'transparent']} />
        </Rect>
      </GlowLayer>
    </Canvas>
  );
}

// Backwards-compat alias used by ProfileHeroMotionLayer
export { GlitchSkiaEffect as GlitchSkiaOverlay };

// ─── Export sets ──────────────────────────────────────────────────
export const SKIA_HERO_MOTIONS = new Set(['aurora', 'vortex', 'embers', 'glitch', 'shimmer', 'pulse']);
export const SKIA_VISIT_KINDS  = new Set([
  'shockwave', 'confetti', 'lightning', 'portal', 'curtain',
  'rings', 'glow', 'sweep', 'sparkle', 'meteor',
  'iris', 'turbo', 'signal', 'chromaburst', 'hero-flash',
]);

// ─── Canvas size helper ───────────────────────────────────────────
export function SkiaHeroCanvas({
  children, width: fixedW, height: fixedH,
}: { children: (size: SizeProps) => React.ReactNode; width?: number; height?: number }) {
  const [size, setSize] = React.useState({ width: fixedW ?? 0, height: fixedH ?? 280 });
  if (fixedW && fixedH) {
    return <View style={StyleSheet.absoluteFill}>{children({ width: fixedW, height: fixedH })}</View>;
  }
  return (
    <View style={StyleSheet.absoluteFill} onLayout={e => {
      const { width, height } = e.nativeEvent.layout;
      if (width > 0 && height > 0) setSize({ width, height });
    }}>
      {size.width > 0 ? children(size) : null}
    </View>
  );
}
