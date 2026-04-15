import React, { useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity,
  Pressable, Platform, Alert,
} from 'react-native';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import type { SpeedCamera } from '../../hooks/useSpeedCameras';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';

interface Props {
  visible:       boolean;
  camera:        SpeedCamera | null;
  onClose:       () => void;
  onConfirm:     (id: number) => Promise<boolean>;
  onDelete:      (id: number) => Promise<boolean>;  // ← nowe
  currentUserId: number | null;
}

const TYPE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  fixed:   { label: 'STAŁY',     icon: 'camera-outline',    color: '#e33835' },
  section: { label: 'ODCINKOWY', icon: 'camera-timer',      color: '#ff922b' },
  mobile:  { label: 'MOBILNY',   icon: 'car-speed-limiter', color: '#FFD700' },
  bump:    { label: 'PRÓG',      icon: 'speedometer-slow',  color: '#4de926' },
};

export function SpeedCameraDetailModal({
  visible, camera, onClose, onConfirm, onDelete, currentUserId,
}: Props) {
  const { theme } = useTheme();
  const [confirming, setConfirming] = useState(false);
  const [deleting,   setDeleting]   = useState(false);
  const [confirmed,  setConfirmed]  = useState(false);
  const [count,      setCount]      = useState(0);

  useModalBackHandler(visible, onClose);

  React.useEffect(() => {
    if (camera) { setCount(camera.confirmCount); setConfirmed(false); }
  }, [camera?.id]);

  if (!camera) return null;

  const meta    = TYPE_LABELS[camera.type] ?? TYPE_LABELS.fixed;
  const isBump  = camera.type === 'bump';
  const isOwner = currentUserId !== null && camera.addedBy?.id === currentUserId;
  const dist    = camera.distanceM < 1000
    ? `${Math.round(camera.distanceM)} m`
    : `${(camera.distanceM / 1000).toFixed(1)} km`;

  const handleConfirm = async () => {
    if (confirming) return;
    setConfirming(true);
    try {
      const result = await onConfirm(camera.id);
      setConfirmed(result);
      setCount(prev => prev + (result ? 1 : -1));
    } finally { setConfirming(false); }
  };

  const handleDelete = () => {
    Alert.alert(
      'Usuń zgłoszenie',
      `Czy na pewno chcesz usunąć ten ${isBump ? 'próg' : 'fotoradar'}?`,
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Usuń',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              const ok = await onDelete(camera.id);
              if (ok) {
                onClose();
              }
            } finally { setDeleting(false); }
          },
        },
      ],
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} >
      <View style={{ flex: 1, backgroundColor: '#000000bb', justifyContent: 'flex-end' }}>
        <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} onPress={onClose} />
        <View style={{
          backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
          borderTopWidth: 1, borderColor: theme.border2,
          paddingBottom: Platform.OS === 'ios' ? 34 : 20, padding: 16,
        }}>
          {/* Handle */}
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginBottom: 16 }} />

          {/* Nagłówek */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <View style={{ width: 48, height: 48, borderRadius: 13, backgroundColor: meta.color + '20', borderWidth: 1.5, borderColor: meta.color + '50', alignItems: 'center', justifyContent: 'center' }}>
              <MaterialCommunityIcons name={meta.icon as any} size={24} color={meta.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 14, color: theme.text, fontWeight: '700' }}>
                {isBump ? 'PRÓG ZWALNIAJĄCY' : `FOTORADAR ${meta.label}`}
              </Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.textDim, marginTop: 2 }}>
                dodany przez @{camera.addedBy?.username ?? 'użytkownik'}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose}>
              <MaterialIcons name="close" size={20} color={theme.textDim} />
            </TouchableOpacity>
          </View>

          {/* Karty info */}
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
            {/* Limit / ikona */}
            <View style={{ flex: 1, backgroundColor: theme.surface2, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.border, alignItems: 'center', gap: 6 }}>
              {isBump ? (
                <MaterialCommunityIcons name="speedometer-slow" size={28} color="#4de926" />
              ) : camera.maxspeed !== null ? (
                <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#fff', borderWidth: 4, borderColor: '#cc0000', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: camera.maxspeed >= 100 ? 11 : 14, color: '#111', fontWeight: '900' }}>{camera.maxspeed}</Text>
                </View>
              ) : (
                <MaterialIcons name="speed" size={28} color={theme.textDim} />
              )}
              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim }}>
                {isBump ? 'PRÓG' : camera.maxspeed ? `${camera.maxspeed} km/h` : 'NIEZNANY LIMIT'}
              </Text>
            </View>

            {/* Odległość */}
            <View style={{ flex: 1, backgroundColor: theme.surface2, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <MaterialIcons name="near-me" size={28} color="#268bff" />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 16, color: '#268bff', fontWeight: '700' }}>{dist}</Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim }}>ODLEGŁOŚĆ</Text>
            </View>

            {/* Potwierdzenia */}
            <View style={{ flex: 1, backgroundColor: theme.surface2, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <MaterialIcons name="verified" size={28} color="#4de926" />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 16, color: '#4de926', fontWeight: '700' }}>{count}</Text>
              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim }}>POTWIERDZEŃ</Text>
            </View>
          </View>

          {/* Przycisk potwierdź */}
          <TouchableOpacity
            onPress={handleConfirm}
            disabled={confirming}
            style={{ backgroundColor: confirmed ? '#4de92620' : '#4de92615', borderRadius: 14, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: confirmed ? '#4de926' : '#4de92630', opacity: confirming ? 0.6 : 1, marginBottom: 10 }}
            activeOpacity={0.85}
          >
            <MaterialIcons name={confirmed ? 'check-circle' : 'check-circle-outline'} size={20} color="#4de926" />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: '#4de926', fontWeight: '700' }}>
              {confirming ? 'WYSYŁAM...' : confirmed ? 'POTWIERDZONO' : 'POTWIERDŹ'}
            </Text>
          </TouchableOpacity>

          {/* Przycisk usuń — tylko twórca */}
          {isOwner && (
            <TouchableOpacity
              onPress={handleDelete}
              disabled={deleting}
              style={{ backgroundColor: '#e3383515', borderRadius: 14, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: '#e3383540', opacity: deleting ? 0.6 : 1 }}
              activeOpacity={0.85}
            >
              <MaterialIcons name="delete-outline" size={20} color="#e33835" />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: '#e33835', fontWeight: '700' }}>
                {deleting ? 'USUWAM...' : 'USUŃ ZGŁOSZENIE'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}