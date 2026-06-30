import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Image,
  Modal,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import type { GamificationReward, GeoDropRewardPreview } from '../../lib/gamificationClient';

const CARD_W = 116;
const CARD_H = 138;
const REEL_PREFIX = 28;
const REEL_SUFFIX = 8;

const RARITY_META: Record<string, { label: string; color: string; glow: string }> = {
  common: { label: 'COMMON', color: '#e5e7eb', glow: 'rgba(229,231,235,0.26)' },
  rare: { label: 'RARE', color: '#38bdf8', glow: 'rgba(56,189,248,0.30)' },
  epic: { label: 'EPIC', color: '#c084fc', glow: 'rgba(192,132,252,0.34)' },
  legendary: { label: 'LEGENDARY', color: '#facc15', glow: 'rgba(250,204,21,0.38)' },
};

type Props = {
  visible: boolean;
  reward: GamificationReward | null;
  onClose: () => void;
};

function asRewardPreview(value: unknown): GeoDropRewardPreview | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  return {
    id: typeof row.id === 'number' ? row.id : null,
    rarity: typeof row.rarity === 'string' ? row.rarity : undefined,
    rewardType: typeof row.rewardType === 'string' ? row.rewardType : 'drop',
    rewardAmount: typeof row.rewardAmount === 'number' ? row.rewardAmount : null,
    rewardItemId: typeof row.rewardItemId === 'string' ? row.rewardItemId : null,
    label: typeof row.label === 'string' ? row.label : null,
    weight: typeof row.weight === 'number' ? row.weight : 1,
    previewUrl: typeof row.previewUrl === 'string' ? row.previewUrl : null,
    assetUrl: typeof row.assetUrl === 'string' ? row.assetUrl : null,
    assetKind: typeof row.assetKind === 'string' ? row.assetKind : null,
  };
}

function rewardLabel(item: GeoDropRewardPreview | null, nitroAmount = 0) {
  if (!item) return nitroAmount > 0 ? `${nitroAmount} Nitro` : 'Nagroda';
  if (item.label) return item.label;
  if (item.rewardType === 'nitro' && item.rewardAmount) return `${item.rewardAmount} Nitro`;
  if (item.rewardItemId) return 'Przedmiot Nitro';
  return 'Nagroda';
}

function rewardIcon(item: GeoDropRewardPreview | null) {
  if (item?.rewardType === 'nitro') return 'lightning-bolt';
  if (item?.rewardItemId) return 'star-four-points';
  return 'package-variant-closed';
}

function RewardCard({ item, rarityColor, winner }: { item: GeoDropRewardPreview | null; rarityColor: string; winner?: boolean }) {
  const preview = item?.previewUrl || item?.assetUrl || null;
  const canImage = !!preview && !/\.json($|\?)/i.test(preview);

  return (
    <View
      style={{
        width: CARD_W,
        height: CARD_H,
        marginHorizontal: 5,
        borderRadius: 18,
        borderWidth: winner ? 2 : 1,
        borderColor: winner ? rarityColor : 'rgba(255,255,255,0.14)',
        backgroundColor: winner ? 'rgba(239,68,68,0.18)' : '#141414',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 10,
      }}
    >
      <View
        style={{
          width: 66,
          height: 66,
          borderRadius: 18,
          backgroundColor: '#080808',
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: `${rarityColor}66`,
          marginBottom: 10,
          overflow: 'hidden',
        }}
      >
        {canImage ? (
          <Image source={{ uri: preview }} style={{ width: 66, height: 66 }} resizeMode="cover" />
        ) : (
          <MaterialCommunityIcons name={rewardIcon(item) as any} size={32} color={rarityColor} />
        )}
      </View>
      <Text
        numberOfLines={2}
        style={{
          fontFamily: 'Orbitron',
          color: '#fff',
          fontSize: 10,
          textAlign: 'center',
          fontWeight: '900',
          lineHeight: 15,
        }}
      >
        {rewardLabel(item)}
      </Text>
    </View>
  );
}

export function GeoDropClaimedModal({ visible, reward, onClose }: Props) {
  const { theme: t } = useTheme();
  const reelX = useRef(new Animated.Value(0)).current;
  const intro = useRef(new Animated.Value(0)).current;
  const chestPulse = useRef(new Animated.Value(0)).current;
  const [stage, setStage] = useState<'ready' | 'opening' | 'done'>('ready');
  const [done, setDone] = useState(false);

  const nitroAmount = Number(reward?.payload?.nitroAmount ?? 0);
  const rarityKey = String(reward?.payload?.rarity ?? 'common').toLowerCase();
  const rarity = RARITY_META[rarityKey] ?? RARITY_META.common;
  const wonReward = asRewardPreview(reward?.payload?.wonReward) ?? (
    nitroAmount > 0
      ? { rewardType: 'nitro', rewardAmount: nitroAmount, label: `${nitroAmount} Nitro`, rarity: rarityKey }
      : null
  );

  const pool = useMemo(() => {
    const rawPool = Array.isArray(reward?.payload?.rewardPool) ? reward?.payload?.rewardPool : [];
    const parsed = rawPool.map(asRewardPreview).filter(Boolean) as GeoDropRewardPreview[];
    if (parsed.length) return parsed;
    return wonReward ? [wonReward] : [{ rewardType: 'drop', label: reward?.body || 'Nagroda', rarity: rarityKey }];
  }, [rarityKey, reward?.body, reward?.payload?.rewardPool, wonReward]);

  const { reel, winnerIndex } = useMemo(() => {
    const weighted = pool.flatMap((item) => {
      const count = Math.max(1, Math.min(5, Math.round(Number(item.weight || 1))));
      return Array.from({ length: count }, () => item);
    });
    const safePool = weighted.length ? weighted : pool;
    const prefix = Array.from({ length: REEL_PREFIX }, (_, i) => safePool[i % safePool.length]);
    const suffix = Array.from({ length: REEL_SUFFIX }, (_, i) => safePool[(i + 3) % safePool.length]);
    return {
      reel: [...prefix, wonReward ?? safePool[0], ...suffix],
      winnerIndex: prefix.length,
    };
  }, [pool, wonReward]);

  useEffect(() => {
    if (!visible || !reward) return;
    setDone(false);
    setStage('ready');
    intro.setValue(0);
    reelX.setValue(50);
    chestPulse.setValue(0);

    Animated.timing(intro, {
      toValue: 1,
      duration: 520,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(chestPulse, {
          toValue: 1,
          duration: 760,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(chestPulse, {
          toValue: 0,
          duration: 760,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [chestPulse, intro, reelX, reward, visible]);

  const startOpening = () => {
    if (stage !== 'ready') return;
    const screenW = Dimensions.get('window').width;
    const finalX = (screenW / 2) - (CARD_W / 2) - (winnerIndex * (CARD_W + 10));
    setStage('opening');
    setDone(false);
    reelX.setValue(50);
    Animated.timing(reelX, {
      toValue: finalX,
      duration: 3300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setDone(true);
      setStage('done');
    });
  };

  if (!reward) return null;

  const title = rewardLabel(wonReward, nitroAmount);

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={stage === 'done' ? onClose : undefined}
    >
      <View style={{ flex: 1, backgroundColor: '#030303', overflow: 'hidden' }}>
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: 420,
            height: 420,
            borderRadius: 210,
            backgroundColor: rarity.glow,
            top: -130,
            right: -160,
            opacity: intro,
            transform: [{ scale: intro.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.15] }) }],
          }}
        />
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: 340,
            height: 340,
            borderRadius: 170,
            backgroundColor: 'rgba(239,68,68,0.20)',
            bottom: -120,
            left: -140,
            opacity: intro,
          }}
        />

        <Animated.View
          style={{
            flex: 1,
            paddingTop: 72,
            paddingBottom: 30,
            opacity: intro,
            transform: [{ translateY: intro.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
          }}
        >
          <View style={{ alignItems: 'center', paddingHorizontal: 22 }}>
            <Text style={{ fontFamily: 'Orbitron', color: rarity.color, fontSize: 11, letterSpacing: 4, fontWeight: '900' }}>
              {rarity.label} DROP
            </Text>
            <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 28, letterSpacing: 2, fontWeight: '900', marginTop: 12, textAlign: 'center' }}>
              {stage === 'ready' ? 'ZRZUT ZDOBYTY' : 'OTWIERANIE ZRZUTU'}
            </Text>
            <Text style={{ fontFamily: 'Orbitron', color: 'rgba(255,255,255,0.56)', fontSize: 10, marginTop: 10, textAlign: 'center', lineHeight: 16 }}>
              {stage === 'ready'
                ? 'Dotarles do strefy. Odbierz paczke i odpal losowanie.'
                : 'Losowanie z aktywnej puli tej kategorii'}
            </Text>
          </View>

          {stage === 'ready' ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 }}>
              <Animated.View
                style={{
                  width: 178,
                  height: 178,
                  borderRadius: 42,
                  backgroundColor: 'rgba(239,68,68,0.16)',
                  borderWidth: 2,
                  borderColor: rarity.color,
                  alignItems: 'center',
                  justifyContent: 'center',
                  shadowColor: rarity.color,
                  shadowOpacity: 0.75,
                  shadowRadius: 24,
                  transform: [{
                    scale: chestPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }),
                  }],
                }}
              >
                <MaterialCommunityIcons name="package-variant-closed" size={86} color={rarity.color} />
              </Animated.View>
              <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 15, fontWeight: '900', textAlign: 'center', marginTop: 28, letterSpacing: 1.5 }}>
                PACZKA JEST GOTOWA DO ODBIORU
              </Text>
              <Text style={{ fontFamily: 'Orbitron', color: 'rgba(255,255,255,0.52)', fontSize: 10, textAlign: 'center', marginTop: 10, lineHeight: 17 }}>
                Kliknij odbior, a system wylosuje nagrode z puli {rarity.label}.
              </Text>
            </View>
          ) : (
            <View style={{ marginTop: 54, height: CARD_H + 34, justifyContent: 'center' }}>
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: '50%',
                  width: 3,
                  marginLeft: -1.5,
                  backgroundColor: rarity.color,
                  borderRadius: 3,
                  zIndex: 4,
                  shadowColor: rarity.color,
                  shadowOpacity: 0.8,
                  shadowRadius: 12,
                }}
              />
              <View style={{ height: CARD_H + 24, overflow: 'hidden', justifyContent: 'center' }}>
                <Animated.View style={{ flexDirection: 'row', transform: [{ translateX: reelX }] }}>
                  {reel.map((item, index) => (
                    <RewardCard
                      key={`${index}_${item?.rewardType}_${item?.rewardItemId}_${item?.label}`}
                      item={item}
                      rarityColor={rarity.color}
                      winner={done && index === winnerIndex}
                    />
                  ))}
                </Animated.View>
              </View>
            </View>
          )}

          <View style={{ flex: 1, justifyContent: 'flex-end', paddingHorizontal: 24 }}>
            <View
              style={{
                borderWidth: 1,
                borderColor: stage === 'done' ? rarity.color : 'rgba(255,255,255,0.12)',
                backgroundColor: stage === 'done' ? 'rgba(239,68,68,0.14)' : 'rgba(255,255,255,0.05)',
                borderRadius: 26,
                padding: 22,
                alignItems: 'center',
              }}
            >
              <MaterialCommunityIcons
                name={stage === 'done' ? 'check-decagram' : stage === 'ready' ? 'gesture-tap-button' : 'package-variant-closed'}
                size={42}
                color={stage === 'done' || stage === 'ready' ? rarity.color : 'rgba(255,255,255,0.45)'}
              />
              <Text style={{ fontFamily: 'Orbitron', color: stage === 'done' || stage === 'ready' ? rarity.color : 'rgba(255,255,255,0.55)', fontSize: 10, letterSpacing: 3, marginTop: 14 }}>
                {stage === 'ready' ? 'ODBIOR' : stage === 'done' ? 'WYGRANA' : 'LOSOWANIE'}
              </Text>
              <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 21, fontWeight: '900', textAlign: 'center', marginTop: 10 }}>
                {stage === 'ready' ? 'Odbierz zrzut' : stage === 'done' ? title : 'Trwa otwieranie...'}
              </Text>
              {!!reward.body && stage === 'done' ? (
                <Text style={{ fontFamily: 'Orbitron', color: t.textDim, fontSize: 11, textAlign: 'center', marginTop: 8 }}>
                  {reward.body}
                </Text>
              ) : null}
              <TouchableOpacity
                disabled={stage === 'opening'}
                style={{
                  width: '100%',
                  marginTop: 20,
                  backgroundColor: stage !== 'opening' ? rarity.color : 'rgba(255,255,255,0.12)',
                  borderRadius: 16,
                  paddingVertical: 15,
                  alignItems: 'center',
                  opacity: stage !== 'opening' ? 1 : 0.55,
                }}
                onPress={stage === 'ready' ? startOpening : onClose}
                activeOpacity={0.86}
              >
                <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: stage !== 'opening' && rarityKey === 'common' ? '#111' : '#fff', fontWeight: '900', letterSpacing: 1.2 }}>
                  {stage === 'ready' ? 'ODBIERZ ZRZUT' : stage === 'done' ? 'ODEBRANE' : 'LOSOWANIE...'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
