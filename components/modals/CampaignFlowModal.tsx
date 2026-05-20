import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, ActivityIndicator,
  ScrollView, Image, SafeAreaView, Dimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../contexts/ThemeContext';
import type { ActiveCampaign, CampaignStep } from '../../hooks/useEntryCampaign';

const { width: SCREEN_W } = Dimensions.get('window');

type Props = {
  visible: boolean;
  campaign: ActiveCampaign;
  onClaimGift: (giftId: number) => Promise<boolean>;
  onVotePoll: (pollId: number, optionIdx: number) => Promise<boolean>;
  onComplete: () => Promise<void>;
  onClose: () => void;
};

export function CampaignFlowModal({
  visible,
  campaign,
  onClaimGift,
  onVotePoll,
  onComplete,
  onClose,
}: Props) {
  const { theme: t } = useTheme();
  const [stepIdx, setStepIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [giftClaimed, setGiftClaimed] = useState(false);
  const [pollSelected, setPollSelected] = useState<number | null>(null);
  const [pollDone, setPollDone] = useState(false);

  const steps = campaign.steps;
  const step = steps[stepIdx] as CampaignStep | undefined;
  const isLast = stepIdx >= steps.length - 1;

  useEffect(() => {
    if (!visible) return;
    setStepIdx(0);
    setBusy(false);
    setGiftClaimed(false);
    setPollSelected(null);
    setPollDone(false);
  }, [visible, campaign.id]);

  const advance = async () => {
    if (isLast) {
      setBusy(true);
      await onComplete();
      setBusy(false);
      onClose();
      return;
    }
    setStepIdx((i) => i + 1);
    setGiftClaimed(false);
    setPollSelected(null);
    setPollDone(false);
  };

  const handleGiftClaim = async () => {
    if (step?.type !== 'gift') return;
    setBusy(true);
    const ok = await onClaimGift(step.gift.id);
    if (ok) setGiftClaimed(true);
    setBusy(false);
  };

  const handlePollVote = async () => {
    if (step?.type !== 'poll' || pollSelected === null) return;
    setBusy(true);
    const ok = await onVotePoll(step.poll.id, pollSelected);
    if (ok) setPollDone(true);
    setBusy(false);
  };

  if (!visible || !step) return null;

  return (
    <Modal visible animationType="fade" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <LinearGradient
          colors={['#e3383528', t.bg, t.bg]}
          style={{ flex: 1 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 }}>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: t.textDim, letterSpacing: 2 }}>
              {stepIdx + 1} / {steps.length}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <MaterialIcons name="close" size={22} color={t.textDim} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 32 }}>
            {step.type === 'gift' && (
              <View style={{ alignItems: 'center' }}>
                <View style={{
                  width: 120, height: 120, borderRadius: 32,
                  backgroundColor: '#f5c51825', borderWidth: 2, borderColor: '#f5c51855',
                  alignItems: 'center', justifyContent: 'center', marginBottom: 24,
                  transform: [{ scale: giftClaimed ? 1.05 : 1 }],
                }}>
                  <Text style={{ fontSize: 56 }}>{giftClaimed ? '✅' : step.gift.icon || '🎁'}</Text>
                </View>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#f5c518', letterSpacing: 3, marginBottom: 12 }}>
                  {giftClaimed ? 'ODEBRANO!' : 'MASZ PREZENT'}
                </Text>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 22, color: t.text, fontWeight: '900', textAlign: 'center', marginBottom: 12 }}>
                  {step.gift.title}
                </Text>
                {!!step.gift.description && (
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: t.textDim, textAlign: 'center', lineHeight: 18, marginBottom: 28 }}>
                    {step.gift.description}
                  </Text>
                )}
                {!giftClaimed ? (
                  <TouchableOpacity
                    onPress={handleGiftClaim}
                    disabled={busy}
                    style={{ backgroundColor: '#f5c518', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 32, minWidth: SCREEN_W * 0.7, alignItems: 'center' }}
                  >
                    {busy ? <ActivityIndicator color="#000" /> : (
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: '#000', fontWeight: '800' }}>OTWÓRZ PREZENT</Text>
                    )}
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    onPress={advance}
                    style={{ backgroundColor: t.surface2, borderRadius: 16, paddingVertical: 16, paddingHorizontal: 32, minWidth: SCREEN_W * 0.7, alignItems: 'center', borderWidth: 1, borderColor: t.border }}
                  >
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: t.text, fontWeight: '700' }}>{isLast ? 'ZAKOŃCZ' : 'DALEJ'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {step.type === 'poll' && (
              <View>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#a855f7', letterSpacing: 3, marginBottom: 16, textAlign: 'center' }}>
                  ANKIETA
                </Text>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 18, color: t.text, fontWeight: '800', textAlign: 'center', marginBottom: 24, lineHeight: 26 }}>
                  {step.poll.question}
                </Text>
                {step.poll.options.map((opt, i) => {
                  const selected = pollSelected === i;
                  const disabled = pollDone;
                  return (
                    <TouchableOpacity
                      key={i}
                      disabled={disabled}
                      onPress={() => setPollSelected(i)}
                      style={{
                        marginBottom: 10, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14,
                        backgroundColor: selected ? '#a855f722' : t.surface2,
                        borderWidth: 1.5, borderColor: selected ? '#a855f7' : t.border,
                        opacity: disabled && !selected ? 0.5 : 1,
                      }}
                    >
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: t.text }}>{opt}</Text>
                    </TouchableOpacity>
                  );
                })}
                {!pollDone ? (
                  <TouchableOpacity
                    onPress={handlePollVote}
                    disabled={busy || pollSelected === null}
                    style={{ marginTop: 20, backgroundColor: '#a855f7', borderRadius: 16, paddingVertical: 16, alignItems: 'center', opacity: pollSelected === null ? 0.4 : 1 }}
                  >
                    {busy ? <ActivityIndicator color="#fff" /> : (
                      <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: '#fff', fontWeight: '800' }}>GŁOSUJ</Text>
                    )}
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    onPress={advance}
                    style={{ marginTop: 20, backgroundColor: t.surface2, borderRadius: 16, paddingVertical: 16, alignItems: 'center', borderWidth: 1, borderColor: t.border }}
                  >
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: t.text, fontWeight: '700' }}>{isLast ? 'ZAKOŃCZ' : 'DALEJ'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {(step.type === 'announcement' || step.type === 'custom') && (
              <View style={{ alignItems: 'center' }}>
                {step.type === 'announcement' && step.announcement.coverImage ? (
                  <Image source={{ uri: step.announcement.coverImage }} style={{ width: SCREEN_W - 48, height: 180, borderRadius: 16, marginBottom: 20 }} resizeMode="cover" />
                ) : null}
                {step.type === 'custom' && step.custom.imageUrl ? (
                  <Image source={{ uri: step.custom.imageUrl }} style={{ width: SCREEN_W - 48, height: 180, borderRadius: 16, marginBottom: 20 }} resizeMode="cover" />
                ) : null}
                <Text style={{ fontSize: 48, marginBottom: 16 }}>
                  {step.type === 'custom' ? step.custom.icon : '📢'}
                </Text>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 20, color: t.text, fontWeight: '900', textAlign: 'center', marginBottom: 16 }}>
                  {step.type === 'announcement' ? step.announcement.title : step.custom.title}
                </Text>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: t.textDim, textAlign: 'center', lineHeight: 20, marginBottom: 28 }}>
                  {step.type === 'announcement' ? step.announcement.content : step.custom.body}
                </Text>
                <TouchableOpacity
                  onPress={advance}
                  disabled={busy}
                  style={{ backgroundColor: '#e33835', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 32, minWidth: SCREEN_W * 0.7, alignItems: 'center' }}
                >
                  {busy ? <ActivityIndicator color="#fff" /> : (
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: '#fff', fontWeight: '800' }}>
                      {step.type === 'custom' ? step.custom.ctaLabel : (isLast ? 'ZAKOŃCZ' : 'DALEJ')}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </LinearGradient>
      </SafeAreaView>
    </Modal>
  );
}
