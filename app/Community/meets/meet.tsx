import React, { useState, useEffect } from 'react';
import { Text } from '@react-navigation/elements';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Modal,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';

// Icons
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

const Orbitron = require('../../../assets/fonts/Orbitron/Orbitron-VariableFont_wght.ttf');

// Types
interface Participant {
  id: string;
  name: string;
  level: number;
  avatar?: string;
}

interface EventDetail {
  id: string;
  title: string;
  date: string;
  time: string;
  location: string;
  latitude: number;
  longitude: number;
  description: string;
  participants: number;
  maxParticipants: number;
  tags: string[];
  status?: string;
  organizer: string;
  organizerLevel: number;
  participantsList: Participant[];
  rules?: string[];
  whatToBring?: string[];
  contactPhone?: string;
  contactEmail?: string;
}

// Mock Data - w przyszłości będzie z API
const MOCK_EVENTS: { [key: string]: EventDetail } = {
  '1': {
    id: '1',
    title: 'Night Cruise Warszawa',
    date: '25.06.2024',
    time: '21:00',
    location: 'Plac Defonda, Warszawa',
    latitude: 52.2297,
    longitude: 21.0122,
    description:
      'Nocny przejazd po ulicach Warszawy z grupą zapaleńców motoryzacji. Spotkamy się na Placu Defonda o godzinie 21:00. Trasę zaplanowaliśmy przez najpiękniejsze części miasta.',
    participants: 34,
    maxParticipants: 50,
    tags: ['NIGHT', 'CRUISE', 'STREET'],
    status: 'HOT',
    organizer: 'DriftKing92',
    organizerLevel: 47,
    participantsList: [
      { id: '1', name: 'DriftKing92', level: 47, avatar: '👤' },
      { id: '2', name: 'SpeedDemon', level: 32, avatar: '👤' },
      { id: '3', name: 'TurboFan', level: 28, avatar: '👤' },
      { id: '4', name: 'RacerX', level: 25, avatar: '👤' },
      { id: '5', name: 'NitroKid', level: 19, avatar: '👤' },
    ],
    rules: [
      'Zachowaj bezpieczną odległość między pojazdem',
      'Przestrzegaj przepisów ruchu drogowego',
      'Bądź gotów na 2-3 godziny jazdy',
      'Zgłoś si�� 15 minut przed startem',
      'Pojazd musi być sprawny technicznie',
    ],
    whatToBring: ['Prawo jazdy', 'Dowód tożsamości', 'Paliwo', 'Napoje'],
    contactPhone: '+48 123 456 789',
    contactEmail: 'contact@vroom.pl',
  },
  '2': {
    id: '2',
    title: 'Track Day Poznań',
    date: '26.06.2024',
    time: '10:00',
    location: 'Tor Poznań',
    latitude: 52.0833,
    longitude: 16.7833,
    description: 'Profesjonalny tor wyścigowy w Poznaniu. Warto mieć doświadczenie!',
    participants: 12,
    maxParticipants: 30,
    tags: ['TRACK', 'RACING'],
    organizer: 'TrackMaster',
    organizerLevel: 56,
    participantsList: [
      { id: '1', name: 'TrackMaster', level: 56, avatar: '👤' },
      { id: '2', name: 'SpeedDemon', level: 32, avatar: '👤' },
    ],
    rules: [
      'Obowiązkowy kask',
      'Buty na pięcie',
      'Pojazd musi przejść inspekcję',
    ],
    whatToBring: ['Kask', 'Buty', 'Ubranie motorowe'],
    contactPhone: '+48 987 654 321',
    contactEmail: 'track@vroom.pl',
  },
  '3': {
    id: '3',
    title: 'JDM Meet Kraków',
    date: '27.06.2024',
    time: '16:00',
    location: 'Galeria Kazimierz, Kraków',
    latitude: 50.0647,
    longitude: 19.9450,
    description: 'Spotkanie entuzjastów samochodów JDM z całej Polski',
    participants: 47,
    maxParticipants: 60,
    tags: ['JDM', 'STATIC'],
    status: 'HOT',
    organizer: 'JDMKing',
    organizerLevel: 52,
    participantsList: [
      { id: '1', name: 'JDMKing', level: 52, avatar: '👤' },
      { id: '2', name: 'TokyoDrift', level: 38, avatar: '👤' },
    ],
    rules: [
      'Samochód musi być w doskonałym stanie',
      'Brak agresywnego zachowania',
    ],
    whatToBring: ['Aparat fotograficzny', 'Napoje', 'Przekąski'],
    contactPhone: '+48 555 666 777',
    contactEmail: 'jdm@vroom.pl',
  },
  '4': {
    id: '4',
    title: 'Euro Cars Wrocław',
    date: '28.06.2024',
    time: '18:00',
    location: 'Hala Stulecia, Wrocław',
    latitude: 51.1079,
    longitude: 17.0385,
    description: 'Zlot europejskich samochodów - turbo, modyfikacje, tuning',
    participants: 8,
    maxParticipants: 40,
    tags: ['EURO', 'SHOW'],
    organizer: 'EuroTuner',
    organizerLevel: 44,
    participantsList: [
      { id: '1', name: 'EuroTuner', level: 44, avatar: '👤' },
    ],
    rules: ['Pojazd musi być zarejestrowany', 'Obowiązkowe OC'],
    whatToBring: ['Dokumenty pojazdu', 'Dowód tożsamości'],
    contactPhone: '+48 111 222 333',
    contactEmail: 'euro@vroom.pl',
  },
};

export default function MeetDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [isJoined, setIsJoined] = useState(false);
  const [participantsModalVisible, setParticipantsModalVisible] = useState(false);
  const [event, setEvent] = useState<EventDetail | null>(null);

  // Pobierz event na podstawie ID z params
  useEffect(() => {
    const eventId = params.id as string;
    if (eventId && MOCK_EVENTS[eventId]) {
      setEvent(MOCK_EVENTS[eventId]);
    } else {
      // Jeśli nie znaleziono, ustaw domyślny
      setEvent(MOCK_EVENTS['1']);
    }
  }, [params.id]);

  if (!event) {
    return (
      <View style={styles.container}>
        <Text style={{ color: '#fff', fontFamily: 'Orbitron' }}>Ładowanie...</Text>
      </View>
    );
  }

  const availableSpots = event.maxParticipants - event.participants;
  const capacityPercent = (event.participants / event.maxParticipants) * 100;

  const handleJoinEvent = () => {
    setIsJoined(!isJoined);
  };

  const renderParticipantItem = ({ item }: { item: Participant }) => (
    <TouchableOpacity style={styles.participantCard}>
      <View style={styles.participantInfo}>
        <View style={styles.participantAvatar}>
          <Text style={styles.avatarText}>{item.avatar || '👤'}</Text>
        </View>
        <View style={styles.participantDetails}>
          <Text style={styles.participantName}>{item.name}</Text>
          <View style={styles.levelBadge}>
            <MaterialIcons name="star" size={12} color="#FFD700" />
            <Text style={styles.levelText}>Lv. {item.level}</Text>
          </View>
        </View>
      </View>
      <TouchableOpacity style={styles.messageButton}>
        <MaterialIcons name="message" size={18} color="#e33835ce" />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Back Button */}
      <View style={styles.backButton}>
        <TouchableOpacity onPress={() => router.back()}>
          <MaterialIcons name="arrow-back-ios" size={24} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.shareButton}>
          <MaterialIcons name="share" size={24} color="#e33835ce" />
        </TouchableOpacity>
      </View>

      {/* Hero Section */}
      <View style={styles.heroSection}>
        <View style={styles.heroBackground}>
          <MaterialIcons name="local-gas-station" size={80} color="#ffffff20" />
        </View>
        <View style={styles.heroContent}>
          <View style={styles.titleSection}>
            <Text style={styles.title}>{event.title}</Text>
            {event.status && <Text style={styles.hotBadge}>{event.status}</Text>}
          </View>
          <View style={styles.organizerInfo}>
            <View style={styles.organizerAvatar}>
              <Text style={styles.avatarText}>👤</Text>
            </View>
            <View style={styles.organizerDetails}>
              <Text style={styles.organizerLabel}>Organizator</Text>
              <View style={styles.organizerNameRow}>
                <Text style={styles.organizerName}>{event.organizer}</Text>
                <View style={styles.organizerLevel}>
                  <MaterialIcons name="star" size={12} color="#FFD700" />
                  <Text style={styles.levelNumber}>{event.organizerLevel}</Text>
                </View>
              </View>
            </View>
          </View>
        </View>
      </View>

      {/* Quick Info Cards */}
      <View style={styles.quickInfoRow}>
        <View style={styles.quickInfoCard}>
          <MaterialIcons name="access-time" size={20} color="#e33835ce" />
          <Text style={styles.quickInfoLabel}>Godzina</Text>
          <Text style={styles.quickInfoValue}>{event.time}</Text>
        </View>
        <View style={styles.quickInfoCard}>
          <MaterialIcons name="location-on" size={20} color="#e33835ce" />
          <Text style={styles.quickInfoLabel}>Lokalizacja</Text>
          <Text style={styles.quickInfoValue}>
            {event.location.split(',')[1] || 'Bez miasta'}
          </Text>
        </View>
        <View style={styles.quickInfoCard}>
          <MaterialIcons name="people" size={20} color="#e33835ce" />
          <Text style={styles.quickInfoLabel}>Osoby</Text>
          <Text style={styles.quickInfoValue}>
            {event.participants}/{event.maxParticipants}
          </Text>
        </View>
      </View>

      {/* Capacity Bar */}
      <View style={styles.capacitySection}>
        <View style={styles.capacityHeader}>
          <Text style={styles.capacityLabel}>Dostępne miejsca</Text>
          <Text style={styles.capacityValue}>
            {availableSpots} z {event.maxParticipants}
          </Text>
        </View>
        <View style={styles.progressBarLarge}>
          <View
            style={[
              styles.progressFillLarge,
              { width: `${capacityPercent}%` },
            ]}
          />
        </View>
        <View style={styles.capacityStats}>
          <View style={styles.statItem}>
            <View style={styles.statDot}></View>
            <Text style={styles.statText}>
              {event.participants} zarejestrowanych
            </Text>
          </View>
          <View style={styles.statItem}>
            <View style={[styles.statDot, { backgroundColor: '#ffffff30' }]}></View>
            <Text style={styles.statText}>{availableSpots} dostępnych</Text>
          </View>
        </View>
      </View>

      {/* Tags */}
      <View style={styles.tagsSection}>
        {event.tags.map((tag, index) => (
          <View key={index} style={styles.tag}>
            <Text style={styles.tagText}>{tag}</Text>
          </View>
        ))}
      </View>

      {/* Description */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>O spotkaniu</Text>
        <Text style={styles.description}>{event.description}</Text>
      </View>

      {/* Location */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Lokalizacja</Text>
        <TouchableOpacity style={styles.locationCard}>
          <MaterialIcons name="location-on" size={24} color="#e33835ce" />
          <View style={{ flex: 1 }}>
            <Text style={styles.locationTitle}>{event.location}</Text>
            <Text style={styles.locationSubtitle}>
              {event.latitude.toFixed(4)}, {event.longitude.toFixed(4)}
            </Text>
          </View>
          <MaterialIcons name="open-in-new" size={20} color="#ffffff50" />
        </TouchableOpacity>
      </View>

      {/* Rules */}
      {event.rules && event.rules.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Regulamin</Text>
          {event.rules.map((rule, index) => (
            <View key={index} style={styles.ruleItem}>
              <View style={styles.ruleNumber}>
                <Text style={styles.ruleNumberText}>{index + 1}</Text>
              </View>
              <Text style={styles.ruleText}>{rule}</Text>
            </View>
          ))}
        </View>
      )}

      {/* What to Bring */}
      {event.whatToBring && event.whatToBring.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Co zabrać</Text>
          <View style={styles.checklistContainer}>
            {event.whatToBring.map((item, index) => (
              <View key={index} style={styles.checklistItem}>
                <MaterialIcons name="check-circle" size={18} color="#4de926" />
                <Text style={styles.checklistText}>{item}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Participants */}
      <View style={styles.section}>
        <View style={styles.participantsHeader}>
          <Text style={styles.sectionTitle}>Uczestnicy</Text>
          <TouchableOpacity
            onPress={() => setParticipantsModalVisible(true)}
            style={styles.viewAllButton}
          >
            <Text style={styles.viewAllText}>
              Zobacz wszystkich ({event.participants})
            </Text>
            <MaterialIcons name="arrow-forward-ios" size={14} color="#e33835ce" />
          </TouchableOpacity>
        </View>
        <View style={styles.participantsPreview}>
          {event.participantsList.slice(0, 3).map((participant) => (
            <View key={participant.id} style={styles.avatarStack}>
              <View style={styles.smallAvatar}>
                <Text style={styles.smallAvatarText}>{participant.avatar}</Text>
              </View>
            </View>
          ))}
          {event.participants > 3 && (
            <View style={styles.moreAvatars}>
              <Text style={styles.moreAvatarsText}>+{event.participants - 3}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Contact */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Kontakt</Text>
        <TouchableOpacity style={styles.contactItem}>
          <MaterialIcons name="phone" size={20} color="#e33835ce" />
          <Text style={styles.contactText}>{event.contactPhone}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.contactItem}>
          <MaterialIcons name="email" size={20} color="#e33835ce" />
          <Text style={styles.contactText}>{event.contactEmail}</Text>
        </TouchableOpacity>
      </View>

      {/* Action Buttons */}
      <View style={styles.actionButtons}>
        <TouchableOpacity style={styles.secondaryButton}>
          <MaterialIcons name="info-outline" size={20} color="#e33835ce" />
          <Text style={styles.secondaryButtonText}>Więcej info</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryButton, isJoined && styles.joinedButton]}
          onPress={handleJoinEvent}
        >
          <MaterialIcons
            name={isJoined ? 'check-circle' : 'add-circle-outline'}
            size={20}
            color={isJoined ? '#4de926' : '#fff'}
          />
          <Text
            style={[
              styles.primaryButtonText,
              isJoined && styles.joinedButtonText,
            ]}
          >
            {isJoined ? 'Dołączono!' : 'Dołącz'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Participants Modal */}
      <Modal
        visible={participantsModalVisible}
        animationType="slide"
        transparent={true}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Uczestnicy ({event.participants})</Text>
              <TouchableOpacity
                onPress={() => setParticipantsModalVisible(false)}
              >
                <MaterialIcons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={event.participantsList}
              renderItem={renderParticipantItem}
              keyExtractor={(item) => item.id}
              scrollEnabled={true}
              style={{ marginBottom: 20 }}
            />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f0f',
    paddingHorizontal: '5%',
    paddingBottom: 30,
    paddingTop: 40,
  },
  backButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 15,
    marginBottom: 20,
  },
  shareButton: {
    padding: 8,
  },
  heroSection: {
    marginBottom: 20,
  },
  heroBackground: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    opacity: 0.6,
  },
  heroContent: {
    gap: 16,
  },
  titleSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontSize: 24,
    color: '#fff',
    fontFamily: 'Orbitron',
    fontWeight: '700',
    flex: 1,
  },
  hotBadge: {
    backgroundColor: '#e33835',
    color: '#fff',
    fontSize: 10,
    fontFamily: 'Orbitron',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    fontWeight: '700',
  },
  organizerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1a1a1a',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ffffff15',
  },
  organizerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#e338354b',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e33835ce',
  },
  avatarText: {
    fontSize: 24,
  },
  organizerDetails: {
    flex: 1,
  },
  organizerLabel: {
    color: '#ffffff70',
    fontFamily: 'Orbitron',
    fontSize: 10,
  },
  organizerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  organizerName: {
    color: '#fff',
    fontFamily: 'Orbitron',
    fontSize: 13,
    fontWeight: '600',
  },
  organizerLevel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ffffff10',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  levelNumber: {
    color: '#FFD700',
    fontFamily: 'Orbitron',
    fontSize: 11,
    fontWeight: '600',
  },
  quickInfoRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  quickInfoCard: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ffffff15',
    alignItems: 'center',
    gap: 8,
  },
  quickInfoLabel: {
    color: '#ffffff70',
    fontFamily: 'Orbitron',
    fontSize: 9,
  },
  quickInfoValue: {
    color: '#fff',
    fontFamily: 'Orbitron',
    fontSize: 12,
    fontWeight: '600',
  },
  capacitySection: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#ffffff15',
  },
  capacityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  capacityLabel: {
    color: '#ffffff70',
    fontFamily: 'Orbitron',
    fontSize: 12,
  },
  capacityValue: {
    color: '#fff',
    fontFamily: 'Orbitron',
    fontSize: 14,
    fontWeight: '600',
  },
  progressBarLarge: {
    height: 8,
    backgroundColor: '#ffffff10',
    borderRadius: 4,
    marginBottom: 12,
    overflow: 'hidden',
  },
  progressFillLarge: {
    height: '100%',
    backgroundColor: '#e33835',
    borderRadius: 4,
  },
  capacityStats: {
    flexDirection: 'row',
    gap: 16,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#e33835',
  },
  statText: {
    color: '#ffffff70',
    fontFamily: 'Orbitron',
    fontSize: 10,
  },
  tagsSection: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  tag: {
    backgroundColor: '#ffffff10',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e33835',
  },
  tagText: {
    color: '#e33835',
    fontFamily: 'Orbitron',
    fontSize: 11,
    fontWeight: '600',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    color: '#fff',
    fontFamily: 'Orbitron',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  description: {
    color: '#ffffff80',
    fontFamily: 'Orbitron',
    fontSize: 12,
    lineHeight: 18,
  },
  locationCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#ffffff15',
  },
  locationTitle: {
    color: '#fff',
    fontFamily: 'Orbitron',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  locationSubtitle: {
    color: '#ffffff70',
    fontFamily: 'Orbitron',
    fontSize: 10,
  },
  ruleItem: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
    alignItems: 'flex-start',
  },
  ruleNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#e338354b',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e33835ce',
  },
  ruleNumberText: {
    color: '#e33835ce',
    fontFamily: 'Orbitron',
    fontSize: 14,
    fontWeight: '700',
  },
  ruleText: {
    color: '#ffffff80',
    fontFamily: 'Orbitron',
    fontSize: 12,
    flex: 1,
    marginTop: 8,
    lineHeight: 16,
  },
  checklistContainer: {
    gap: 10,
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#1a1a1a',
    padding: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ffffff10',
  },
  checklistText: {
    color: '#ffffff80',
    fontFamily: 'Orbitron',
    fontSize: 12,
  },
  participantsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  viewAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  viewAllText: {
    color: '#e33835ce',
    fontFamily: 'Orbitron',
    fontSize: 11,
    fontWeight: '600',
  },
  participantsPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  avatarStack: {
    marginHorizontal: -8,
  },
  smallAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e338354b',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#0f0f0f',
  },
  smallAvatarText: {
    fontSize: 18,
  },
  moreAvatars: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ffffff20',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#0f0f0f',
  },
  moreAvatarsText: {
    color: '#fff',
    fontFamily: 'Orbitron',
    fontSize: 11,
    fontWeight: '600',
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1a1a1a',
    padding: 12,
    borderRadius: 6,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#ffffff10',
  },
  contactText: {
    color: '#ffffff80',
    fontFamily: 'Orbitron',
    fontSize: 12,
    flex: 1,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#e33835ce',
    borderRadius: 8,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: '#e33835ce',
    fontFamily: 'Orbitron',
    fontSize: 12,
    fontWeight: '600',
  },
  primaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#e33835',
    borderRadius: 8,
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: '#fff',
    fontFamily: 'Orbitron',
    fontSize: 12,
    fontWeight: '600',
  },
  joinedButton: {
    backgroundColor: '#4de92650',
    borderWidth: 1,
    borderColor: '#4de926',
  },
  joinedButtonText: {
    color: '#4de926',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: '#000000aa',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#0f0f0f',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: '5%',
    paddingTop: 20,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff15',
  },
  modalTitle: {
    color: '#fff',
    fontFamily: 'Orbitron',
    fontSize: 18,
    fontWeight: '600',
  },
  participantCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#ffffff15',
  },
  participantInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  participantDetails: {
    gap: 6,
  },
  participantName: {
    color: '#fff',
    fontFamily: 'Orbitron',
    fontSize: 12,
    fontWeight: '600',
  },
  levelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ffffff10',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  levelText: {
    color: '#FFD700',
    fontFamily: 'Orbitron',
    fontSize: 10,
    fontWeight: '600',
  },
  messageButton: {
    padding: 8,
    backgroundColor: '#ffffff10',
    borderRadius: 6,
  },
});