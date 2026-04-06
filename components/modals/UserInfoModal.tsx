import React, { memo } from 'react';
import { Modal, View, Text, TouchableOpacity, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { User } from '../../constants/types';
import { makeMapStyles } from '../../styles/mapstyle';
import { useTheme } from '../../contexts/ThemeContext';

interface UserInfoModalProps {
  visible:       boolean;
  user:          User | null;
  distance:      number;
  onNavigate:    () => void;
  onClose:       () => void;
  onViewProfile: () => void;
}

export const UserInfoModal = memo(
  ({ visible, user, distance, onNavigate, onClose, onViewProfile }: UserInfoModalProps) => {
    const { theme, isDark } = useTheme();
    const styles    = makeMapStyles(theme);

    if (!user) return null;

    const isOnline  = user.status === 'Online';
    const hasAvatar = user.avatar && user.avatar.startsWith('http');

    return (
      <Modal visible={visible} animationType="slide" transparent>
        <SafeAreaView style={styles.userInfoOverlay}>
          <TouchableOpacity style={styles.userInfoBackdrop} activeOpacity={1} onPress={onClose} />

          <View style={styles.userInfoCard}>
            <View style={styles.userInfoHandle} />

            {/* Header */}
            <View style={styles.userInfoHeader}>
              <View style={styles.userInfoAvatarWrap}>
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
              </View>

              <View style={styles.userInfoHeaderText}>
                <Text style={styles.userInfoName}>{user.name}</Text>
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

            <View style={{ flexDirection: 'row', gap: 10 }}>
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
                  backgroundColor: theme.border,
                  borderRadius: 14, height: 52,
                  borderWidth: 1, borderColor: theme.border2,
                }}
                onPress={onViewProfile}
                activeOpacity={0.8}
              >
                <MaterialIcons name="person" size={20} color={theme.textMuted} />
                <Text style={{
                  fontFamily: 'Orbitron', color: theme.textMuted,
                  fontSize: 10, fontWeight: '700', letterSpacing: 1,
                }}>
                  PROFIL
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </Modal>
    );
  },
);