import React from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import {
  ConfettiSkiaEffect,
  CurtainSkiaEffect,
  GlowSkiaEffect,
  HeroFlashSkiaEffect,
  MeteorSkiaEffect,
  RingsSkiaEffect,
  ShockwaveSkiaEffect,
  SKIA_VISIT_KINDS,
  SignalSkiaEffect,
  SparkleSkiaEffect,
  SweepSkiaEffect,
} from './motion/heroSkiaEffects';
import { isRefinedVisitKind, RefinedEntranceEffect } from './motion/refinedProfileEffects';

type Props = {
  kind: string;
  onDone: () => void;
  width?: number;
  height?: number;
};

export default function VisitEntranceFx({ kind, onDone, width: requestedWidth, height: requestedHeight }: Props) {
  const screen = Dimensions.get('window');
  const width = requestedWidth ?? screen.width;
  const height = requestedHeight ?? screen.height;
  const isRefined = isRefinedVisitKind(kind);
  const isUnknown = !isRefined && !SKIA_VISIT_KINDS.has(kind);

  React.useEffect(() => {
    if (isUnknown) onDone();
  }, [isUnknown, onDone]);

  if (isUnknown) return null;

  return (
    <View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject, zIndex: 40 }}>
      {isRefined && <RefinedEntranceEffect kind={kind} width={width} height={height} onDone={onDone} />}
      {kind === 'shockwave'   && <ShockwaveSkiaEffect   width={width} height={height} onDone={onDone} />}
      {kind === 'confetti'    && <ConfettiSkiaEffect    width={width} height={height} onDone={onDone} />}
      {kind === 'curtain'     && <CurtainSkiaEffect     width={width} height={height} onDone={onDone} />}
      {kind === 'rings'       && <RingsSkiaEffect       width={width} height={height} onDone={onDone} />}
      {kind === 'glow'        && <GlowSkiaEffect        width={width} height={height} onDone={onDone} />}
      {kind === 'sweep'       && <SweepSkiaEffect       width={width} height={height} onDone={onDone} />}
      {kind === 'sparkle'     && <SparkleSkiaEffect     width={width} height={height} onDone={onDone} />}
      {kind === 'meteor'      && <MeteorSkiaEffect      width={width} height={height} onDone={onDone} />}
      {kind === 'signal'      && <SignalSkiaEffect      width={width} height={height} onDone={onDone} />}
      {kind === 'hero-flash'  && <HeroFlashSkiaEffect   width={width} height={height} onDone={onDone} />}
    </View>
  );
}
