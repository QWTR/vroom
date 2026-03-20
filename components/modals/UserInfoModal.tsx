import React, { memo } from 'react';
import { Modal, SafeAreaView, View, Text, TouchableOpacity, Image } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { User } from '../../constants/types';
import { styles } from '../../styles/mapstyle';

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
                    style={{
                      width:        '100%',
                      height:       '100%',
                      borderRadius: 999,
                    }}
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
                    { backgroundColor: isOnline ? '#4de926' : '#ffffff35' },
                  ]} />
                  <Text style={[styles.userInfoStatus, isOnline && { color: '#4de926' }]}>
                    {isOnline ? 'ONLINE' : 'OFFLINE'}
                  </Text>
                </View>
              </View>

              <TouchableOpacity style={styles.userInfoCloseBtn} onPress={onClose}>
                <MaterialIcons name="close" size={18} color="#ffffff70" />
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
                  <MaterialIcons name="straighten" size={15} color="#e33835ce" />
                </View>
                <Text style={styles.userInfoStatLabel}>ODLEGŁOŚĆ</Text>
                <Text style={styles.userInfoStatValue}>{distance.toFixed(1)} km</Text>
              </View>
              <View style={styles.userInfoStatCard}>
                <View style={styles.userInfoStatIcon}>
                  <MaterialIcons name="schedule" size={15} color="#e33835ce" />
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
                  justifyContent: 'center', gap: 8, backgroundColor: '#ffffff08',
                  borderRadius: 14, height: 52, borderWidth: 1, borderColor: '#ffffff15',
                }}
                onPress={onViewProfile}
                activeOpacity={0.8}
              >
                <MaterialIcons name="person" size={20} color="#ffffff70" />
                <Text style={{ fontFamily: 'Orbitron', color: '#ffffff70', fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>
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