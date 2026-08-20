import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput,
  Image, ActivityIndicator, Switch,
} from 'react-native';
import MaterialIcons          from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as ImagePicker       from 'expo-image-picker';
import Toast                  from 'react-native-toast-message';
import { ModalKeyboardSheet } from '../layout/ModalKeyboardSheet';
import { useTheme }           from '../../contexts/ThemeContext';

interface Props {
  visible:  boolean;
  onClose:  () => void;
  onCreate: (d: {
    name:        string;
    description: string;
    isPrivate:   boolean;
    avatarUri:   string | null;
  }) => Promise<void>;
}

export default function CreateClubModal({ visible, onClose, onCreate }: Props) {
  const { theme }                 = useTheme();
  const [name,    setName]        = useState('');
  const [desc,    setDesc]        = useState('');
  const [priv,    setPriv]        = useState(false);
  const [avatar,  setAvatar]      = useState<string | null>(null);
  const [creating, setCreating]   = useState(false);

  const pick = async () => {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (!r.canceled && r.assets?.[0]?.uri) setAvatar(r.assets[0].uri);
    } catch {
      Toast.show({ type: 'error', text1: 'Nie udało się wybrać logo' });
    }
  };

  const submit = async () => {
    if (!name.trim()) { Toast.show({ type: 'error', text1: 'Podaj nazwę klubu' }); return; }
    setCreating(true);
    try {
      await onCreate({ name: name.trim(), description: desc.trim(), isPrivate: priv, avatarUri: avatar });
      setName(''); setDesc(''); setPriv(false); setAvatar(null);
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Nie udało się utworzyć klubu',
        text2: error instanceof Error ? error.message : 'Spróbuj ponownie',
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <ModalKeyboardSheet visible={visible} onClose={onClose} sheetStyle={{ padding: 20, paddingHorizontal: 20 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginBottom: 16 }} />
            <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, letterSpacing: 2, marginBottom: 18 }}>
              NOWY KLUB
            </Text>
            <Text style={{ color: theme.textDim, fontSize: 11, lineHeight: 16, marginTop: -10, marginBottom: 16 }}>
              Nadaj klubowi tożsamość. Kanały, role i członków ustawisz od razu po utworzeniu.
            </Text>

            {/* Avatar picker */}
            <TouchableOpacity style={{ alignSelf: 'center', marginBottom: 16 }} onPress={pick}>
              <View style={{
                width: 68, height: 68, borderRadius: 16, overflow: 'hidden',
                backgroundColor: '#e3383515', borderWidth: 2, borderColor: '#e3383540',
                borderStyle: avatar ? 'solid' : 'dashed',
                alignItems: 'center', justifyContent: 'center',
              }}>
                {avatar ? (
                  <Image source={{ uri: avatar }} style={{ width: 68, height: 68 }} />
                ) : (
                  <>
                    <MaterialCommunityIcons name="shield-crown-outline" size={26} color="#e33835" />
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#e33835', marginTop: 2 }}>LOGO</Text>
                  </>
                )}
              </View>
            </TouchableOpacity>

            <TextInput
              style={{
                backgroundColor: theme.surface2, borderRadius: 11,
                paddingHorizontal: 14, paddingVertical: 11,
                color: theme.text, fontSize: 14,
                borderWidth: 1, borderColor: theme.border, marginBottom: 9,
              }}
              value={name} onChangeText={setName}
              placeholder="Nazwa klubu *" placeholderTextColor={theme.textDim} maxLength={40}
            />

            <TextInput
              style={{
                backgroundColor: theme.surface2, borderRadius: 11,
                paddingHorizontal: 14, paddingVertical: 11,
                color: theme.text, fontSize: 13,
                borderWidth: 1, borderColor: theme.border, marginBottom: 14,
                minHeight: 64, textAlignVertical: 'top',
              }}
              value={desc} onChangeText={setDesc}
              placeholder="Opis (opcjonalnie)" placeholderTextColor={theme.textDim}
              multiline maxLength={200}
            />

            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12,
              backgroundColor: `${theme.primary}10`, borderRadius: 11, padding: 12,
              borderWidth: 1, borderColor: `${theme.primary}35`,
            }}>
              <MaterialCommunityIcons name="view-list-outline" size={19} color={theme.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: theme.text, fontWeight: '700' }}>GOTOWY START</Text>
                <Text style={{ fontSize: 10, color: theme.textDim, marginTop: 3, lineHeight: 14 }}>
                  Dodamy kategorię Ogólne oraz kanały #powitania i #czat-ogolny.
                </Text>
              </View>
            </View>

            {/* Prywatny toggle */}
            <TouchableOpacity
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18,
                backgroundColor: theme.surface2, borderRadius: 11, padding: 12,
                borderWidth: 1, borderColor: theme.border,
              }}
              onPress={() => setPriv(v => !v)} activeOpacity={0.8}
            >
              <MaterialIcons name={priv ? 'lock' : 'lock-open'} size={17} color={priv ? '#e33835' : theme.textDim} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.text, fontWeight: '700' }}>PRYWATNY</Text>
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginTop: 1 }}>
                  Tylko zaproszeni mogą dołączyć
                </Text>
              </View>
              <Switch value={priv} onValueChange={setPriv} trackColor={{ true: '#e33835' }} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                { backgroundColor: '#e33835', borderRadius: 12, paddingVertical: 13, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
                creating && { opacity: 0.6 },
              ]}
              onPress={submit} disabled={creating}
            >
              {creating ? (
                <ActivityIndicator color="#fff" size={16} />
              ) : (
                <>
                  <MaterialCommunityIcons name="shield-crown" size={15} color="#fff" />
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 12, color: '#fff', fontWeight: '700' }}>UTWÓRZ KLUB</Text>
                </>
              )}
            </TouchableOpacity>
    </ModalKeyboardSheet>
  );
}
