import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { memo, useEffect } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { convoyStatusColor, type ConvoyMapNotice, type ConvoyNoticeAction } from '../../lib/convoyUi';
import { useRadio } from '../../contexts/RadioContext';
import { playRadioCue } from '../../lib/radioEffects';

const DEFAULT_CONVOY_NOTIFICATION = require('../../assets/sounds/convoy-notify.wav');

type Props = {
  notices: ConvoyMapNotice[];
  top: number;
  onDismiss: (id: string) => void;
  onAction: (action: ConvoyNoticeAction) => void;
  onHeightChange?: (height: number) => void;
};

export const ConvoyNoticeOverlay = memo(function ConvoyNoticeOverlay({
  notices,
  top,
  onDismiss,
  onAction,
  onHeightChange,
}: Props) {
  const radio = useRadio();
  const notice = notices[0] ?? null;

  useEffect(() => {
    if (!notice) {
      onHeightChange?.(0);
      return undefined;
    }
    if (notice.playSound) {
      playRadioCue('convoyNotification', radio.config?.effects, DEFAULT_CONVOY_NOTIFICATION);
    }
    const timer = setTimeout(
      () => onDismiss(notice.id),
      notice.critical ? 6_000 : 4_200,
    );
    return () => clearTimeout(timer);
  }, [notice, onDismiss, onHeightChange, radio.config?.effects]);

  if (!notice) return null;
  const accent = notice.kind === 'status' ? convoyStatusColor(notice.status) : '#31C8FF';
  const icon = notice.kind === 'meeting'
    ? 'flag-checkered'
    : notice.kind === 'route'
      ? 'map-marker-path'
      : notice.status === 'problem'
        ? 'alert-octagon'
        : notice.status === 'lost'
          ? 'map-marker-alert'
          : 'message-alert';

  return (
    <View pointerEvents="box-none" style={[styles.position, { top }]}> 
      <View
        onLayout={(event) => onHeightChange?.(event.nativeEvent.layout.height)}
        style={[styles.toast, { borderColor: `${accent}AA` }]}
      >
        <View style={[styles.icon, { backgroundColor: `${accent}22` }]}>
          <MaterialCommunityIcons name={icon} size={24} color={accent} />
        </View>
        <View style={styles.copy}>
          <Text numberOfLines={1} style={styles.title}>{notice.title}</Text>
          <Text numberOfLines={2} style={[styles.message, { color: accent }]}>{notice.message}</Text>
        </View>
        {notice.action ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Nawiguj"
            onPress={() => {
              onDismiss(notice.id);
              onAction(notice.action!);
            }}
            style={[styles.action, { backgroundColor: accent }]}
          >
            <Text style={styles.actionText}>NAWIGUJ</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity accessibilityLabel="Zamknij komunikat" onPress={() => onDismiss(notice.id)} style={styles.close}>
          <MaterialCommunityIcons name="close" size={18} color="#A9B1BD" />
        </TouchableOpacity>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  position: { position: 'absolute', left: 12, right: 12, zIndex: 220, elevation: 24 },
  toast: {
    minHeight: 64,
    borderRadius: 17,
    borderWidth: 1.5,
    backgroundColor: '#0B0E13F5',
    paddingLeft: 10,
    paddingRight: 6,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    shadowColor: '#000',
    shadowOpacity: 0.42,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  icon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0 },
  title: { color: '#FFFFFF', fontFamily: 'Manrope_700Bold', fontSize: 12 },
  message: { marginTop: 2, fontFamily: 'Manrope_700Bold', fontSize: 13 },
  action: { minHeight: 36, borderRadius: 11, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center' },
  actionText: { color: '#071015', fontFamily: 'Manrope_700Bold', fontSize: 9 },
  close: { width: 28, height: 36, alignItems: 'center', justifyContent: 'center' },
});
