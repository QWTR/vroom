import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput,
  ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Toast         from 'react-native-toast-message';
import { ModalKeyboardSheet } from '../layout/ModalKeyboardSheet';
import { useTheme }  from '../../contexts/ThemeContext';
import { API_URL }   from '../../constants/config';
import { getAuthToken } from '../../lib/getAuthToken';
import { ClubRank }  from './types';

const COLORS = ['#e33835', '#FFD700', '#00bfff', '#4de926', '#ff922b', '#748ffc', '#f06595'];

const PERM_LABELS: { key: 'canKick' | 'canMute' | 'canPin' | 'canManage'; label: string }[] = [
  { key: 'canKick',   label: 'Wyrzucanie członków'      },
  { key: 'canMute',   label: 'Wyciszanie członków'      },
  { key: 'canPin',    label: 'Przypinanie wiadomości'   },
  { key: 'canManage', label: 'Edycja ustawień klubu'    },
];

interface Props {
  visible:   boolean;
  onClose:   () => void;
  clubId:    number;
  ranks:     ClubRank[];
  onRefresh: () => void;
}

export default function RanksModal({ visible, onClose, clubId, ranks, onRefresh }: Props) {
  const { theme } = useTheme();

  const [creating, setCreating] = useState(false);
  const [newName,  setNewName]  = useState('');
  const [newColor, setNewColor] = useState('#e33835');
  const [perms, setPerms] = useState({
    canKick: false, canMute: false, canPin: false, canManage: false,
  });
  const [saving, setSaving] = useState(false);

  const createRank = async () => {
    if (!newName.trim()) { Toast.show({ type: 'error', text1: 'Podaj nazwę rangi' }); return; }
    setSaving(true);
    try {
      const token = await getAuthToken();
      if (!token) { Toast.show({ type: 'error', text1: 'Zaloguj się ponownie' }); return; }
      const res   = await fetch(`${API_URL}/api/clubs/${clubId}/ranks`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ name: newName.trim(), color: newColor, ...perms }),
      });
      const data = await res.json();
      if (!res.ok) { Toast.show({ type: 'error', text1: data.error }); return; }
      Toast.show({ type: 'success', text1: 'Ranga utworzona' });
      setNewName('');
      setPerms({ canKick: false, canMute: false, canPin: false, canManage: false });
      setCreating(false);
      onRefresh();
    } finally { setSaving(false); }
  };

  const deleteRank = (rankId: number) => {
    Alert.alert('Usuń rangę', 'Wszyscy z tą rangą stracą ją.', [
      { text: 'Anuluj', style: 'cancel' },
      { text: 'Usuń', style: 'destructive', onPress: async () => {
        const token = await getAuthToken();
        if (!token) { Toast.show({ type: 'error', text1: 'Zaloguj się ponownie' }); return; }
        await fetch(`${API_URL}/api/clubs/${clubId}/ranks/${rankId}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
        });
        onRefresh();
      }},
    ]);
  };

  return (
    <ModalKeyboardSheet visible={visible} onClose={onClose} maxHeight="85%" sheetStyle={{ paddingHorizontal: 0 }}>
      <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border3, alignSelf: 'center', marginTop: 12, marginBottom: 14 }} />

          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 14 }}>
            <Text style={{ fontFamily: 'Orbitron', fontSize: 13, color: theme.text, letterSpacing: 2, flex: 1 }}>
              ZARZĄDZAJ RANGAMI
            </Text>
            <TouchableOpacity
              style={{ backgroundColor: '#e33835', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}
              onPress={() => setCreating(v => !v)}
            >
              <MaterialIcons name={creating ? 'close' : 'add'} size={14} color="#fff" />
              <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: '#fff', fontWeight: '700' }}>
                {creating ? 'ANULUJ' : 'NOWA'}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

            {/* Formularz */}
            {creating && (
              <View style={{ backgroundColor: theme.surface2, borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: theme.border }}>
                <TextInput
                  style={{ backgroundColor: theme.bg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, color: theme.text, fontSize: 14, borderWidth: 1, borderColor: theme.border, marginBottom: 10 }}
                  value={newName} onChangeText={setNewName}
                  placeholder="Nazwa rangi" placeholderTextColor={theme.textDim} maxLength={30}
                />

                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginBottom: 6 }}>KOLOR</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  {COLORS.map(c => (
                    <TouchableOpacity
                      key={c}
                      style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c, borderWidth: newColor === c ? 3 : 0, borderColor: '#fff' }}
                      onPress={() => setNewColor(c)}
                    />
                  ))}
                </View>

                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, marginBottom: 8 }}>UPRAWNIENIA</Text>
                {PERM_LABELS.map(p => (
                  <TouchableOpacity
                    key={p.key}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.border }}
                    onPress={() => setPerms(prev => ({ ...prev, [p.key]: !prev[p.key] }))}
                  >
                    <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: perms[p.key] ? '#e33835' : theme.border, alignItems: 'center', justifyContent: 'center' }}>
                      {perms[p.key] && <MaterialIcons name="check" size={13} color="#fff" />}
                    </View>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.text }}>{p.label}</Text>
                  </TouchableOpacity>
                ))}

                <TouchableOpacity
                  style={[{ backgroundColor: '#e33835', borderRadius: 10, paddingVertical: 11, alignItems: 'center', marginTop: 12 }, saving && { opacity: 0.6 }]}
                  onPress={createRank} disabled={saving}
                >
                  {saving
                    ? <ActivityIndicator color="#fff" size={14} />
                    : <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: '#fff', fontWeight: '700' }}>UTWÓRZ RANGĘ</Text>
                  }
                </TouchableOpacity>
              </View>
            )}

            {/* Lista rang */}
            {ranks.length === 0 ? (
              <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.textDim, textAlign: 'center', marginTop: 20 }}>BRAK RANG</Text>
            ) : (
              ranks.map(rank => (
                <View key={rank.id} style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  backgroundColor: theme.surface2, borderRadius: 12, padding: 12, marginBottom: 8,
                  borderWidth: 1, borderColor: rank.color + '30',
                }}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: rank.color }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.text, fontWeight: '700' }}>{rank.name}</Text>
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                      {rank.canKick   && <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#e33835' }}>KICK</Text>}
                      {rank.canMute   && <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#ff922b' }}>MUTE</Text>}
                      {rank.canPin    && <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#00bfff' }}>PIN</Text>}
                      {rank.canManage && <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: '#4de926' }}>MANAGE</Text>}
                      {!rank.canKick && !rank.canMute && !rank.canPin && !rank.canManage && (
                        <Text style={{ fontFamily: 'Orbitron', fontSize: 7, color: theme.textDim }}>TYLKO TYTUŁ</Text>
                      )}
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => deleteRank(rank.id)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <MaterialIcons name="delete-outline" size={18} color="#e3383580" />
                  </TouchableOpacity>
                </View>
              ))
            )}
          </ScrollView>
    </ModalKeyboardSheet>
  );
}