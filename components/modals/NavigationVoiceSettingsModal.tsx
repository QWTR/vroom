import { MaterialIcons } from '@expo/vector-icons';
import React, { memo, useMemo } from 'react';
import { Modal, ScrollView, Switch, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';
import { useNavigationVoice } from '../../hooks/useNavigationVoice';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export const NavigationVoiceSettingsModal = memo(function NavigationVoiceSettingsModal({
  visible,
  onClose,
}: Props) {
  const { theme } = useTheme();
  const voice = useNavigationVoice();
  useModalBackHandler(visible, onClose);

  const polishVoices = useMemo(
    () => voice.voices
      .filter((item) => item.language.toLowerCase().replace('_', '-').startsWith('pl'))
      .sort((a, b) => {
        const enhancedA = String(a.quality).toLowerCase().includes('enhanced') ? 1 : 0;
        const enhancedB = String(b.quality).toLowerCase().includes('enhanced') ? 1 : 0;
        return enhancedB - enhancedA || a.name.localeCompare(b.name, 'pl');
      }),
    [voice.voices],
  );

  const selectVoice = (identifier: string | null) => {
    void voice.updatePreferences({
      mode: identifier ? 'manual' : 'auto',
      voiceIdentifier: identifier,
    });
  };

  const card = {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 16,
  } as const;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }}>
        <View style={{
          backgroundColor: theme.bg,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          maxHeight: '92%',
          padding: 18,
        }}>
          <View style={{ width: 42, height: 4, borderRadius: 2, backgroundColor: theme.border2, alignSelf: 'center', marginBottom: 16 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
            <View style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: `${theme.primary}22`,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <MaterialIcons name="record-voice-over" size={21} color={theme.primary} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>GŁOS NAWIGACJI</Text>
              <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 3 }}>
                {voice.selectedVoice?.name ?? 'Systemowy głos polski'}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={{ padding: 8 }}>
              <MaterialIcons name="close" size={24} color={theme.textMuted} />
            </TouchableOpacity>
          </View>

          <View style={[card, { marginBottom: 14 }]}>
            <ToggleRow
              label="Wskazówki manewrów"
              description="Skręty, ronda, zjazdy i dojazd do celu"
              value={voice.preferences.guidanceEnabled}
              onChange={(value) => { void voice.updatePreferences({ guidanceEnabled: value }); }}
              color={theme.primary}
              text={theme.text}
              muted={theme.textMuted}
            />
            <View style={{ height: 1, backgroundColor: theme.border, marginHorizontal: 14 }} />
            <ToggleRow
              label="Ostrzeżenia drogowe"
              description="Zagrożenia, zgłoszenia i fotoradary"
              value={voice.preferences.alertsEnabled}
              onChange={(value) => { void voice.updatePreferences({ alertsEnabled: value }); }}
              color={theme.primary}
              text={theme.text}
              muted={theme.textMuted}
            />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <Text style={{ color: theme.textMuted, fontSize: 12, fontWeight: '800', flex: 1 }}>
              POLSKI LEKTOR
            </Text>
            <TouchableOpacity
              onPress={() => voice.previewVoice()}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 5, padding: 7 }}
            >
              <MaterialIcons name="play-arrow" size={18} color={theme.primary} />
              <Text style={{ color: theme.primary, fontSize: 12, fontWeight: '800' }}>ODSŁUCHAJ</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <VoiceRow
              name="Automatycznie — najlepszy dostępny"
              quality="Preferuje głos Enhanced"
              active={voice.preferences.mode === 'auto'}
              onSelect={() => selectVoice(null)}
              onPreview={() => voice.previewVoice(voice.selectedVoice?.identifier)}
              theme={theme}
            />
            {polishVoices.map((item) => (
              <VoiceRow
                key={item.identifier}
                name={item.name}
                quality={String(item.quality || 'Default')}
                active={
                  voice.preferences.mode === 'manual'
                  && voice.preferences.voiceIdentifier === item.identifier
                }
                onSelect={() => selectVoice(item.identifier)}
                onPreview={() => voice.previewVoice(item.identifier)}
                theme={theme}
              />
            ))}
            {!polishVoices.length && voice.hydrated ? (
              <View style={[card, { padding: 16 }]}>
                <Text style={{ color: theme.text, fontWeight: '700' }}>Brak dodatkowych polskich głosów</Text>
                <Text style={{ color: theme.textMuted, marginTop: 6, lineHeight: 18 }}>
                  VROOM użyje polskiego głosu systemowego. Dodatkowy głos można pobrać w ustawieniach mowy telefonu.
                </Text>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
});

function ToggleRow(props: {
  label: string;
  description: string;
  value: boolean;
  onChange: (value: boolean) => void;
  color: string;
  text: string;
  muted: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14 }}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={{ color: props.text, fontSize: 14, fontWeight: '700' }}>{props.label}</Text>
        <Text style={{ color: props.muted, fontSize: 12, marginTop: 3 }}>{props.description}</Text>
      </View>
      <Switch value={props.value} onValueChange={props.onChange} trackColor={{ true: props.color }} />
    </View>
  );
}

function VoiceRow(props: {
  name: string;
  quality: string;
  active: boolean;
  onSelect: () => void;
  onPreview: () => void;
  theme: ReturnType<typeof useTheme>['theme'];
}) {
  return (
    <TouchableOpacity
      onPress={props.onSelect}
      activeOpacity={0.75}
      style={{
        backgroundColor: props.active ? `${props.theme.primary}18` : props.theme.surface,
        borderColor: props.active ? props.theme.primary : props.theme.border,
        borderWidth: 1,
        borderRadius: 14,
        padding: 13,
        marginBottom: 9,
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <MaterialIcons
        name={props.active ? 'radio-button-checked' : 'radio-button-unchecked'}
        size={21}
        color={props.active ? props.theme.primary : props.theme.textMuted}
      />
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={{ color: props.theme.text, fontSize: 13, fontWeight: '700' }}>{props.name}</Text>
        <Text style={{ color: props.theme.textMuted, fontSize: 12, marginTop: 3 }}>{props.quality}</Text>
      </View>
      <TouchableOpacity onPress={props.onPreview} hitSlop={8} style={{ padding: 5 }}>
        <MaterialIcons name="volume-up" size={20} color={props.theme.primary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}
