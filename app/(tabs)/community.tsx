import React, { useRef } from 'react';
import {
  View, Text, TouchableOpacity, StatusBar, ScrollView,
  Animated, Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../contexts/ThemeContext';

const { width } = Dimensions.get('window');

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
    label:   'KLUBY',
    desc:    'Dołącz lub stwórz własny klub — czat, rangi, moderacja.',
    route:   '/Community/clubs/clubs',
    icon:    'shield-crown-outline',
    iconLib: 'material',
    accent:  '#00bfff',
    tag:     'NEW',
  },
  {
    label:   'THE GRID',
    desc:    'Arena 1v1 — postaw auto do walki i zdobądź uznanie!',
    route:   '/Community/grid/grid',
    icon:    'flag-checkered',
    iconLib: 'material',
    accent:  '#FFD700',
    tag:     'NEW',
  },
];

// Featured (first two rows as big tiles, rest as list)
const FEATURED = communityMenu.slice(0, 2);
const REST      = communityMenu.slice(2);

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

  const onPressIn  = () => Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 30 }).start();
  const onPressOut = () => Animated.spring(scale, { toValue: 1,    useNativeDriver: true, speed: 30 }).start();

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

export default function Community() {
  const { theme, isDark } = useTheme();

  const cardBg     = isDark ? '#111111' : '#ffffff';
  const cardBorder = isDark ? '#1e1e1e' : '#eeeeee';
  const subText    = isDark ? '#555555' : '#999999';

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />

      <ScrollView
        contentContainerStyle={{ paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── HEADER ─────────────────────────────────────── */}
        <View style={{ paddingTop: 64, paddingHorizontal: 20, paddingBottom: 28 }}>
          <Text style={{
            color: theme.primary, fontSize: 10, fontFamily: 'Orbitron',
            letterSpacing: 5, marginBottom: 6, opacity: 0.7,
          }}>
            VROOM
          </Text>
          <Text style={{
            color: theme.text, fontSize: 30, fontFamily: 'Orbitron',
            fontWeight: '900', letterSpacing: 2, lineHeight: 36,
          }}>
            SPOŁECZNOŚĆ
          </Text>

          {/* Decorative line */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16, gap: 8 }}>
            <View style={{ height: 2, width: 32, backgroundColor: theme.primary, borderRadius: 1 }} />
            <View style={{ height: 1, flex: 1, backgroundColor: isDark ? '#1a1a1a' : '#e8e8e8', borderRadius: 1 }} />
          </View>
        </View>

        {/* ── FEATURED TILES ──────────────────────────────── */}
        <View style={{ paddingHorizontal: 16, flexDirection: 'row', gap: 12, marginBottom: 12 }}>
          {FEATURED.map((item) => (
            <PressCard key={item.route} item={item} style={{ flex: 1 }}>
              <View style={{
                backgroundColor: cardBg,
                borderRadius: 20, borderWidth: 1,
                borderColor: cardBorder,
                padding: 18, gap: 12,
                overflow: 'hidden', minHeight: 160,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: isDark ? 0.4 : 0.08,
                shadowRadius: 12, elevation: 6,
              }}>
                {/* Glow bg */}
                <View style={{
                  position: 'absolute', top: -30, right: -30,
                  width: 100, height: 100, borderRadius: 50,
                  backgroundColor: item.accent + '15',
                }} />

                {/* Icon */}
                <View style={{
                  width: 46, height: 46, borderRadius: 14,
                  backgroundColor: item.accent + '18',
                  borderWidth: 1, borderColor: item.accent + '30',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  {item.iconLib === 'material'
                    ? <MaterialCommunityIcons name={item.icon as any} size={24} color={item.accent} />
                    : <Feather name={item.icon as any} size={22} color={item.accent} />
                  }
                </View>

                {/* Label */}
                <View style={{ gap: 4 }}>
                  <Text style={{
                    color: theme.text, fontFamily: 'Orbitron',
                    fontSize: 11, fontWeight: '800', letterSpacing: 1.5,
                  }}>
                    {item.label}
                  </Text>
                  <Text style={{
                    color: subText, fontFamily: 'Orbitron',
                    fontSize: 8, lineHeight: 13, letterSpacing: 0.2,
                  }}>
                    {item.desc}
                  </Text>
                </View>

                {/* Bottom accent line */}
                <View style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  height: 2, backgroundColor: item.accent + '50',
                  borderBottomLeftRadius: 20, borderBottomRightRadius: 20,
                }} />
              </View>
            </PressCard>
          ))}
        </View>

        {/* ── REST LIST ───────────────────────────────────── */}
        <View style={{ paddingHorizontal: 16, gap: 10 }}>
          {REST.map((item) => (
            <PressCard key={item.route} item={item}>
              <View style={{
                backgroundColor: cardBg,
                borderRadius: 18, borderWidth: 1,
                borderColor: item.tag ? item.accent + '25' : cardBorder,
                paddingVertical: 16, paddingHorizontal: 16,
                flexDirection: 'row', alignItems: 'center', gap: 14,
                overflow: 'hidden',
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: isDark ? 0.3 : 0.05,
                shadowRadius: 8, elevation: 4,
              }}>
                {/* Left glow strip */}
                <View style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0,
                  width: 3, borderTopLeftRadius: 18, borderBottomLeftRadius: 18,
                  backgroundColor: item.accent,
                  opacity: 0.8,
                }} />

                {/* Glow bg (for NEW items) */}
                {item.tag && (
                  <View style={{
                    position: 'absolute', top: -20, right: -20,
                    width: 80, height: 80, borderRadius: 40,
                    backgroundColor: item.accent + '10',
                  }} />
                )}

                {/* Icon */}
                <View style={{
                  width: 48, height: 48, borderRadius: 14,
                  backgroundColor: item.accent + '15',
                  borderWidth: 1, borderColor: item.accent + '25',
                  alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {item.iconLib === 'material'
                    ? <MaterialCommunityIcons name={item.icon as any} size={26} color={item.accent} />
                    : <Feather name={item.icon as any} size={24} color={item.accent} />
                  }
                </View>

                {/* Text */}
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{
                      color: theme.text, fontFamily: 'Orbitron',
                      fontSize: 12, fontWeight: '800', letterSpacing: 1,
                    }}>
                      {item.label}
                    </Text>
                    {item.tag && (
                      <View style={{
                        backgroundColor: item.accent + '20',
                        borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2,
                        borderWidth: 1, borderColor: item.accent + '45',
                      }}>
                        <Text style={{
                          fontFamily: 'Orbitron', fontSize: 7,
                          color: item.accent, letterSpacing: 1.5, fontWeight: '700',
                        }}>
                          {item.tag}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={{
                    color: subText, fontFamily: 'Orbitron',
                    fontSize: 9, lineHeight: 14, letterSpacing: 0.2,
                  }}>
                    {item.desc}
                  </Text>
                </View>

                {/* Arrow */}
                <View style={{
                  width: 32, height: 32, borderRadius: 10,
                  backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5',
                  alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <Feather name="chevron-right" size={16} color={subText} />
                </View>
              </View>
            </PressCard>
          ))}
        </View>

        {/* ── BOTTOM STATS ROW ────────────────────────────── */}
        <View style={{
          flexDirection: 'row', marginHorizontal: 16, marginTop: 24,
          backgroundColor: cardBg,
          borderRadius: 18, borderWidth: 1, borderColor: cardBorder,
          overflow: 'hidden',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: isDark ? 0.25 : 0.05,
          shadowRadius: 8, elevation: 4,
        }}>
          {[
            { icon: 'users',        label: 'SPOŁECZNOŚĆ', value: 'VROOM' },
            { icon: 'zap',          label: 'AKTYWNOŚĆ',   value: 'LIVE'  },
            { icon: 'award',        label: 'SEZON',       value: '2026'  },
          ].map((s, i) => (
            <View
              key={s.label}
              style={{
                flex: 1, alignItems: 'center', paddingVertical: 16,
                borderRightWidth: i < 2 ? 1 : 0,
                borderRightColor: isDark ? '#1a1a1a' : '#f0f0f0',
                gap: 6,
              }}
            >
              <Feather name={s.icon as any} size={18} color={theme.primary} />
              <Text style={{
                fontFamily: 'Orbitron', fontSize: 11,
                color: theme.text, fontWeight: '700',
              }}>
                {s.value}
              </Text>
              <Text style={{
                fontFamily: 'Orbitron', fontSize: 7,
                color: subText, letterSpacing: 1,
              }}>
                {s.label}
              </Text>
            </View>
          ))}
        </View>

      </ScrollView>
    </View>
  );
}