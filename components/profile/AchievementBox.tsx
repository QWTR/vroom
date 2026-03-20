import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Modal, Pressable,
} from 'react-native';

const RARITY_COLORS = {
  common:    { border: '#ffffff20', bg: '#ffffff05', dot: '#ffffff60', label: 'COMMON',    labelColor: '#ffffff60' },
  rare:      { border: '#38a5e340', bg: '#38a5e310', dot: '#38a5e3',   label: 'RARE',      labelColor: '#38a5e3'   },
  epic:      { border: '#a338e340', bg: '#a338e310', dot: '#a338e3',   label: 'EPIC',      labelColor: '#a338e3'   },
  legendary: { border: '#f5c51860', bg: '#f5c51815', dot: '#f5c518',   label: 'LEGENDARY', labelColor: '#f5c518'   },
};

const CATEGORY_LABELS: Record<string, string> = {
  distance: '🛣️  Dystans',
  speed:    '⚡  Prędkość',
  streak:   '🔥  Streak',
  social:   '👥  Społeczność',
  special:  '⭐  Specjalne',
};

interface Props {
  icon:           string;
  label:          string;
  active:         boolean;
  rarity?:        'common' | 'rare' | 'epic' | 'legendary';
  progress?:      number;
  points?:        number;
  description?:   string;
  category?:      string;
  currentValue?:  number;
  conditionValue?: number;
  conditionField?: string;
  unlockedAt?:    string | null;
}

export default function AchievementBox({
  icon, label, active,
  rarity = 'common', progress = 0, points,
  description, category, currentValue, conditionValue,
  conditionField, unlockedAt,
}: Props) {
  const [modalVisible, setModalVisible] = useState(false);
  const rc = RARITY_COLORS[rarity] ?? RARITY_COLORS.common;

  const unlockedDate = unlockedAt
    ? new Date(unlockedAt).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <>
      {/* ── KAFELEK ── */}
      <TouchableOpacity
        activeOpacity={0.75}
        onPress={() => setModalVisible(true)}
        style={[
          styles.box,
          active
            ? { borderColor: rc.border, backgroundColor: rc.bg }
            : styles.boxInactive,
        ]}
      >
        <Text style={[styles.emoji, !active && styles.emojiInactive]}>{icon}</Text>

        <Text style={[styles.label, !active && styles.labelInactive]} numberOfLines={2}>
          {label}
        </Text>

        {active && !!points && points > 0 && (
          <Text style={styles.points}>+{points}</Text>
        )}

        {!active && progress > 0 && progress < 100 && (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress}%` as any }]} />
          </View>
        )}

        {active && <View style={[styles.dot, { backgroundColor: rc.dot }]} />}
      </TouchableOpacity>

      {/* ── MODAL SZCZEGÓŁÓW ── */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setModalVisible(false)}>
          <Pressable style={styles.card} onPress={() => {}}>

            {/* Ikona + status */}
            <View style={[styles.modalIconWrap, { borderColor: rc.border, backgroundColor: rc.bg }]}>
              <Text style={styles.modalEmoji}>{icon}</Text>
              {active && <View style={[styles.modalDot, { backgroundColor: rc.dot }]} />}
            </View>

            {/* Rzadkość */}
            <Text style={[styles.rarityBadge, { color: rc.labelColor, borderColor: rc.border }]}>
              {rc.label}
            </Text>

            {/* Nazwa */}
            <Text style={styles.modalTitle}>{label}</Text>

            {/* Opis */}
            {!!description && (
              <Text style={styles.modalDesc}>{description}</Text>
            )}

            {/* Divider */}
            <View style={styles.divider} />

            {/* Szczegóły */}
            <View style={styles.detailsGrid}>

              {/* Kategoria */}
              {!!category && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailKey}>KATEGORIA</Text>
                  <Text style={styles.detailVal}>{CATEGORY_LABELS[category] ?? category}</Text>
                </View>
              )}

              {/* Punkty */}
              {!!points && points > 0 && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailKey}>NAGRODA</Text>
                  <Text style={[styles.detailVal, { color: '#f5c518' }]}>⭐ {points} punktów</Text>
                </View>
              )}

              {/* Postęp */}
              {!active && conditionValue != null && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailKey}>POSTĘP</Text>
                  <Text style={styles.detailVal}>
                    {currentValue ?? 0} / {conditionValue}
                    {'  '}
                    <Text style={{ color: '#e33835' }}>({progress}%)</Text>
                  </Text>
                </View>
              )}

              {/* Warunek */}
              {!!conditionField && conditionValue != null && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailKey}>WARUNEK</Text>
                  <Text style={styles.detailVal}>
                    {conditionField} ≥ {conditionValue}
                  </Text>
                </View>
              )}

              {/* Data odblokowania */}
              {active && !!unlockedDate && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailKey}>ODBLOKOWANO</Text>
                  <Text style={[styles.detailVal, { color: '#4de926' }]}>✓ {unlockedDate}</Text>
                </View>
              )}

              {/* Zablokowane */}
              {!active && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailKey}>STATUS</Text>
                  <Text style={[styles.detailVal, { color: '#ffffff40' }]}>🔒 Zablokowane</Text>
                </View>
              )}
            </View>

            {/* Pasek postępu w modalu */}
            {!active && progress > 0 && (
              <View style={styles.modalProgressWrap}>
                <View style={styles.modalProgressTrack}>
                  <View style={[styles.modalProgressFill, { width: `${progress}%` as any }]} />
                </View>
                <Text style={styles.modalProgressLabel}>{progress}% ukończone</Text>
              </View>
            )}

            {/* Zamknij */}
            <TouchableOpacity style={styles.closeBtn} onPress={() => setModalVisible(false)}>
              <Text style={styles.closeBtnText}>ZAMKNIJ</Text>
            </TouchableOpacity>

          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // ── KAFELEK ──────────────────────────────────────────────────────
  box: {
    width:           '31%',
    aspectRatio:     1,
    backgroundColor: '#1a1a1a',
    borderRadius:    14,
    borderWidth:     1,
    padding:         8,
    alignItems:      'center',
    justifyContent:  'center',
    gap:             3,
    position:        'relative',
  },
  boxInactive: {
    backgroundColor: '#111111',
    borderColor:     '#ffffff08',
    opacity:         0.55,
  },
  emoji:         { fontSize: 26 },
  emojiInactive: { opacity: 0.25 },
  label: {
    fontFamily: 'Orbitron',
    color:      '#ffffffcc',
    fontSize:   7,
    textAlign:  'center',
    lineHeight: 10,
  },
  labelInactive: { color: '#ffffff35' },
  points: {
    fontFamily: 'Orbitron',
    color:      '#f5c518',
    fontSize:   7,
  },
  progressTrack: {
    width:           '85%',
    height:          2,
    backgroundColor: '#ffffff0f',
    borderRadius:    2,
    marginTop:       3,
    overflow:        'hidden',
  },
  progressFill: {
    height:          2,
    backgroundColor: '#e33835',
    borderRadius:    2,
  },
  dot: {
    position:     'absolute',
    top:          6,
    right:        6,
    width:        6,
    height:       6,
    borderRadius: 3,
  },

  // ── MODAL ─────────────────────────────────────────────────────────
  backdrop: {
    flex:            1,
    backgroundColor: '#000000cc',
    justifyContent:  'center',
    alignItems:      'center',
    padding:         24,
  },
  card: {
    width:           '100%',
    backgroundColor: '#1a1a1a',
    borderRadius:    20,
    borderWidth:     1,
    borderColor:     '#ffffff15',
    padding:         24,
    alignItems:      'center',
    gap:             10,
  },
  modalIconWrap: {
    width:           80,
    height:          80,
    borderRadius:    20,
    borderWidth:     2,
    alignItems:      'center',
    justifyContent:  'center',
    position:        'relative',
    marginBottom:    4,
  },
  modalEmoji: { fontSize: 40 },
  modalDot: {
    position:     'absolute',
    top:          6,
    right:        6,
    width:        10,
    height:       10,
    borderRadius: 5,
  },
  rarityBadge: {
    fontFamily:   'Orbitron',
    fontSize:     9,
    letterSpacing: 2,
    borderWidth:  1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical:    4,
  },
  modalTitle: {
    fontFamily: 'Orbitron',
    fontSize:   18,
    color:      '#fff',
    fontWeight: '700',
    textAlign:  'center',
  },
  modalDesc: {
    fontFamily: 'Orbitron',
    fontSize:   11,
    color:      '#ffffff60',
    textAlign:  'center',
    lineHeight: 18,
  },
  divider: {
    width:           '100%',
    height:          1,
    backgroundColor: '#ffffff10',
    marginVertical:  4,
  },
  detailsGrid: {
    width: '100%',
    gap:   8,
  },
  detailRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
  },
  detailKey: {
    fontFamily:    'Orbitron',
    fontSize:      9,
    color:         '#ffffff30',
    letterSpacing: 1,
  },
  detailVal: {
    fontFamily: 'Orbitron',
    fontSize:   10,
    color:      '#ffffffcc',
    flexShrink: 1,
    textAlign:  'right',
  },
  modalProgressWrap: {
    width: '100%',
    gap:   6,
    marginTop: 4,
  },
  modalProgressTrack: {
    width:           '100%',
    height:          4,
    backgroundColor: '#ffffff0f',
    borderRadius:    4,
    overflow:        'hidden',
  },
  modalProgressFill: {
    height:          4,
    backgroundColor: '#e33835',
    borderRadius:    4,
  },
  modalProgressLabel: {
    fontFamily: 'Orbitron',
    fontSize:   9,
    color:      '#ffffff40',
    textAlign:  'right',
  },
  closeBtn: {
    marginTop:       8,
    backgroundColor: '#252525',
    borderRadius:    10,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderWidth:     1,
    borderColor:     '#ffffff15',
  },
  closeBtnText: {
    fontFamily:    'Orbitron',
    fontSize:      11,
    color:         '#fff',
    letterSpacing: 2,
  },
});