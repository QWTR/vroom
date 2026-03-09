import React, { useState } from 'react';
import { Text } from '@react-navigation/elements';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
} from 'react-native';
import { useRouter } from 'expo-router';

// Icons
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

// FONTS
const Orbitron = require('../../../assets/fonts/Orbitron/Orbitron-VariableFont_wght.ttf');

// Types
interface Event {
  id: string;
  title: string;
  date: string;
  time: string;
  location: string;
  participants: number;
  maxParticipants: number;
  tags: string[];
  status?: string;
  description?: string;
}

// Mock Data
const MOCK_EVENTS: Event[] = [
  {
    id: '1',
    title: 'Night Cruise Warszawa',
    date: 'Czw, 21:00',
    time: '21:00',
    location: 'Pł. Defonda, Warszawa',
    participants: 34,
    maxParticipants: 50,
    tags: ['NIGHT', 'CRUISE'],
    status: 'HOT',
    description: 'Nocny przejazd po Warszawie',
  },
  {
    id: '2',
    title: 'Track Day Poznań',
    date: 'Sob, 10:00',
    time: '10:00',
    location: 'Tor Poznań',
    participants: 12,
    maxParticipants: 30,
    tags: ['TRACK', 'RACING'],
    description: 'Tor wyścigowy Poznań',
  },
  {
    id: '3',
    title: 'JDM Meet Kraków',
    date: 'Ndz, 16:00',
    time: '16:00',
    location: 'Galeria Kazimierz, Kraków',
    participants: 47,
    maxParticipants: 60,
    tags: ['JDM', 'STATIC'],
    status: 'HOT',
    description: 'Spotkanie miłośników JDM',
  },
  {
    id: '4',
    title: 'Euro Cars Wrocław',
    date: 'Pon, 18:00',
    time: '18:00',
    location: 'Hala Stulecia, Wrocław',
    participants: 8,
    maxParticipants: 40,
    tags: ['EURO', 'SHOW'],
    description: 'Zlot samochodów europejskich',
  },
];

const FILTER_TABS = ['Wszystkie', 'Dziś', 'Ten tydzień', 'Blisko mnie'];

export default function EventsScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('Wszystkie');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredEvents = MOCK_EVENTS.filter((event) => {
    const matchesSearch = event.title
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  const renderEventCard = ({ item }: { item: Event }) => (
    <TouchableOpacity
      style={styles.eventCard}
      onPress={() => router.push({
        pathname: '/Community/meets/meet',
        params: { id: item.id }
      })}

    >
      <View style={styles.eventHeader}>
        <View style={styles.eventTitleSection}>
          <Text style={styles.eventTitle}>{item.title}</Text>
        </View>
        <View>
          {item.status && <Text style={styles.hotBadge}>{item.status}</Text>}
        </View>
        <View style={styles.participantsInfo}>
          <MaterialIcons name="people" size={14} color="#ffffff70" />
          <Text style={styles.participantsText}>
            {item.participants}/{item.maxParticipants}
          </Text>
        </View>
      </View>

      <View style={styles.eventDetails}>
        <View style={styles.detailRow}>
          <MaterialIcons name="access-time" size={14} color="#ffffff70" />
          <Text style={styles.detailText}>{item.date}</Text>
        </View>
        <View style={styles.detailRow}>
          <MaterialIcons name="location-on" size={14} color="#ffffff70" />
          <Text style={styles.detailText}>{item.location}</Text>
        </View>
      </View>

      <View style={styles.tagsContainer}>
        {item.tags.map((tag, index) => (
          <View key={index} style={styles.tag}>
            <Text style={styles.tagText}>{tag}</Text>
          </View>
        ))}
      </View>

      <View style={styles.progressBar}>
        <View
          style={[
            styles.progressFill,
            {
              width: `${(item.participants / item.maxParticipants) * 100}%`,
            },
          ]}
        />
      </View>

      <View style={styles.cardFooter}>
        <Text style={styles.footerText}>
          {item.maxParticipants - item.participants} miejsc dostępnych
        </Text>
        <MaterialIcons name="arrow-forward-ios" size={14} color="#e33835cece" />
      </View>
    </TouchableOpacity>
  );

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.headerSection}>
        <View>
          <Text style={styles.headerTitle}>MEETY</Text>
          <Text style={styles.headerSubtitle}>NADBÓDZ ORAZ ZLOTY</Text>
        </View>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => router.push('/Community/createmeet')}
        >
          <MaterialIcons name="add" size={28} color="#ffffff" />
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <MaterialIcons
          name="search"
          size={20}
          color="#ffffff50"
          style={styles.searchIcon}
        />
        <TextInput
          style={styles.searchInput}
          placeholder="Szukaj złotu..."
          placeholderTextColor="#ffffff50"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        <TouchableOpacity style={styles.filterButton}>
          <MaterialIcons name="tune" size={20} color="#e33835cece" />
        </TouchableOpacity>
      </View>

      {/* Filter Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
      >
        {FILTER_TABS.map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[
              styles.tab,
              activeTab === tab && styles.activeTab,
            ]}
            onPress={() => setActiveTab(tab)}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === tab && styles.activeTabText,
              ]}
            >
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Events List */}
      <View style={styles.eventsContainer}>
        {filteredEvents.length > 0 ? (
          <FlatList
            data={filteredEvents}
            renderItem={renderEventCard}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
          />
        ) : (
          <View style={styles.emptyState}>
            <MaterialIcons name="event-busy" size={48} color="#ffffff30" />
            <Text style={styles.emptyStateText}>Brak wydarzeń</Text>
            <Text style={styles.emptyStateSubtext}>
              Spróbuj zmienić filtry lub wyszukaj inny termin
            </Text>
          </View>
        )}
      </View>

      {/* Call to Action Card */}
      <TouchableOpacity
        style={styles.ctaCard}
        onPress={() => router.push('/Community/createmeet')}
      >
        <MaterialIcons
          name="add-circle-outline"
          size={32}
          color="#e33835cece"
        />
        <View style={styles.ctaContent}>
          <Text style={styles.ctaTitle}>Organizuj swoje spotkanie</Text>
          <Text style={styles.ctaSubtitle}>
            Zaproś przyjaciół na wspólny przejazd
          </Text>
        </View>
        <MaterialIcons name="arrow-forward-ios" size={20} color="#e33835cece" />
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f0f',
    paddingHorizontal: '5%',
    paddingBottom: 30,
  },
  headerSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginTop: 60,
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 31,
    color: '#fff',
    fontFamily: 'Orbitron',
    fontWeight: '600',
    letterSpacing: 2,
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#ffffff60',
    fontFamily: 'Orbitron',
    marginTop: 5,
    textTransform: 'uppercase',
  },
  addButton: {
    width: 55,
    height: 55,
    borderRadius: 28,
    backgroundColor: '#e33835cece',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#e33835ce',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 10,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    paddingHorizontal: 15,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#ffffff20',
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    color: '#fff',
    fontFamily: 'Orbitron',
    fontSize: 14,
  },
  filterButton: {
    padding: 8,
  },
  tabsScroll: {
    marginBottom: 20,
    marginHorizontal: -5,
    paddingHorizontal: 5,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 10,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#ffffff30',
  },
  activeTab: {
    backgroundColor: '#e33835ce',
    borderColor: '#e33835ce',
  },
  tabText: {
    color: '#ffffff70',
    fontFamily: 'Orbitron',
    fontSize: 12,
    fontWeight: '500',
  },
  activeTabText: {
    color: '#fff',
  },
  eventsContainer: {
    marginBottom: 20,
  },
  eventCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#ffffff15',
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  eventTitleSection: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  eventTitle: {
    fontSize: 15,
    color: '#fff',
    fontFamily: 'Orbitron',
    fontWeight: '600',
    flex: 1,
  },
  hotBadge: {
    backgroundColor: '#f70a06ce',
    color: '#fff',
    fontSize: 9,
    fontFamily: 'Orbitron',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    fontWeight: '700',
    left: -5,
    top: 2,
  },
  participantsInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ffffff10',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  participantsText: {
    color: '#ffffff70',
    fontFamily: 'Orbitron',
    fontSize: 11,
  },
  eventDetails: {
    marginBottom: 12,
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailText: {
    color: '#ffffff70',
    fontFamily: 'Orbitron',
    fontSize: 11,
  },
  tagsContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  tag: {
    backgroundColor: '#ffffff10',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#e33835ce',
  },
  tagText: {
    color: '#e33835ce',
    fontFamily: 'Orbitron',
    fontSize: 10,
    fontWeight: '600',
  },
  progressBar: {
    height: 3,
    backgroundColor: '#ffffff10',
    borderRadius: 2,
    marginBottom: 12,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#e33835ce',
    borderRadius: 2,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerText: {
    color: '#ffffff50',
    fontFamily: 'Orbitron',
    fontSize: 10,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyStateText: {
    color: '#fff',
    fontFamily: 'Orbitron',
    fontSize: 16,
    marginTop: 16,
  },
  emptyStateSubtext: {
    color: '#ffffff70',
    fontFamily: 'Orbitron',
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
  ctaCard: {
    backgroundColor: '#e33835cece',
    borderWidth: 1,
    borderColor: '#e33835cece',
    borderRadius: 8,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
    marginBottom: 20,
  },
  ctaContent: {
    flex: 1,
    gap: 4,
  },
  ctaTitle: {
    color: '#fff',
    fontFamily: 'Orbitron',
    fontSize: 14,
    fontWeight: '600',
  },
  ctaSubtitle: {
    color: '#ffffffad',
    fontFamily: 'Orbitron',
    fontSize: 11,
  },
});