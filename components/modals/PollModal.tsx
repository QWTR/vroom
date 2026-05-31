import React, { useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, Pressable,
  ActivityIndicator, Animated,
} from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import type { PollData } from '../../hooks/usePolls';

type Props = {
  visible: boolean;
  poll:    PollData;
  onVote:  (optionIdx: number) => Promise<boolean>;
  onClose: () => void;
};

export function PollModal({ visible, poll, onVote, onClose }: Props) {
    const { theme: t, isDark } = useTheme();
    const [selected,  setSelected]  = useState<number | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [showResults, setShowResults] = useState(poll.myVote !== null);

    const totalVotes = poll.voteCounts.reduce((a, b) => a + b, 0) || 1;

    const handleVote = async () => {
    if (selected === null) return;
    setSubmitting(true);
    const ok = await onVote(selected);  // ← tylko optionIdx
    if (ok) setShowResults(true);
    setSubmitting(false);
    };

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <Pressable
          style={{
            flex: 1, backgroundColor: '#000000aa',
            justifyContent: 'center', alignItems: 'center', padding: 20,
          }}
          onPress={onClose}
        >
        <Pressable onPress={e => e.stopPropagation()}>
        <View style={{
            width: '100%', maxWidth: 400,
            backgroundColor: t.surface,
            borderRadius: 24, padding: 24,
            borderWidth: 1, borderColor: '#a855f740',
            }}>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                <View style={{
                width: 44, height: 44, borderRadius: 13,
                backgroundColor: '#a855f720', borderWidth: 1, borderColor: '#a855f740',
                alignItems: 'center', justifyContent: 'center',
                }}>
                <Text style={{ fontSize: 22 }}>📊</Text>
                </View>
                <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: '#a855f7', letterSpacing: 3 }}>
                    ANKIETA VROOM
                </Text>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: t.textDim, marginTop: 2 }}>
                    Zagłosuj raz · Wyniki na żywo
                </Text>
                </View>
                <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
                    <MaterialIcons name="close" size={20} color={t.textDim} />
                </TouchableOpacity>
            </View>

            {/* Pytanie */}
            <Text style={{
                fontFamily: 'Orbitron', fontSize: 14, color: t.text,
                fontWeight: '700', marginBottom: 20, lineHeight: 22,
            }}>
                {poll.question}
            </Text>

            {/* Opcje */}
            <View style={{ gap: 10, marginBottom: 20 }}>
                {poll.options.map((option, i) => {
                const pct     = Math.round((poll.voteCounts[i] / totalVotes) * 100);
                const isMyVote = poll.myVote === i || selected === i;

                return (
                    <TouchableOpacity
                    key={i}
                    onPress={() => !showResults && setSelected(i)}
                    disabled={showResults}
                    activeOpacity={0.8}
                    style={{
                        borderRadius: 12, overflow: 'hidden',
                        borderWidth: 1.5,
                        borderColor: isMyVote ? '#a855f7' : (isDark ? '#ffffff15' : '#00000015'),
                    }}
                    >
                    {/* Progress bar background */}
                    {showResults && (
                        <View style={{
                        position: 'absolute', top: 0, left: 0, bottom: 0,
                        width: `${pct}%`, backgroundColor: isMyVote ? '#a855f720' : (isDark ? '#ffffff08' : '#00000008'),
                        }} />
                    )}
                    <View style={{
                        flexDirection: 'row', alignItems: 'center',
                        paddingHorizontal: 14, paddingVertical: 12, gap: 10,
                    }}>
                        {/* Radio */}
                        {!showResults && (
                        <View style={{
                            width: 18, height: 18, borderRadius: 9,
                            borderWidth: 2,
                            borderColor: selected === i ? '#a855f7' : (isDark ? '#ffffff30' : '#00000030'),
                            backgroundColor: selected === i ? '#a855f720' : 'transparent',
                            alignItems: 'center', justifyContent: 'center',
                        }}>
                            {selected === i && (
                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#a855f7' }} />
                            )}
                        </View>
                        )}

                        <Text style={{
                        flex: 1, fontFamily: 'Orbitron', fontSize: 10,
                        color: isMyVote ? t.text : t.textMuted,
                        fontWeight: isMyVote ? '700' : '400',
                        }}>
                        {option}
                        </Text>

                        {showResults && (
                        <Text style={{
                            fontFamily: 'Orbitron', fontSize: 11,
                            color: isMyVote ? '#a855f7' : t.textDim, fontWeight: '700',
                        }}>
                            {pct}%
                        </Text>
                        )}
                        {showResults && isMyVote && (
                        <MaterialIcons name="how-to-vote" size={14} color="#a855f7" />
                        )}
                    </View>
                    </TouchableOpacity>
                );
                })}
            </View>

            {/* Liczba głosów */}
            {showResults && (
                <Text style={{
                fontFamily: 'Orbitron', fontSize: 8, color: t.textDim,
                textAlign: 'center', marginBottom: 16, letterSpacing: 1,
                }}>
                {poll.totalVotes} głosów łącznie
                </Text>
            )}

            {/* Przyciski */}
            {!showResults ? (
                <TouchableOpacity
                style={[{
                    backgroundColor: '#a855f7', borderRadius: 14,
                    paddingVertical: 14, alignItems: 'center',
                    flexDirection: 'row', justifyContent: 'center', gap: 8,
                }, (selected === null || submitting) && { opacity: 0.5 }]}
                onPress={handleVote}
                disabled={selected === null || submitting}
                activeOpacity={0.85}
                >
                {submitting
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <MaterialCommunityIcons name="vote" size={16} color="#fff" />
                }
                <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: '#fff', fontWeight: '700' }}>
                    ZAGŁOSUJ
                </Text>
                </TouchableOpacity>
            ) : (
                <TouchableOpacity
                style={{
                    backgroundColor: isDark ? '#ffffff10' : '#00000008',
                    borderRadius: 14, paddingVertical: 14,
                    alignItems: 'center', borderWidth: 1,
                    borderColor: isDark ? '#ffffff15' : '#00000015',
                }}
                onPress={onClose}
                activeOpacity={0.85}
                >
                <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: t.textDim }}>
                    ZAMKNIJ
                </Text>
                </TouchableOpacity>
            )}
            </View>
        </Pressable>
        </Pressable>
        </Modal>
    );
}