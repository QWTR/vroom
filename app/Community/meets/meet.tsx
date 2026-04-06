import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  FlatList, Modal,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme }  from '../../../contexts/ThemeContext';

interface Participant {
  id: string; name: string; level: number; avatar?: string;
}
interface EventDetail {
  id: string; title: string; date: string; time: string;
  location: string; latitude: number; longitude: number;
  description: string; participants: number; maxParticipants: number;
  tags: string[]; status?: string; organizer: string; organizerLevel: number;
  participantsList: Participant[]; rules?: string[];
  whatToBring?: string[]; contactPhone?: string; contactEmail?: string;
}

const MOCK_EVENTS: { [key: string]: EventDetail } = {
  '1': { id: '1', title: 'Night Cruise Warszawa', date: '25.06.2024', time: '21:00', location: 'Plac Defonda, Warszawa', latitude: 52.2297, longitude: 21.0122, description: 'Nocny przejazd po ulicach Warszawy z grupą zapaleńców motoryzacji. Spotkamy się na Placu Defonda o godzinie 21:00. Trasę zaplanowaliśmy przez najpiękniejsze części miasta.', participants: 34, maxParticipants: 50, tags: ['NIGHT','CRUISE','STREET'], status: 'HOT', organizer: 'DriftKing92', organizerLevel: 47, participantsList: [{ id: '1', name: 'DriftKing92', level: 47, avatar: '👤' },{ id: '2', name: 'SpeedDemon', level: 32, avatar: '👤' },{ id: '3', name: 'TurboFan', level: 28, avatar: '👤' },{ id: '4', name: 'RacerX', level: 25, avatar: '👤' },{ id: '5', name: 'NitroKid', level: 19, avatar: '👤' }], rules: ['Zachowaj bezpieczną odległość między pojazdem','Przestrzegaj przepisów ruchu drogowego','Bądź gotów na 2-3 godziny jazdy','Zgłoś się 15 minut przed startem','Pojazd musi być sprawny technicznie'], whatToBring: ['Prawo jazdy','Dowód tożsamości','Paliwo','Napoje'], contactPhone: '+48 123 456 789', contactEmail: 'contact@vroom.pl' },
  '2': { id: '2', title: 'Track Day Poznań', date: '26.06.2024', time: '10:00', location: 'Tor Poznań', latitude: 52.0833, longitude: 16.7833, description: 'Profesjonalny tor wyścigowy w Poznaniu. Warto mieć doświadczenie!', participants: 12, maxParticipants: 30, tags: ['TRACK','RACING'], organizer: 'TrackMaster', organizerLevel: 56, participantsList: [{ id: '1', name: 'TrackMaster', level: 56, avatar: '👤' },{ id: '2', name: 'SpeedDemon', level: 32, avatar: '👤' }], rules: ['Obowiązkowy kask','Buty na pięcie','Pojazd musi przejść inspekcję'], whatToBring: ['Kask','Buty','Ubranie motorowe'], contactPhone: '+48 987 654 321', contactEmail: 'track@vroom.pl' },
  '3': { id: '3', title: 'JDM Meet Kraków', date: '27.06.2024', time: '16:00', location: 'Galeria Kazimierz, Kraków', latitude: 50.0647, longitude: 19.9450, description: 'Spotkanie entuzjastów samochodów JDM z całej Polski', participants: 47, maxParticipants: 60, tags: ['JDM','STATIC'], status: 'HOT', organizer: 'JDMKing', organizerLevel: 52, participantsList: [{ id: '1', name: 'JDMKing', level: 52, avatar: '👤' },{ id: '2', name: 'TokyoDrift', level: 38, avatar: '👤' }], rules: ['Samochód musi być w doskonałym stanie','Brak agresywnego zachowania'], whatToBring: ['Aparat fotograficzny','Napoje','Przekąski'], contactPhone: '+48 555 666 777', contactEmail: 'jdm@vroom.pl' },
  '4': { id: '4', title: 'Euro Cars Wrocław', date: '28.06.2024', time: '18:00', location: 'Hala Stulecia, Wrocław', latitude: 51.1079, longitude: 17.0385, description: 'Zlot europejskich samochodów - turbo, modyfikacje, tuning', participants: 8, maxParticipants: 40, tags: ['EURO','SHOW'], organizer: 'EuroTuner', organizerLevel: 44, participantsList: [{ id: '1', name: 'EuroTuner', level: 44, avatar: '👤' }], rules: ['Pojazd musi być zarejestrowany','Obowiązkowe OC'], whatToBring: ['Dokumenty pojazdu','Dowód tożsamości'], contactPhone: '+48 111 222 333', contactEmail: 'euro@vroom.pl' },
};

export default function MeetDetailScreen() {
  const router  = useRouter();
  const params  = useLocalSearchParams();
  const { theme } = useTheme();

  const [isJoined,               setIsJoined]               = useState(false);
  const [participantsModalVisible,setParticipantsModalVisible]= useState(false);
  const [event,                  setEvent]                  = useState<EventDetail | null>(null);

  useEffect(() => {
    const id = params.id as string;
    setEvent(MOCK_EVENTS[id] ?? MOCK_EVENTS['1']);
  }, [params.id]);

  if (!event) return (
    <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ color: theme.text, fontFamily: 'Orbitron' }}>Ładowanie...</Text>
    </View>
  );

  const availableSpots   = event.maxParticipants - event.participants;
  const capacityPercent  = (event.participants / event.maxParticipants) * 100;

  const renderParticipantItem = ({ item }: { item: Participant }) => (
    <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.surface3, borderRadius: 8, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: theme.border2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
        <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: `${theme.primary}30`, borderWidth: 1, borderColor: theme.primaryBorder, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ fontSize: 20 }}>{item.avatar ?? '👤'}</Text>
        </View>
        <View style={{ gap: 6 }}>
          <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 12, fontWeight: '600' }}>{item.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.surface4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, alignSelf: 'flex-start' }}>
            <MaterialIcons name="star" size={12} color="#FFD700" />
            <Text style={{ color: '#FFD700', fontFamily: 'Orbitron', fontSize: 10, fontWeight: '600' }}>Lv. {item.level}</Text>
          </View>
        </View>
      </View>
      <TouchableOpacity style={{ padding: 8, backgroundColor: theme.surface4, borderRadius: 6 }}>
        <MaterialIcons name="message" size={18} color={theme.primary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bgAlt, paddingHorizontal: '5%', paddingBottom: 30, paddingTop: 40 }} showsVerticalScrollIndicator={false}>

      {/* Back */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 15, marginBottom: 20 }}>
        <TouchableOpacity onPress={() => router.back()}>
          <MaterialIcons name="arrow-back-ios" size={24} color={theme.text} />
        </TouchableOpacity>
        <TouchableOpacity style={{ padding: 8 }}>
          <MaterialIcons name="share" size={24} color={theme.primary} />
        </TouchableOpacity>
      </View>

      {/* Hero */}
      <View style={{ marginBottom: 20 }}>
        <View style={{ backgroundColor: theme.surface3, borderRadius: 12, height: 120, justifyContent: 'center', alignItems: 'center', marginBottom: 16, opacity: 0.6 }}>
          <MaterialIcons name="local-gas-station" size={80} color={theme.border3} />
        </View>
        <View style={{ gap: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontSize: 24, color: theme.text, fontFamily: 'Orbitron', fontWeight: '700', flex: 1 }}>{event.title}</Text>
            {event.status && (
              <Text style={{ backgroundColor: theme.primary, color: '#fff', fontSize: 10, fontFamily: 'Orbitron', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4, fontWeight: '700' }}>{event.status}</Text>
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.surface3, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.border2 }}>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: `${theme.primary}30`, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.primaryBorder }}>
              <Text style={{ fontSize: 24 }}>👤</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 10 }}>Organizator</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 13, fontWeight: '600' }}>{event.organizer}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.surface4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 }}>
                  <MaterialIcons name="star" size={12} color="#FFD700" />
                  <Text style={{ color: '#FFD700', fontFamily: 'Orbitron', fontSize: 11, fontWeight: '600' }}>{event.organizerLevel}</Text>
                </View>
              </View>
            </View>
          </View>
        </View>
      </View>

      {/* Quick info */}
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
        {[
          { icon: 'access-time', label: 'Godzina', value: event.time },
          { icon: 'location-on', label: 'Lokalizacja', value: event.location.split(',')[1]?.trim() ?? 'Brak' },
          { icon: 'people',      label: 'Osoby',    value: `${event.participants}/${event.maxParticipants}` },
        ].map(info => (
          <View key={info.label} style={{ flex: 1, backgroundColor: theme.surface3, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: theme.border2, alignItems: 'center', gap: 8 }}>
            <MaterialIcons name={info.icon as any} size={20} color={theme.primary} />
            <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 9 }}>{info.label}</Text>
            <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 12, fontWeight: '600', textAlign: 'center' }}>{info.value}</Text>
          </View>
        ))}
      </View>

      {/* Capacity */}
      <View style={{ backgroundColor: theme.surface3, borderRadius: 8, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: theme.border2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
          <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 12 }}>Dostępne miejsca</Text>
          <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 14, fontWeight: '600' }}>{availableSpots} z {event.maxParticipants}</Text>
        </View>
        <View style={{ height: 8, backgroundColor: theme.border2, borderRadius: 4, marginBottom: 12, overflow: 'hidden' }}>
          <View style={{ height: '100%', backgroundColor: theme.primary, borderRadius: 4, width: `${capacityPercent}%` }} />
        </View>
        <View style={{ flexDirection: 'row', gap: 16 }}>
          {[
            { color: theme.primary, label: `${event.participants} zarejestrowanych` },
            { color: theme.border3, label: `${availableSpots} dostępnych` },
          ].map(s => (
            <View key={s.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color }} />
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 10 }}>{s.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Tags */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {event.tags.map((tag, i) => (
          <View key={i} style={{ backgroundColor: theme.surface4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: theme.primary }}>
            <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '600' }}>{tag}</Text>
          </View>
        ))}
      </View>

      {/* Description */}
      <View style={{ marginBottom: 20 }}>
        <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 16, fontWeight: '600', marginBottom: 12 }}>O spotkaniu</Text>
        <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 12, lineHeight: 18 }}>{event.description}</Text>
      </View>

      {/* Location */}
      <View style={{ marginBottom: 20 }}>
        <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 16, fontWeight: '600', marginBottom: 12 }}>Lokalizacja</Text>
        <TouchableOpacity style={{ backgroundColor: theme.surface3, borderRadius: 8, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: theme.border2 }}>
          <MaterialIcons name="location-on" size={24} color={theme.primary} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 13, fontWeight: '600', marginBottom: 4 }}>{event.location}</Text>
            <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 10 }}>{event.latitude.toFixed(4)}, {event.longitude.toFixed(4)}</Text>
          </View>
          <MaterialIcons name="open-in-new" size={20} color={theme.textDim} />
        </TouchableOpacity>
      </View>

      {/* Rules */}
      {!!event.rules?.length && (
        <View style={{ marginBottom: 20 }}>
          <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 16, fontWeight: '600', marginBottom: 12 }}>Regulamin</Text>
          {event.rules.map((rule, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 12, marginBottom: 12, alignItems: 'flex-start' }}>
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: `${theme.primary}30`, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.primaryBorder }}>
                <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 14, fontWeight: '700' }}>{i + 1}</Text>
              </View>
              <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 12, flex: 1, marginTop: 8, lineHeight: 16 }}>{rule}</Text>
            </View>
          ))}
        </View>
      )}

      {/* What to bring */}
      {!!event.whatToBring?.length && (
        <View style={{ marginBottom: 20 }}>
          <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 16, fontWeight: '600', marginBottom: 12 }}>Co zabrać</Text>
          <View style={{ gap: 10 }}>
            {event.whatToBring.map((item, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: theme.surface3, padding: 12, borderRadius: 6, borderWidth: 1, borderColor: theme.border2 }}>
                <MaterialIcons name="check-circle" size={18} color={theme.online} />
                <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 12 }}>{item}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Participants */}
      <View style={{ marginBottom: 20 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 16, fontWeight: '600' }}>Uczestnicy</Text>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} onPress={() => setParticipantsModalVisible(true)}>
            <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '600' }}>Zobacz wszystkich ({event.participants})</Text>
            <MaterialIcons name="arrow-forward-ios" size={14} color={theme.primary} />
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {event.participantsList.slice(0, 3).map(p => (
            <View key={p.id} style={{ marginHorizontal: -8 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: `${theme.primary}30`, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: theme.bgAlt }}>
                <Text style={{ fontSize: 18 }}>{p.avatar}</Text>
              </View>
            </View>
          ))}
          {event.participants > 3 && (
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.surface4, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: theme.bgAlt }}>
              <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 11, fontWeight: '600' }}>+{event.participants - 3}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Contact */}
      <View style={{ marginBottom: 20 }}>
        <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 16, fontWeight: '600', marginBottom: 12 }}>Kontakt</Text>
        {[
          { icon: 'phone', value: event.contactPhone },
          { icon: 'email', value: event.contactEmail },
        ].map(c => (
          <TouchableOpacity key={c.icon} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.surface3, padding: 12, borderRadius: 6, marginBottom: 10, borderWidth: 1, borderColor: theme.border2 }}>
            <MaterialIcons name={c.icon as any} size={20} color={theme.primary} />
            <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 12, flex: 1 }}>{c.value}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Actions */}
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
        <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: theme.surface3, borderWidth: 1, borderColor: theme.primaryBorder, borderRadius: 8, paddingVertical: 14 }}>
          <MaterialIcons name="info-outline" size={20} color={theme.primary} />
          <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 12, fontWeight: '600' }}>Więcej info</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: theme.primary, borderRadius: 8, paddingVertical: 14 },
            isJoined && { backgroundColor: `${theme.online}50`, borderWidth: 1, borderColor: theme.online }]}
          onPress={() => setIsJoined(j => !j)}
        >
          <MaterialIcons name={isJoined ? 'check-circle' : 'add-circle-outline'} size={20} color={isJoined ? theme.online : '#fff'} />
          <Text style={{ color: isJoined ? theme.online : '#fff', fontFamily: 'Orbitron', fontSize: 12, fontWeight: '600' }}>
            {isJoined ? 'Dołączono!' : 'Dołącz'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Participants Modal */}
      <Modal visible={participantsModalVisible} animationType="slide" transparent onRequestClose={() => setParticipantsModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: theme.overlay, justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: theme.bgAlt, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: '5%', paddingTop: 20, maxHeight: '90%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: theme.border2 }}>
              <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 18, fontWeight: '600' }}>Uczestnicy ({event.participants})</Text>
              <TouchableOpacity onPress={() => setParticipantsModalVisible(false)}>
                <MaterialIcons name="close" size={24} color={theme.text} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={event.participantsList} renderItem={renderParticipantItem}
              keyExtractor={item => item.id} style={{ marginBottom: 20 }}
            />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}