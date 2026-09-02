import React from 'react';
import { Modal, View, TouchableOpacity, ScrollView, Image, ActivityIndicator } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme }      from '../../contexts/ThemeContext';
import type { FriendRequest } from '../../hooks/useChats';

interface Props {
  visible:       boolean;
  requests:      FriendRequest[];
  onClose:       () => void;
  onAccept:      (id: number) => Promise<void>;
  onReject:      (id: number) => Promise<void>;
}

export function FriendRequestsModal({ visible, requests, onClose, onAccept, onReject }: Props) {
  const { theme, isDark } = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: '#000000cc', justifyContent: 'flex-end' }}>
        <View style={{
          backgroundColor: isDark ? '#141414' : '#fff',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          maxHeight: '75%',
          borderTopWidth: 1,
          borderColor: isDark ? '#ffffff12' : '#00000010',
        }}>
          {/* Header */}
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            paddingHorizontal: 20, paddingVertical: 16,
            borderBottomWidth: 1, borderBottomColor: isDark ? '#ffffff0a' : '#00000008',
          }}>
            <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: '#e3383515', borderWidth: 1, borderColor: '#e3383530', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
              <MaterialIcons name="person-add" size={18} color="#e33835" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 13, color: theme.text, fontWeight: '700' }}>
                ZAPROSZENIA DO ZNAJOMYCH
              </Text>
              <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, marginTop: 2 }}>
                {requests.length} oczekujących
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: isDark ? '#ffffff0d' : '#00000008', alignItems: 'center', justifyContent: 'center' }}
            >
              <MaterialIcons name="close" size={18} color={theme.textDim} />
            </TouchableOpacity>
          </View>

          {/* List */}
          <ScrollView style={{ paddingVertical: 8 }} showsVerticalScrollIndicator={false}>
            {requests.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 40, gap: 10 }}>
                <MaterialIcons name="person-add-disabled" size={40} color={theme.textDim} />
                <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim }}>
                  Brak oczekujących zaproszeń
                </Text>
              </View>
            ) : (
              requests.map((req, index) => (
                <View
                  key={req.id}
                  style={{
                    flexDirection: 'row', alignItems: 'center',
                    paddingHorizontal: 20, paddingVertical: 12,
                    gap: 12,
                    borderBottomWidth: index < requests.length - 1 ? 1 : 0,
                    borderBottomColor: isDark ? '#ffffff07' : '#00000008',
                  }}
                >
                  {/* Avatar */}
                  <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                    {req.requester.avatarUrl
                      ? <Image source={{ uri: req.requester.avatarUrl }} style={{ width: 46, height: 46 }} />
                      : <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 16, color: '#e33835', fontWeight: '700' }}>
                          {req.requester.username.slice(0, 2).toUpperCase()}
                        </Text>
                    }
                  </View>

                  {/* Name */}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.text, fontWeight: '700' }}>
                      {req.requester.username}
                    </Text>
                    <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, marginTop: 2 }}>
                      chce zostać Twoim znajomym
                    </Text>
                  </View>

                  {/* Actions */}
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      onPress={() => onAccept(req.id)}
                      style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: '#4de92620', borderWidth: 1, borderColor: '#4de92645', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <MaterialIcons name="check" size={18} color="#4de926" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => onReject(req.id)}
                      style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: '#e3383520', borderWidth: 1, borderColor: '#e3383540', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <MaterialIcons name="close" size={18} color="#e33835" />
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
            <View style={{ height: 24 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
