import React, { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, FlatList,
  StyleSheet, Platform, StatusBar, SafeAreaView,
  Image, ActivityIndicator, Linking, Dimensions,
  BackHandler,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Video, ResizeMode } from 'expo-av';
import { useTheme } from '../../contexts/ThemeContext';
import {
  Announcement,
  useAnnouncements,
  categoryColor,
  categoryEmoji,
  categoryLabel,
} from '../../hooks/useAnnouncements';
import { LinkedText } from '../LinkedText';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';
const { width } = Dimensions.get('window');

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function AnnouncementsModal({ visible, onClose }: Props) {
  const { theme: t } = useTheme();
  const {
    announcements, loading,
    seenIds, load, markSeen, markAllSeen,
  } = useAnnouncements();

  const [selected, setSelected] = useState<Announcement | null>(null);

  useEffect(() => {
    if (visible) load();
  }, [visible]);

  useEffect(() => {
    if (visible && announcements.length > 0) {
      markAllSeen(announcements.map(a => a.id));
    }
  }, [visible, announcements]);

  // BackHandler przez ref
  const selectedRef = useRef<Announcement | null>(null);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selectedRef.current) { setSelected(null); return true; }
      onClose(); return true;
    });
    return () => sub.remove();
  }, [visible]);
  useModalBackHandler(visible, onClose);
  // ── LISTA ─────────────────────────────────────────────
  const renderList = () => (
    <SafeAreaView style={[ss.root, { backgroundColor: t.bg }]} onRequestClose={onClose}>
      {/* Header */}
      <View style={[ss.header, { borderBottomColor: t.border2 }]}>
        <TouchableOpacity
          style={[ss.iconBtn, { backgroundColor: t.surface2, borderColor: t.border2 }]}
          onPress={onClose}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <MaterialIcons name="close" size={18} color={t.textMuted} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={[ss.headerTitle, { color: t.text }]}>OGŁOSZENIA</Text>
          <Text style={[ss.headerSub, { color: t.textDim }]}>
            {announcements.length} {announcements.length === 1 ? 'ogłoszenie' : 'ogłoszeń'}
          </Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      {loading && announcements.length === 0 ? (
        <View style={ss.emptyBox}>
          <ActivityIndicator size="large" color={t.primary} />
          <Text style={[ss.emptyTitle, { color: t.textDim, marginTop: 12 }]}>ŁADOWANIE...</Text>
        </View>
      ) : (
        <FlatList
          data={announcements}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={ss.emptyBox}>
              <Text style={{ fontSize: 48 }}>📢</Text>
              <Text style={[ss.emptyTitle, { color: t.textDim }]}>BRAK OGŁOSZEŃ</Text>
              <Text style={[ss.emptySub, { color: t.textFaint }]}>
                Tu pojawią się nowe informacje od nas
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const accent = categoryColor(item.category);
            const unseen = !seenIds.includes(item.id);
            return (
              <TouchableOpacity
                onPress={() => { setSelected(item); markSeen(item.id); }}
                activeOpacity={0.85}
              >
                <View style={[ss.card, {
                  backgroundColor: t.surface,
                  borderColor: unseen ? accent + '60' : t.border2,
                }]}>
                  {/* Pinned badge */}
                  {item.pinned && (
                    <View style={[ss.pinnedBadge, {
                      backgroundColor: accent + '20',
                      borderColor:     accent + '40',
                    }]}>
                      <MaterialIcons name="push-pin" size={10} color={accent} />
                      <Text style={[ss.pinnedText, { color: accent }]}>PRZYPIĘTE</Text>
                    </View>
                  )}

                  {/* Cover image */}
                  {item.coverImage && (
                    <Image
                      source={{ uri: item.coverImage }}
                      style={ss.cardBanner}
                      resizeMode="cover"
                    />
                  )}

                  <View style={{ padding: 14 }}>
                    {/* Kategoria chip */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <View style={[ss.catChip, { backgroundColor: accent + '18', borderColor: accent + '35' }]}>
                        <Text style={{ fontSize: 10 }}>{categoryEmoji(item.category)}</Text>
                        <Text style={[ss.catChipText, { color: accent }]}>
                          {categoryLabel(item.category)}
                        </Text>
                      </View>
                      {unseen && <View style={[ss.unseenDot, { backgroundColor: accent }]} />}
                    </View>

                    {/* Tytuł */}
                    <Text style={[ss.cardTitle, { color: t.text }]} numberOfLines={2}>
                      {item.title}
                    </Text>

                    {/* Excerpt / preview contentu */}
                    <Text style={[ss.cardBody, { color: t.textDim }]} numberOfLines={2}>
                      {item.excerpt ?? item.content}
                    </Text>

                    {/* Footer */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
                      <Text style={[ss.cardDate, { color: t.textFaint }]}>
                        {new Date(item.createdAt).toLocaleDateString('pl-PL', {
                          day: '2-digit', month: 'short', year: 'numeric',
                        })}
                      </Text>
                      <View style={[ss.readMore, { backgroundColor: accent + '18', borderColor: accent + '30' }]}>
                        <Text style={[ss.readMoreText, { color: accent }]}>CZYTAJ</Text>
                        <MaterialIcons name="arrow-forward-ios" size={9} color={accent} />
                      </View>
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </SafeAreaView>
  );

  // ── DETAIL ────────────────────────────────────────────
  const renderDetail = (item: Announcement) => {
    const accent = categoryColor(item.category);
    return (
      <SafeAreaView style={[ss.root, { backgroundColor: t.bg }]}>
        {/* Header */}
        <View style={[ss.header, { borderBottomColor: t.border2 }]}>
          <TouchableOpacity
            style={[ss.iconBtn, { backgroundColor: t.surface2, borderColor: t.border2 }]}
            onPress={() => setSelected(null)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <MaterialIcons name="arrow-back" size={18} color={t.textMuted} />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={[ss.headerTitle, { color: t.text }]}>OGŁOSZENIE</Text>
          </View>
          <View style={{ width: 36 }} />
        </View>

        <FlatList
          data={[item]} // jeden element — używamy ListHeaderComponent na treść
          keyExtractor={i => `detail_${i.id}`}
          showsVerticalScrollIndicator={false}
          renderItem={() => null}
          ListHeaderComponent={
            <View>
              {/* Cover */}
              {item.coverImage && (
                <Image
                  source={{ uri: item.coverImage }}
                  style={ss.detailBanner}
                  resizeMode="cover"
                />
              )}

              <View style={{ padding: 20 }}>
                {/* Pinned */}
                {item.pinned && (
                  <View style={[ss.pinnedBadge, {
                    backgroundColor: accent + '20',
                    borderColor: accent + '40',
                    alignSelf: 'flex-start', marginBottom: 12,
                  }]}>
                    <MaterialIcons name="push-pin" size={10} color={accent} />
                    <Text style={[ss.pinnedText, { color: accent }]}>PRZYPIĘTE</Text>
                  </View>
                )}

                {/* Kategoria */}
                <View style={[ss.catChip, { backgroundColor: accent + '18', borderColor: accent + '35', alignSelf: 'flex-start', marginBottom: 14 }]}>
                  <Text style={{ fontSize: 12 }}>{categoryEmoji(item.category)}</Text>
                  <Text style={[ss.catChipText, { color: accent, fontSize: 9 }]}>
                    {categoryLabel(item.category)}
                  </Text>
                </View>

                {/* Tytuł */}
                <Text style={[ss.detailTitle, { color: t.text }]}>{item.title}</Text>

                {/* Excerpt jako lead */}
                {item.excerpt && (
                <LinkedText
                    style={[ss.detailExcerpt, { color: t.textMuted }]}
                    linkStyle={{ color: t.primary }}
                >
                    {item.excerpt}
                </LinkedText>
                )}
                {/* Data */}
                <Text style={[ss.cardDate, { color: t.textFaint, marginTop: 6, marginBottom: 16 }]}>
                  {new Date(item.createdAt).toLocaleDateString('pl-PL', {
                    day: '2-digit', month: 'long', year: 'numeric',
                  })}
                </Text>

                {/* Divider */}
                <View style={[ss.divider, { backgroundColor: accent + '30' }]} />

                {/* Content — pełna treść */}
                <LinkedText
                    style={[ss.detailBody, { color: t.text }]}
                    linkStyle={{ color: t.primary }}
                    >
                    {item.content}
                </LinkedText>
              </View>
            </View>
          }
          ListFooterComponent={<View style={{ height: 48 }} />}
        />
      </SafeAreaView>
    );
  };

  return (
    <Modal onRequestClose={onClose} visible={visible} animationType="slide" transparent={false} statusBarTranslucent>
      <StatusBar barStyle="light-content" backgroundColor={t.bg} />
      {selected ? renderDetail(selected) : renderList()}
    </Modal>
  );
}

const ss = StyleSheet.create({
  root:   { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop:    Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) + 8 : 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  iconBtn:     { width: 36, height: 36, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: 'Orbitron', fontSize: 12, fontWeight: '900', letterSpacing: 2 },
  headerSub:   { fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 1, marginTop: 2 },

  card:       { borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  cardBanner: { width: '100%', height: 160 },

  pinnedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, margin: 10, marginBottom: 0 },
  pinnedText:  { fontFamily: 'Orbitron', fontSize: 7, fontWeight: '700', letterSpacing: 1 },

  catChip:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  catChipText: { fontFamily: 'Orbitron', fontSize: 8, fontWeight: '700', letterSpacing: 1 },

  cardTitle:   { fontFamily: 'Orbitron', fontSize: 13, fontWeight: '900', letterSpacing: 0.5, marginBottom: 6 },
  cardBody:    { fontFamily: 'Orbitron', fontSize: 9, lineHeight: 16, letterSpacing: 0.3 },
  cardDate:    { fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 1 },
  unseenDot:   { width: 8, height: 8, borderRadius: 4 },
  readMore:    { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  readMoreText:{ fontFamily: 'Orbitron', fontSize: 8, fontWeight: '700', letterSpacing: 1 },

  detailBanner:  { width: '100%', height: 220 },
  detailTitle:   { fontFamily: 'Orbitron', fontSize: 20, fontWeight: '900', letterSpacing: 0.5, lineHeight: 28, marginBottom: 8 },
  detailExcerpt: { fontFamily: 'Orbitron', fontSize: 11, lineHeight: 18, letterSpacing: 0.3 },
  detailBody:    { fontFamily: 'Orbitron', fontSize: 11, lineHeight: 20, letterSpacing: 0.3 },
  divider:       { height: 1, marginVertical: 16 },

  emptyBox:   { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontFamily: 'Orbitron', fontSize: 10, letterSpacing: 3 },
  emptySub:   { fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 0.5, textAlign: 'center', paddingHorizontal: 40, lineHeight: 14 },
});