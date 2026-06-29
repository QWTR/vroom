import React from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import {
  ChromaBurstSkiaEffect,
  ConfettiSkiaEffect,
  CurtainSkiaEffect,
  GlowSkiaEffect,
  HeroFlashSkiaEffect,
  IrisSkiaEffect,
  LightningSkiaEffect,
  MeteorSkiaEffect,
  PortalSkiaEffect,
  RingsSkiaEffect,
  ShockwaveSkiaEffect,
  SKIA_VISIT_KINDS,
  SignalSkiaEffect,
  SparkleSkiaEffect,
  SweepSkiaEffect,
  TurboSkiaEffect,
} from './motion/heroSkiaEffects';
import {
  ApexRevealEntrance,
  GarageIgnitionEntrance,
  HyperTunnelEntrance,
  NeonImpactEntrance,
} from './motion/premiumProfileEffects';

export default function VisitEntranceFx({ kind, onDone }: { kind: string; onDone: () => void }) {
  const { width, height } = Dimensions.get('window');
  const premiumVisitKinds = new Set(['apex-reveal', 'garage-ignition', 'neon-impact', 'hyper-tunnel']);
  const isPremiumVisitKind = premiumVisitKinds.has(kind);
  const isUnknown = !isPremiumVisitKind && !SKIA_VISIT_KINDS.has(kind);

  React.useEffect(() => {
    if (isUnknown) onDone();
  }, [isUnknown, onDone]);

  if (isUnknown) return null;

  return (
    <View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject, zIndex: 40 }}>
      {kind === 'apex-reveal'     && <ApexRevealEntrance     width={width} height={height} onDone={onDone} />}
      {kind === 'garage-ignition' && <GarageIgnitionEntrance width={width} height={height} onDone={onDone} />}
      {kind === 'neon-impact'     && <NeonImpactEntrance     width={width} height={height} onDone={onDone} />}
      {kind === 'hyper-tunnel'    && <HyperTunnelEntrance    width={width} height={height} onDone={onDone} />}
      {kind === 'shockwave'   && <ShockwaveSkiaEffect   width={width} height={height} onDone={onDone} />}
      {kind === 'confetti'    && <ConfettiSkiaEffect    width={width} height={height} onDone={onDone} />}
      {kind === 'lightning'   && <LightningSkiaEffect   width={width} height={height} onDone={onDone} />}
      {kind === 'portal'      && <PortalSkiaEffect      width={width} height={height} onDone={onDone} />}
      {kind === 'curtain'     && <CurtainSkiaEffect     width={width} height={height} onDone={onDone} />}
      {kind === 'rings'       && <RingsSkiaEffect       width={width} height={height} onDone={onDone} />}
      {kind === 'glow'        && <GlowSkiaEffect        width={width} height={height} onDone={onDone} />}
      {kind === 'sweep'       && <SweepSkiaEffect       width={width} height={height} onDone={onDone} />}
      {kind === 'sparkle'     && <SparkleSkiaEffect     width={width} height={height} onDone={onDone} />}
      {kind === 'meteor'      && <MeteorSkiaEffect      width={width} height={height} onDone={onDone} />}
      {kind === 'iris'        && <IrisSkiaEffect        width={width} height={height} onDone={onDone} />}
      {kind === 'turbo'       && <TurboSkiaEffect       width={width} height={height} onDone={onDone} />}
      {kind === 'signal'      && <SignalSkiaEffect      width={width} height={height} onDone={onDone} />}
      {kind === 'chromaburst' && <ChromaBurstSkiaEffect width={width} height={height} onDone={onDone} />}
      {kind === 'hero-flash'  && <HeroFlashSkiaEffect   width={width} height={height} onDone={onDone} />}
    </View>
  );
}
