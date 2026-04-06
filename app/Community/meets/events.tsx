import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  TextInput, FlatList,
} from 'react-native';
import { useRouter }          from 'expo-router';
import MaterialIcons          from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme }           from '../../../contexts/ThemeContext';

interface Event {
  id: string; title: string; date: string; time: string; location: string;
  participants: number; maxParticipants: number; tags: string[];
  status?: string; description?: string;
}

const MOCK_EVENTS: Event[] = [
  { id: '1', title: 'Night Cruise Warszawa',  date: 'Czw, 21:00', time: '21:00', location: 'Pł. Defonda, Warszawa',     participants: 34, maxParticipants: 50, tags: ['NIGHT','CRUISE'],  status: 'HOT', description: 'Nocny przejazd po Warszawie' },
  { id: '2', title: 'Track Day Poznań',       date: 'Sob, 10:00', time: '10:00', location: 'Tor Poznań',               participants: 12, maxParticipants: 30, tags: ['TRACK','RACING'],           description: 'Tor wyścigowy Poznań' },
  { id: '3', title: 'JDM Meet Kraków',        date: 'Ndz, 16:00', time: '16:00', location: 'Galeria Kazimierz, Kraków', participants: 47, maxParticipants: 60, tags: ['JDM','STATIC'],    status: 'HOT', description: 'Spotkanie miłośników JDM' },
  { id: '4', title: 'Euro Cars Wrocław',      date: 'Pon, 18:00', time: '18:00', location: 'Hala Stulecia, Wrocław',   participants: 8,  maxParticipants: 40, tags: ['EURO','SHOW'],             description: 'Zlot samochodów europejskich' },
];

const FILTER_TABS = ['Wszystkie', 'Dziś', 'Ten tydzień', 'Blisko mnie'];

export default function EventsScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const [activeTab,   setActiveTab]   = useState('Wszystkie');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredEvents = MOCK_EVENTS.filter(e =>
    e.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderEventCard = ({ item }: { item: Event }) => (
    <TouchableOpacity
      style={{ backgroundColor: theme.surface3, borderRadius: 8, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: theme.border3 }}
      onPress={() => router.push({ pathname: '/Community/meets/meet', params: { id: item.id } })}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ fontSize: 15, color: theme.text, fontFamily: 'Orbitron', fontWeight: '600', flex: 1 }}>{item.title}</Text>
        </View>
        {item.status && (
          <Text style={{ backgroundColor: theme.primary, color: '#fff', fontSize: 9, fontFamily: 'Orbitron', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, fontWeight: '700', marginLeft: 6 }}>
            {item.status}
          </Text>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.surface4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, marginLeft: 6 }}>
          <MaterialIcons name="people" size={14} color={theme.textDim} />
          <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 11 }}>{item.participants}/{item.maxParticipants}</Text>
        </View>
      </View>

      <View style={{ marginBottom: 12, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <MaterialIcons name="access-time" size={14} color={theme.textDim} />
          <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 11 }}>{item.date}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <MaterialIcons name="location-on" size={14} color={theme.textDim} />
          <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 11 }}>{item.location}</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {item.tags.map((tag, i) => (
          <View key={i} style={{ backgroundColor: theme.surface4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4, borderWidth: 1, borderColor: theme.primaryBorder }}>
            <Text style={{ color: theme.primary, fontFamily: 'Orbitron', fontSize: 10, fontWeight: '600' }}>{tag}</Text>
          </View>
        ))}
      </View>

      <View style={{ height: 3, backgroundColor: theme.border2, borderRadius: 2, marginBottom: 12, overflow: 'hidden' }}>
        <View style={{ height: '100%', backgroundColor: theme.primary, borderRadius: 2, width: `${(item.participants / item.maxParticipants) * 100}%` }} />
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 10 }}>{item.maxParticipants - item.participants} miejsc dostępnych</Text>
        <MaterialIcons name="arrow-forward-ios" size={14} color={theme.primary} />
      </View>
    </TouchableOpacity>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bgAlt, paddingHorizontal: '5%', paddingBottom: 30 }}>

      {/* Header */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 60, marginBottom: 20 }}>
        <View>
          <Text style={{ fontSize: 31, color: theme.text, fontFamily: 'Orbitron', fontWeight: '600', letterSpacing: 2 }}>MEETY</Text>
          <Text style={{ fontSize: 11, color: theme.textDim, fontFamily: 'Orbitron', marginTop: 5 }}>NADBÓDZ ORAZ ZLOTY</Text>
        </View>
        <TouchableOpacity
          style={{ width: 55, height: 55, borderRadius: 28, backgroundColor: theme.primary, justifyContent: 'center', alignItems: 'center' }}
          onPress={() => router.push('/Community/createmeet')}
        >
          <MaterialIcons name="add" size={28} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.surface3, borderRadius: 8, paddingHorizontal: 15, marginBottom: 15, borderWidth: 1, borderColor: theme.border2 }}>
        <MaterialIcons name="search" size={20} color={theme.textDim} style={{ marginRight: 10 }} />
        <TextInput
          style={{ flex: 1, paddingVertical: 12, color: theme.text, fontFamily: 'Orbitron', fontSize: 14 }}
          placeholder="Szukaj złotu..." placeholderTextColor={theme.textDim}
          value={searchQuery} onChangeText={setSearchQuery}
        />
        <TouchableOpacity style={{ padding: 8 }}>
          <MaterialIcons name="tune" size={20} color={theme.primary} />
        </TouchableOpacity>
      </View>

      {/* Filter Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20, marginHorizontal: -5, paddingHorizontal: 5 }}>
        {FILTER_TABS.map(tab => (
          <TouchableOpacity
            key={tab}
            style={[{
              paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginRight: 10,
              backgroundColor: theme.surface3, borderWidth: 1, borderColor: theme.border2,
            }, activeTab === tab && { backgroundColor: theme.primary, borderColor: theme.primary }]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={{ color: activeTab === tab ? '#fff' : theme.textDim, fontFamily: 'Orbitron', fontSize: 12, fontWeight: '500' }}>
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Events */}
      <View style={{ marginBottom: 20 }}>
        {filteredEvents.length > 0 ? (
          <FlatList data={filteredEvents} renderItem={renderEventCard} keyExtractor={i => i.id} scrollEnabled={false} />
        ) : (
          <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 60 }}>
            <MaterialIcons name="event-busy" size={48} color={theme.border3} />
            <Text style={{ color: theme.text, fontFamily: 'Orbitron', fontSize: 16, marginTop: 16 }}>Brak wydarzeń</Text>
            <Text style={{ color: theme.textDim, fontFamily: 'Orbitron', fontSize: 12, marginTop: 8, textAlign: 'center' }}>Spróbuj zmienić filtry lub wyszukaj inny termin</Text>
          </View>
        )}
      </View>

      {/* CTA */}
      <TouchableOpacity
        style={{ backgroundColor: theme.primary, borderRadius: 8, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 15, marginBottom: 20 }}
        onPress={() => router.push('/Community/createmeet')}
      >
        <MaterialIcons name="add-circle-outline" size={32} color="#fff" />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: '#fff', fontFamily: 'Orbitron', fontSize: 14, fontWeight: '600' }}>Organizuj swoje spotkanie</Text>
          <Text style={{ color: '#ffffffad', fontFamily: 'Orbitron', fontSize: 11 }}>Zaproś przyjaciół na wspólny przejazd</Text>
        </View>
        <MaterialIcons name="arrow-forward-ios" size={20} color="#fff" />
      </TouchableOpacity>
    </ScrollView>
  );
}