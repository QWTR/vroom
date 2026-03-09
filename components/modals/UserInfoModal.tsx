import React, { memo } from 'react';
import { Modal, SafeAreaView, View, Text, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { User } from '../../constants/types';
import { styles } from '../../styles/mapstyle';

interface UserInfoModalProps {
  visible: boolean;
  user: User | null;
  distance: number;
  onNavigate: () => void;
  onClose: () => void;
}

export const UserInfoModal = memo(
  ({ visible, user, distance, onNavigate, onClose }: UserInfoModalProps) => {
    if (!user) return null;

    return (
      <Modal visible={visible} animationType="fade" transparent>
        <SafeAreaView style={styles.userInfoOverlay}>
          <TouchableOpacity
            style={styles.userInfoBackdrop}
            activeOpacity={1}
            onPress={onClose}
          />
          <View style={styles.userInfoCard}>
            <View style={styles.userInfoHeader}>
              <Text style={styles.userInfoAvatar}>{user.avatar || '👤'}</Text>
              <TouchableOpacity style={styles.userInfoCloseBtn} onPress={onClose}>
                <MaterialIcons name="close" size={24} color="#ffffff70" />
              </TouchableOpacity>
            </View>

            <View style={styles.userInfoContent}>
              <Text style={styles.userInfoName}>{user.name}</Text>
              <View style={styles.userInfoStatusRow}>
                <View
                  style={[
                    styles.userInfoStatusDot,
                    { backgroundColor: user.status === 'Online' ? '#00d26a' : '#ffffff50' },
                  ]}
                />
                <Text style={styles.userInfoStatus}>{user.status || 'Offline'}</Text>
              </View>

              <View style={styles.userInfoDivider} />

              <View style={styles.userInfoStatRow}>
                <View style={styles.userInfoStatIcon}>
                  <MaterialIcons name="straighten" size={16} color="#e33835ce" />
                </View>
                <View>
                  <Text style={styles.userInfoStatLabel}>Odległość</Text>
                  <Text style={styles.userInfoStatValue}>{distance.toFixed(1)} km</Text>
                </View>
              </View>

              <View style={styles.userInfoStatRow}>
                <View style={styles.userInfoStatIcon}>
                  <MaterialIcons name="schedule" size={16} color="#e33835ce" />
                </View>
                <View>
                  <Text style={styles.userInfoStatLabel}>ETA</Text>
                  <Text style={styles.userInfoStatValue}>
                    ~{Math.round(distance * 5)} min
                  </Text>
                </View>
              </View>

              {user.isFriend && (
                <View style={styles.userInfoBadge}>
                  <MaterialIcons name="favorite" size={14} color="#ff6b9d" />
                  <Text style={styles.userInfoBadgeText}>Znajomy</Text>
                </View>
              )}
            </View>

            <TouchableOpacity
              style={styles.userInfoNavigateBtn}
              onPress={onNavigate}
              activeOpacity={0.8}
            >
              <MaterialIcons name="directions" size={20} color="#fff" />
              <Text style={styles.userInfoNavigateBtnText}>Jedź do użytkownika</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    );
  },
);