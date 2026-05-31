import React, { memo, useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, Image, Animated, Easing } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../../constants/config';
import { ShopAvatarDecoration } from '../shop/ShopAvatarDecoration';
import type { UserShopCosmetics } from '../../constants/shopCosmetics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { User } from '../../constants/types';
import { makeMapStyles } from '../../styles/mapstyle';
import { useTheme } from '../../contexts/ThemeContext';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';
import { LinearGradient } from 'expo-linear-gradient';

interface UserInfoModalProps {
  visible:       boolean;
  user:          User | null;
  distance:      number;
  onNavigate:    () => void;
  onClose:       () => void;
  onViewProfile: () => void;
  onMessage:     () => void;  // ← NOWE
}

export const UserInfoModal = memo(
  ({ visible, user, distance, onNavigate, onClose, onViewProfile, onMessage }: UserInfoModalProps) => {
    const { theme, isDark } = useTheme();
    const styles = makeMapStyles(theme, isDark);

    if (!user) return null;

    const isOnline  = user.status === 'Online';
    const hasAvatar = user.avatar && user.avatar.startsWith('http');
    const [shopCosmetics, setShopCosmetics] = useState<UserShopCosmetics | null>(null);
    const [profileVisuals, setProfileVisuals] = useState<{
      nickColor: string | null;
      profileThemePreset: string;
      profilePremiumExtras: any;
      isPremiumProfile: boolean;
    } | null>(null);
    const premiumPulse = useRef(new Animated.Value(0)).current;

    useEffect(() => {
      if (!visible || !user?.id) {
        setShopCosmetics(null);
        setProfileVisuals(null);
        return;
      }
      (async () => {
        try {
          const token = await AsyncStorage.getItem('userToken') ?? await AsyncStorage.getItem('token');
          if (!token) return;
          const res = await fetch(`${API_URL}/api/profile/${user.id}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) return;
          const data = await res.json();
          setShopCosmetics(data.shopCosmetics ?? null);
          setProfileVisuals({
            nickColor: typeof data?.nickColor === 'string' ? data.nickColor : null,
            profileThemePreset: typeof data?.profileThemePreset === 'string' ? data.profileThemePreset : 'default',
            profilePremiumExtras: data?.profilePremiumExtras ?? null,
            isPremiumProfile: !!data?.isPremium,
          });
        } catch {
          setShopCosmetics(null);
          setProfileVisuals(null);
        }
      })();
    }, [visible, user?.id]);

    useEffect(() => {
      if (!visible || !profileVisuals?.isPremiumProfile) {
        premiumPulse.stopAnimation();
        premiumPulse.setValue(0);
        return;
      }
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(premiumPulse, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(premiumPulse, { toValue: 0, duration: 1300, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      );
      anim.start();
      return () => anim.stop();
    }, [visible, profileVisuals?.isPremiumProfile, premiumPulse]);

    useModalBackHandler(visible, onClose);
    const showPremiumTheme = !!profileVisuals?.isPremiumProfile;
    const accentColor = showPremiumTheme ? (profileVisuals?.nickColor || theme.primary) : theme.primary;
    const premiumGradient = showPremiumTheme && Array.isArray(profileVisuals?.profilePremiumExtras?.customHeroGradient?.colors)
      ? profileVisuals.profilePremiumExtras.customHeroGradient.colors.filter((c: unknown) => typeof c === 'string')
      : null;
    const glowOpacity = premiumPulse.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.34] });
    return (
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <SafeAreaView style={styles.userInfoOverlay}>
          <TouchableOpacity style={styles.userInfoBackdrop} activeOpacity={1} onPress={onClose} />

          <View
            style={[
              styles.userInfoCard,
              showPremiumTheme && {
                borderColor: `${accentColor}80`,
                shadowColor: accentColor,
              },
            ]}
          >
            {showPremiumTheme && (
              <>
                <Animated.View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 150,
                    opacity: glowOpacity,
                  }}
                >
                  <LinearGradient
                    colors={(premiumGradient && premiumGradient.length >= 2)
                      ? premiumGradient as string[]
                      : [`${accentColor}66`, '#00000000']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{ flex: 1 }}
                  />
                </Animated.View>
                <Animated.View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    top: -1,
                    left: -1,
                    right: -1,
                    bottom: -1,
                    borderRadius: 28,
                    borderWidth: 1,
                    borderColor: accentColor,
                    opacity: glowOpacity,
                  }}
                />
              </>
            )}
            <View style={styles.userInfoHandle} />

            {/* Header */}
            <View style={styles.userInfoHeader}>
              <View style={[styles.userInfoAvatarWrap, { overflow: 'visible' }]}>
                {hasAvatar ? (
                  <Image
                    source={{ uri: user.avatar as string }}
                    style={{ width: '100%', height: '100%', borderRadius: 999 }}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={styles.userInfoAvatar}>
                    {user.name?.slice(0, 2).toUpperCase() ?? '👤'}
                  </Text>
                )}
                <ShopAvatarDecoration item={shopCosmetics?.avatarFrame} size={56} />
              </View>

              <View style={styles.userInfoHeaderText}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[styles.userInfoName, showPremiumTheme && { color: accentColor }]}>{user.name}</Text>
                  {showPremiumTheme && (
                    <View style={{ backgroundColor: `${accentColor}18`, borderRadius: 10, borderWidth: 1, borderColor: `${accentColor}40`, paddingHorizontal: 7, paddingVertical: 2 }}>
                      <Text style={{ color: '#FFD700', fontFamily: 'Orbitron', fontSize: 8 }}>PREMIUM</Text>
                    </View>
                  )}
                </View>
                <View style={styles.userInfoStatusRow}>
                  <View style={[
                    styles.userInfoStatusDot,
                    { backgroundColor: isOnline ? theme.online : theme.textDim },
                  ]} />
                  <Text style={[styles.userInfoStatus, isOnline && { color: theme.online }]}>
                    {isOnline ? 'ONLINE' : 'OFFLINE'}
                  </Text>
                </View>
              </View>

              <TouchableOpacity style={styles.userInfoCloseBtn} onPress={onClose}>
                <MaterialIcons name="close" size={18} color={theme.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={styles.userInfoDivider} />

            {user.isFriend && (
              <View style={styles.userInfoBadge}>
                <MaterialIcons name="favorite" size={12} color="#ff6b9d" />
                <Text style={styles.userInfoBadgeText}>ZNAJOMY</Text>
              </View>
            )}

            <View style={styles.userInfoStatsRow}>
              <View style={styles.userInfoStatCard}>
                <View style={styles.userInfoStatIcon}>
                  <MaterialIcons name="straighten" size={15} color={theme.primary} />
                </View>
                <Text style={styles.userInfoStatLabel}>ODLEGŁOŚĆ</Text>
                <Text style={styles.userInfoStatValue}>{distance.toFixed(1)} km</Text>
              </View>
              <View style={styles.userInfoStatCard}>
                <View style={styles.userInfoStatIcon}>
                  <MaterialIcons name="schedule" size={15} color={theme.primary} />
                </View>
                <Text style={styles.userInfoStatLabel}>ETA</Text>
                <Text style={styles.userInfoStatValue}>~{Math.round(distance * 5)} min</Text>
              </View>
            </View>

            {/* Wiersz 1: JEDŹ + WIADOMOŚĆ */}
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
              <TouchableOpacity
                style={[styles.userInfoNavigateBtn, { flex: 1 }]}
                onPress={onNavigate}
                activeOpacity={0.8}
              >
                <MaterialIcons name="navigation" size={20} color="#fff" />
                <Text style={styles.userInfoNavigateBtnText}>JEDŹ</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{
                  flex: 1, flexDirection: 'row', alignItems: 'center',
                  justifyContent: 'center', gap: 8,
                  backgroundColor: theme.primaryBg,
                  borderRadius: 14, height: 52,
                  borderWidth: 1, borderColor: theme.primaryBorder,
                }}
                onPress={onMessage}
                activeOpacity={0.8}
              >
                <MaterialIcons name="chat" size={20} color={theme.primary} />
                <Text style={{
                  fontFamily: 'Orbitron', color: theme.primary,
                  fontSize: 10, fontWeight: '700', letterSpacing: 1,
                }}>
                  NAPISZ
                </Text>
              </TouchableOpacity>
            </View>

            {/* Wiersz 2: PROFIL (pełna szerokość) */}
            <TouchableOpacity
              style={{
                flexDirection: 'row', alignItems: 'center',
                justifyContent: 'center', gap: 8,
                backgroundColor: theme.surface2,
                borderRadius: 14, height: 46,
                borderWidth: 1, borderColor: theme.border2,
              }}
              onPress={onViewProfile}
              activeOpacity={0.8}
            >
              <MaterialIcons name="person" size={18} color={theme.textMuted} />
              <Text style={{
                fontFamily: 'Orbitron', color: theme.textMuted,
                fontSize: 10, fontWeight: '700', letterSpacing: 1,
              }}>
                PROFIL
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    );
  },
);