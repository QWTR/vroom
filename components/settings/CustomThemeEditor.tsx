import React, { useMemo, useState } from 'react';
import { Modal, View, TouchableOpacity, ScrollView, StatusBar } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import ColorPicker from 'react-native-wheel-color-picker';
import { useTheme } from '../../contexts/ThemeContext';
import { AppTheme, normalizeAccessibleTheme } from '../../constants/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
}

interface ColorKey {
  key:   keyof AppTheme;
  label: string;
}

function getStatusBarStyle(bg: string): 'light-content' | 'dark-content' {
  const hex = bg.replace('#', '');
  const normalized = hex.length === 3
    ? hex.split('').map((c) => c + c).join('')
    : hex.padEnd(6, '0').slice(0, 6);
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.299 * r) + (0.587 * g) + (0.114 * b);
  return luminance > 155 ? 'dark-content' : 'light-content';
}

const GROUPS: { title: string; keys: ColorKey[] }[] = [
  {
    title: 'TŁA',
    keys: [
      { key: 'bg',       label: 'Tło główne'       },
      { key: 'bgAlt',    label: 'Tło ekranów'      },
      { key: 'surface',  label: 'Karty'             },
      { key: 'surface2', label: 'Karty 2'           },
      { key: 'surface3', label: 'Karty 3'           },
      { key: 'surface4', label: 'Karty 4'           },
    ],
  },
  {
    title: 'BORDERY',
    keys: [
      { key: 'border',  label: 'Border'   },
      { key: 'border2', label: 'Border 2' },
      { key: 'border3', label: 'Border 3' },
    ],
  },
  {
    title: 'TEKST',
    keys: [
      { key: 'text',      label: 'Główny'      },
      { key: 'textMuted', label: 'Pomocniczy'  },
      { key: 'textDim',   label: 'Przytłumiony'},
      { key: 'textFaint', label: 'Ledwo widoczny'},
    ],
  },
  {
    title: 'AKCENT',
    keys: [
      { key: 'primary',        label: 'Główny kolor'    },
      { key: 'primaryBg',      label: 'Tło akcentu'     },
      { key: 'primaryBorder',  label: 'Border akcentu'  },
      { key: 'primaryBorder2', label: 'Border akcentu 2'},
    ],
  },
  {
    title: 'INNE',
    keys: [
      { key: 'icon',      label: 'Ikony'        },
      { key: 'tabBg',     label: 'Tło tab baru' },
      { key: 'tabBorder', label: 'Border tabów' },
      { key: 'overlay',   label: 'Overlay'      },
      { key: 'onPrimary', label: 'Tekst na CTA' },
    ],
  },
  {
    title: 'MAPA',
    keys: [
      { key: 'mapOverlay',     label: 'HUD / banery'     },
      { key: 'mapOverlayText', label: 'Tekst HUD'        },
      { key: 'mapLabelBg',     label: 'Tło etykiet'      },
      { key: 'mapLabelText',   label: 'Tekst etykiet'    },
    ],
  },
  {
    title: 'STATUSY',
    keys: [
      { key: 'online',  label: 'Online'   },
      { key: 'gold',    label: 'Złoto'    },
      { key: 'warning', label: 'Uwaga'    },
      { key: 'danger',  label: 'Błąd'     },
      { key: 'info',    label: 'Info'     },
      { key: 'success', label: 'Sukces'   },
    ],
  },
];

export function CustomThemeEditor({ visible, onClose }: Props) {
  const { theme, customTheme, setCustomColor, resetCustomTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const accessibleCustomTheme = useMemo(() => normalizeAccessibleTheme(customTheme), [customTheme]);
  const correctedColorCount = useMemo(() => GROUPS
    .flatMap(group => group.keys)
    .filter(({ key }) => {
      const requested = customTheme[key];
      const rendered = accessibleCustomTheme[key];
      return typeof requested === 'string' && typeof rendered === 'string'
        && requested.toLowerCase() !== rendered.toLowerCase();
    }).length, [accessibleCustomTheme, customTheme]);

  const [pickerVisible, setPickerVisible] = useState(false);
  const [activeKey,     setActiveKey]     = useState<keyof AppTheme | null>(null);
  const [tempColor,     setTempColor]     = useState('#e33835');

  const openPicker = (key: keyof AppTheme) => {
    setActiveKey(key);
    setTempColor(customTheme[key] as string);
    setPickerVisible(true);
  };

  const confirmColor = () => {
    if (activeKey) setCustomColor(activeKey, tempColor);
    setPickerVisible(false);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <StatusBar barStyle={getStatusBarStyle(theme.bg)} backgroundColor={theme.bg} />
      <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top, paddingBottom: insets.bottom }}>

        {/* Nagłówek */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 12,
          paddingHorizontal: 18, paddingVertical: 14,
          borderBottomWidth: 1, borderBottomColor: theme.border2,
        }}>
          <View style={{
            backgroundColor: theme.primaryBg, borderRadius: 10, padding: 8,
            borderWidth: 1, borderColor: theme.primaryBorder,
          }}>
            <MaterialIcons name="palette" size={20} color={theme.primary} />
          </View>
          <Text style={{ flex: 1, fontFamily: 'Manrope_600SemiBold', fontSize: 14, color: theme.text, letterSpacing: 1 }}>
            WŁASNY MOTYW
          </Text>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: theme.surface2, alignItems: 'center', justifyContent: 'center' }}
          >
            <MaterialIcons name="close" size={18} color={theme.textDim} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

          <View style={{
            flexDirection: 'row', alignItems: 'flex-start', gap: 12,
            backgroundColor: theme.surface, borderRadius: 14, padding: 14,
            borderWidth: 1.5, borderColor: correctedColorCount > 0 ? theme.focusRing : theme.controlBorder,
            marginBottom: 22,
          }}>
            <MaterialIcons
              name={correctedColorCount > 0 ? 'visibility' : 'verified'}
              size={24}
              color={correctedColorCount > 0 ? theme.focusRing : theme.success}
            />
            <View style={{ flex: 1 }}>
              <Text variant="label" style={{ color: theme.text }}>
                {correctedColorCount > 0
                  ? `Skorygowano ${correctedColorCount} ${correctedColorCount === 1 ? 'kolor' : 'kolory'}`
                  : 'Kontrast motywu jest czytelny'}
              </Text>
              <Text variant="bodySmall" style={{ color: theme.textMuted, marginTop: 4 }}>
                VROOM zachowuje Twój wybór, ale podczas wyświetlania może rozjaśnić lub przyciemnić tekst, ikony i obramowania, aby pozostały czytelne.
              </Text>
            </View>
          </View>

          {GROUPS.map(group => (
            <View key={group.title} style={{ marginBottom: 24 }}>
              {/* Tytuł sekcji */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <View style={{ flex: 1, height: 1, backgroundColor: theme.border2 }} />
                <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, letterSpacing: 1 }}>
                  {group.title}
                </Text>
                <View style={{ flex: 1, height: 1, backgroundColor: theme.border2 }} />
              </View>

              {/* Kolory w sekcji */}
              <View style={{
                backgroundColor: theme.surface, borderRadius: 14,
                borderWidth: 1, borderColor: theme.border2, overflow: 'hidden',
              }}>
                {group.keys.map((item, idx) => {
                  const requestedColor = customTheme[item.key] as string;
                  const renderedColor = accessibleCustomTheme[item.key] as string;
                  const wasCorrected = requestedColor.toLowerCase() !== renderedColor.toLowerCase();
                  return (
                    <TouchableOpacity
                      key={item.key}
                      onPress={() => openPicker(item.key)}
                      activeOpacity={0.7}
                      accessibilityLabel={`${item.label}, wybrany kolor ${requestedColor}${wasCorrected ? `, wyświetlany jako ${renderedColor} dla lepszego kontrastu` : ''}`}
                      style={[{
                        flexDirection: 'row', alignItems: 'center', minHeight: 64,
                        paddingHorizontal: 16, paddingVertical: 12, gap: 14,
                      }, idx > 0 && { borderTopWidth: 1, borderTopColor: theme.border }]}
                    >
                    {/* Swatch */}
                    <View style={{
                      width: 34, height: 34, borderRadius: 10,
                      backgroundColor: requestedColor,
                      borderWidth: 2, borderColor: theme.border3,
                    }} />

                    {/* Nazwa */}
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.text, fontWeight: '700' }}>
                        {item.label}
                      </Text>
                      <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, marginTop: 2, letterSpacing: 1 }}>
                        {requestedColor.toUpperCase()}
                      </Text>
                      {wasCorrected ? (
                        <Text variant="caption" style={{ color: theme.primaryText, marginTop: 3 }}>
                          Wyświetlany jako {renderedColor.toUpperCase()} dla czytelności
                        </Text>
                      ) : null}
                    </View>

                    <MaterialIcons name="chevron-right" size={22} color={theme.textMuted} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}

          {/* Resetuj */}
          <TouchableOpacity
            onPress={resetCustomTheme}
            activeOpacity={0.8}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              backgroundColor: theme.surface, borderRadius: 14, paddingVertical: 16,
              borderWidth: 1, borderColor: theme.border2, marginTop: 8,
            }}
          >
            <MaterialIcons name="refresh" size={18} color={theme.danger} />
            <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.danger, letterSpacing: 1 }}>
              RESETUJ DO DOMYŚLNYCH
            </Text>
          </TouchableOpacity>

        </ScrollView>

        {/* Color Picker Modal */}
        <Modal visible={pickerVisible} transparent animationType="slide" onRequestClose={() => setPickerVisible(false)}>
          <View style={{ flex: 1, backgroundColor: '#000000cc', justifyContent: 'flex-end' }}>
            <View style={{
              backgroundColor: theme.surface,
              borderTopLeftRadius: 24, borderTopRightRadius: 24,
              paddingTop: 16, paddingBottom: insets.bottom + 16,
              borderTopWidth: 1, borderColor: theme.border2,
            }}>
              {/* Handle */}
              <View style={{ width: 40, height: 4, backgroundColor: theme.border3, borderRadius: 2, alignSelf: 'center', marginBottom: 16 }} />

              {/* Tytuł */}
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 20 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: tempColor, borderWidth: 2, borderColor: theme.border3, marginRight: 12 }} />
                <Text style={{ flex: 1, fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.text, letterSpacing: 1 }}>
                  {activeKey ? GROUPS.flatMap(g => g.keys).find(k => k.key === activeKey)?.label.toUpperCase() : ''}
                </Text>
                <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim }}>
                  {tempColor.toUpperCase()}
                </Text>
              </View>

              {/* Picker */}
              <View style={{ height: 280, paddingHorizontal: 24 }}>
                <ColorPicker
                  color={tempColor}
                  onColorChange={(color: string) => setTempColor(color)}
                  thumbSize={30}
                  sliderSize={30}
                  noSnap
                  row={false}
                />
              </View>

              {/* Przyciski */}
              <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 20, marginTop: 20 }}>
                <TouchableOpacity
                  style={{
                    flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center',
                    backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border2,
                  }}
                  onPress={() => setPickerVisible(false)}
                >
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim }}>ANULUJ</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{
                    flex: 2, paddingVertical: 14, borderRadius: 12, alignItems: 'center',
                    backgroundColor: theme.primary,
                  }}
                  onPress={confirmColor}
                >
                  <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#fff', fontWeight: '700', letterSpacing: 1 }}>
                    ZASTOSUJ
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

      </View>
    </Modal>
  );
}
