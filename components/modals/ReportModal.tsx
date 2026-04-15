import React, { memo } from 'react';
import {
  Modal, View, Text,
  TouchableOpacity, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { makeMapStyles } from '../../styles/mapstyle';
import { useTheme } from '../../contexts/ThemeContext';
import { LiveWarning, getWarningColor, getWarningIcon } from '../../hooks/useLiveMap';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';
interface ReportModalProps {
  visible:       boolean;
  onClose:       () => void;
  onReport:      (type: LiveWarning['type'], message?: string) => Promise<void>;
  isSubmitting?: boolean;
}

const REPORT_ITEMS: { type: LiveWarning['type']; label: string; sub: string }[] = [
  { type: 'traffic',       label: 'Korek',                sub: 'Zgłoś utrudnienia w ruchu'   },
  { type: 'weather',       label: 'Pogoda',               sub: 'Złe warunki drogowe'          },
  { type: 'accident',      label: 'Wypadek',              sub: 'Kolizja lub wypadek drogowy'  },
  { type: 'car_breakdown', label: 'Awaria auta',          sub: 'Pojazd zatrzymany na drodze'  },
  { type: 'speed_control', label: 'Kontrola prędkości',   sub: 'Kontrola prędkości'           },
  { type: 'Animal',        label: 'Uwaga Zwierzyna',      sub: 'Dzika zwierzyna na drodze'    },
  { type: 'kosmici',       label: 'Uwaga Ufo',            sub: 'Coś dziwnego na drodze'       },
];

export const ReportModal = memo(({ visible, onClose, onReport, isSubmitting }: ReportModalProps) => {
  const { theme, isDark } = useTheme();
  const styles    = makeMapStyles(theme);
  useModalBackHandler(visible, onClose);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <SafeAreaView style={styles.drawerModalContainer}>
        <View style={styles.drawerModal}>

          <View style={styles.drawerHandle} />

          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <View style={{
              backgroundColor: '#ff922b18', padding: 8, borderRadius: 10,
              borderWidth: 1, borderColor: '#ff922b35', marginRight: 12,
            }}>
              <MaterialIcons name="warning" size={18} color="#ff922b" />
            </View>
            <Text style={styles.drawerTitle}>ZGŁOŚ PROBLEM</Text>
          </View>

          <View style={styles.drawerDivider} />
          <Text style={styles.drawerSectionLabel}>OSTRZEŻENIE BĘDZIE WIDOCZNE PRZEZ 30 MINUT</Text>

          <ScrollView showsVerticalScrollIndicator={false}>
            {REPORT_ITEMS.map(item => {
              const color = getWarningColor(item.type);
              const icon  = getWarningIcon(item.type);
              return (
                <TouchableOpacity
                  key={item.type}
                  style={[styles.reportItem, isSubmitting && { opacity: 0.5 }]}
                  activeOpacity={0.7}
                  disabled={isSubmitting}
                  onPress={async () => {
                    await onReport(item.type);
                    onClose();
                  }}
                >
                  <View style={[styles.reportIconWrap, {
                    backgroundColor: `${color}15`,
                    borderColor:     `${color}35`,
                  }]}>
                    {isSubmitting
                      ? <ActivityIndicator size="small" color={color} />
                      : <MaterialCommunityIcons name={icon as any} size={22} color={color} />
                    }
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reportItemText}>{item.label}</Text>
                    <Text style={[styles.searchResultMetaText, { marginTop: 3 }]}>{item.sub}</Text>
                  </View>
                  <MaterialIcons name="arrow-forward-ios" size={14} color={theme.textDim} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TouchableOpacity style={styles.drawerCloseBtn} onPress={onClose}>
            <MaterialIcons name="close" size={18} color={theme.textMuted} />
          </TouchableOpacity>

        </View>
      </SafeAreaView>
    </Modal>
  );
});