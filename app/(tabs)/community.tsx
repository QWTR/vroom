import React, { useRef } from 'react';
import {
  View, Text, TouchableOpacity, StatusBar, ScrollView,
  Animated, Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../contexts/ThemeContext';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 16 * 2 - 12) / 2;

const communityMenu = [
  {
    label:   'WYDARZENIA',
    desc:    'Meety, zloty i eventy w Twojej okolicy.',
    route:   '/Community/meets/events',
    icon:    'calendar',
    iconLib: 'feather',
    accent:  '#e33835',
    tag:     null,
  },
  {
    label:   'RANKINGI',
    desc:    'Ogólny Ranking VROOM.',
    route:   '/Community/Ranks/stats',
    icon:    'bar-chart-2',
    iconLib: 'feather',
    accent:  '#e33835',
    tag:     null,
  },
  {
    label:   'CHAT',
    desc:    'Dodawaj znajomych i twórz grupy.',
    route:   '/Community/chats/chats',
    icon:    'account-group-outline',
    iconLib: 'material',
    accent:  '#e33835',
    tag:     null,
  },
  {
    label:   'DYSKUSJE',
    desc:    'Posty, komentarze i więcej.',
    route:   '/Community/community/community',
    icon:    'forum',
    iconLib: 'material',
    accent:  '#e33835',
    tag:     null,
  },
  {
    label:   'GIEŁDA',
    desc:    'Kup lub sprzedaj auto, motocykl lub części.',
    route:   '/Community/market/market',
    icon:    'tag-multiple-outline',
    iconLib: 'material',
    accent:  '#e33835',
    tag:     'NOWE',
  },
  {
    label:   'KLUBY',
    desc:    'Dołącz lub stwórz własny klub — czat, rangi, moderacja.',
    route:   '/Community/clubs/clubs',
    icon:    'shield-crown-outline',
    iconLib: 'material',
    accent:  '#00bfff',
    tag:     'NOWE',
  },
  {
    label:   'THE GRID',
    desc:    'Arena 1v1 — postaw auto do walki i zdobądź uznanie!',
    route:   '/Community/grid/grid',
    icon:    'flag-checkered',
    iconLib: 'material',
    accent:  '#FFD700',
    tag:     'NOWE',
  },
];

const GRID_ITEMS  = communityMenu.slice(0, 4);
const LIST_ITEMS  = communityMenu.slice(4);

/* ─── Animated press wrapper ─────────────────────────────── */
function PressCard({
  item,
  style,
  children,
}: {
  item: (typeof communityMenu)[0];
  style?: any;
  children: React.ReactNode;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const router = useRouter();

  const onPressIn  = () => Animated.spring(scale, { toValue: 0.95, useNativeDriver: true, speed: 40 }).start();
  const onPressOut = () => Animated.spring(scale, { toValue: 1,    useNativeDriver: true, speed: 40 }).start();

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <TouchableOpacity
        activeOpacity={1}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        onPress={() => router.push(item.route as any)}
      >
        {children}
      </TouchableOpacity>
    </Animated.View>
  );
}

/* ─── Icon helper ────────────────────────────────────────── */
function MenuIcon({ item, size, color }: { item: (typeof communityMenu)[0]; size: number; color: string }) {
  return item.iconLib === 'material'
    ? <MaterialCommunityIcons name={item.icon as any} size={size} color={color} />
    : <Feather name={item.icon as any} size={size} color={color} />;
}

/* ─── Main screen ────────────────────────────────────────── */
export default function Community() {
  const { theme, isDark } = useTheme();

  const surface  = isDark ? '#111111' : '#ffffff';
  const border   = isDark ? '#222222' : '#eeeeee';
  const muted    = isDark ? '#888888' : '#aaaaaa';
  const divider  = isDark ? '#1e1e1e' : '#f0f0f0';

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />

      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >

        {/* ── HEADER ───────────────────────────────────────── */}
        <View style={{ paddingTop: 64, paddingHorizontal: 20, paddingBottom: 32 }}>
          <Text style={{
            color: theme.primary,
            fontFamily: 'Orbitron',
            fontSize: 10,
            letterSpacing: 6,
            opacity: 0.6,
            marginBottom: 8,
          }}>
            VROOM
          </Text>

          <Text style={{
            color: theme.text,
            fontFamily: 'Orbitron',
            fontSize: 28,
            fontWeight: '900',
            letterSpacing: 2,
          }}>
            SPOŁECZNOŚĆ
          </Text>

          <Text style={{
            color: muted,
            fontFamily: 'Orbitron',
            fontSize: 9,
            letterSpacing: 1,
            marginTop: 6,
          }}>
            Wybierz sekcję i dołącz do akcji
          </Text>

          {/* Divider */}
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginTop: 20,
            gap: 10,
          }}>
            <View style={{ width: 28, height: 3, backgroundColor: theme.primary, borderRadius: 2 }} />
            <View style={{ flex: 1, height: 1, backgroundColor: divider }} />
          </View>
        </View>

        {/* ── SECTION LABEL ────��───────────────────────────── */}
        <View style={{
          paddingHorizontal: 20,
          marginBottom: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        }}>
          <Feather name="grid" size={12} color={muted} />
          <Text style={{
            fontFamily: 'Orbitron',
            fontSize: 9,
            color: muted,
            letterSpacing: 2,
          }}>
            SZYBKI DOSTĘP
          </Text>
        </View>

        {/* ── 2×2 GRID ─────────────────────────────────────── */}
        <View style={{
          paddingHorizontal: 16,
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 24,
        }}>
          {GRID_ITEMS.map((item) => (
            <PressCard
              key={item.route}
              item={item}
              style={{ width: CARD_WIDTH }}
            >
              <View style={{
                backgroundColor: surface,
                borderRadius: 20,
                borderWidth: 1,
                borderColor: border,
                padding: 20,
                minHeight: 148,
                overflow: 'hidden',
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: isDark ? 0.35 : 0.07,
                shadowRadius: 12,
                elevation: 5,
              }}>

                {/* Background glow */}
                <View style={{
                  position: 'absolute',
                  top: -24,
                  right: -24,
                  width: 90,
                  height: 90,
                  borderRadius: 45,
                  backgroundColor: item.accent + '12',
                }} />

                {/* Bottom accent bar */}
                <View style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 3,
                  backgroundColor: item.accent,
                  opacity: 0.5,
                  borderBottomLeftRadius: 20,
                  borderBottomRightRadius: 20,
                }} />

                {/* Icon */}
                <View style={{
                  width: 50,
                  height: 50,
                  borderRadius: 16,
                  backgroundColor: item.accent + '18',
                  borderWidth: 1,
                  borderColor: item.accent + '35',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 14,
                }}>
                  <MenuIcon item={item} size={24} color={item.accent} />
                </View>

                {/* Label */}
                <Text style={{
                  color: theme.text,
                  fontFamily: 'Orbitron',
                  fontSize: 11,
                  fontWeight: '800',
                  letterSpacing: 1,
                  marginBottom: 5,
                }}>
                  {item.label}
                </Text>

                {/* Desc */}
                <Text style={{
                  color: muted,
                  fontFamily: 'Orbitron',
                  fontSize: 8,
                  lineHeight: 13,
                  letterSpacing: 0.3,
                }}>
                  {item.desc}
                </Text>
              </View>
            </PressCard>
          ))}
        </View>

        {/* ── SECTION LABEL ────────────────────────────────── */}
        <View style={{
          paddingHorizontal: 20,
          marginBottom: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        }}>
          <Feather name="star" size={12} color={muted} />
          <Text style={{
            fontFamily: 'Orbitron',
            fontSize: 9,
            color: muted,
            letterSpacing: 2,
          }}>
            NOWOŚCI
          </Text>
        </View>

        {/* ── LIST ITEMS (NEW) ──────────────────────────────── */}
        <View style={{ paddingHorizontal: 16, gap: 10 }}>
          {LIST_ITEMS.map((item) => (
            <PressCard key={item.route} item={item}>
              <View style={{
                backgroundColor: surface,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: item.accent + '30',
                paddingVertical: 18,
                paddingHorizontal: 18,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 16,
                overflow: 'hidden',
                shadowColor: item.accent,
                shadowOffset: { width: 0, height: 3 },
                shadowOpacity: 0.12,
                shadowRadius: 10,
                elevation: 4,
              }}>

                {/* Left accent strip */}
                <View style={{
                  position: 'absolute',
                  left: 0, top: 0, bottom: 0,
                  width: 4,
                  backgroundColor: item.accent,
                  borderTopLeftRadius: 18,
                  borderBottomLeftRadius: 18,
                }} />

                {/* Background glow */}
                <View style={{
                  position: 'absolute',
                  top: -30, right: -30,
                  width: 100, height: 100,
                  borderRadius: 50,
                  backgroundColor: item.accent + '0D',
                }} />

                {/* Icon */}
                <View style={{
                  width: 52,
                  height: 52,
                  borderRadius: 16,
                  backgroundColor: item.accent + '15',
                  borderWidth: 1,
                  borderColor: item.accent + '30',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <MenuIcon item={item} size={26} color={item.accent} />
                </View>

                {/* Text block */}
                <View style={{ flex: 1, gap: 5 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{
                      color: theme.text,
                      fontFamily: 'Orbitron',
                      fontSize: 13,
                      fontWeight: '800',
                      letterSpacing: 0.8,
                    }}>
                      {item.label}
                    </Text>

                    {item.tag && (
                      <View style={{
                        backgroundColor: item.accent,
                        borderRadius: 6,
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                      }}>
                        <Text style={{
                          fontFamily: 'Orbitron',
                          fontSize: 7,
                          color: '#fff',
                          letterSpacing: 1.5,
                          fontWeight: '800',
                        }}>
                          {item.tag}
                        </Text>
                      </View>
                    )}
                  </View>

                  <Text style={{
                    color: muted,
                    fontFamily: 'Orbitron',
                    fontSize: 9,
                    lineHeight: 15,
                    letterSpacing: 0.2,
                  }}>
                    {item.desc}
                  </Text>
                </View>

                {/* Arrow */}
                <View style={{
                  width: 34,
                  height: 34,
                  borderRadius: 11,
                  backgroundColor: item.accent + '15',
                  borderWidth: 1,
                  borderColor: item.accent + '25',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <Feather name="chevron-right" size={16} color={item.accent} />
                </View>
              </View>
            </PressCard>
          ))}
        </View>

        {/* ── BOTTOM STATS ─────────────────────────────────── */}
        <View style={{
          marginHorizontal: 16,
          marginTop: 28,
          backgroundColor: surface,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: border,
          overflow: 'hidden',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: isDark ? 0.2 : 0.05,
          shadowRadius: 8,
          elevation: 3,
        }}>
          {[
            { icon: 'users',  label: 'SPOŁECZNOŚĆ', value: 'VROOM' },
            { icon: 'zap',    label: 'AKTYWNOŚĆ',   value: 'LIVE'  },
            { icon: 'award',  label: 'SEZON',        value: '2026'  },
          ].map((s, i) => (
            <View
              key={s.label}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 16,
                paddingHorizontal: 20,
                borderBottomWidth: i < 2 ? 1 : 0,
                borderBottomColor: divider,
                gap: 14,
              }}
            >
              {/* Icon circle */}
              <View style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                backgroundColor: theme.primary + '15',
                borderWidth: 1,
                borderColor: theme.primary + '25',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <Feather name={s.icon as any} size={16} color={theme.primary} />
              </View>

              {/* Label */}
              <Text style={{
                fontFamily: 'Orbitron',
                fontSize: 9,
                color: muted,
                letterSpacing: 1.5,
                flex: 1,
              }}>
                {s.label}
              </Text>

              {/* Value */}
              <Text style={{
                fontFamily: 'Orbitron',
                fontSize: 12,
                color: theme.text,
                fontWeight: '800',
                letterSpacing: 1,
              }}>
                {s.value}
              </Text>
            </View>
          ))}
        </View>

      </ScrollView>
    </View>
  );
}