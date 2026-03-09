import React, { useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View, Dimensions } from 'react-native';
import { Text } from '@react-navigation/elements';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Feather from '@expo/vector-icons/Feather';

const { width } = Dimensions.get('window');

export default function stats() {
  const [category, setCategory] = useState('speed'); // 'speed' | 'distance'
  const [timeFilter, setTimeFilter] = useState('month'); // 'day' | 'week' | 'month'

  // Przykładowe dane
  const topThree = [
    { id: 1, name: 'DriftQueen', score: '11,230', avatar: 'DQ', rank: 2 },
    { id: 2, name: 'SpeedKing', score: '12,450', avatar: 'SK', rank: 1 },
    { id: 3, name: 'TurboMax', score: '10,100', avatar: 'TM', rank: 3 },
  ];

  const listData = [
    { id: 4, name: 'NitroJoe', score: '8900', sub: '2340 km • 30 zlotów', trend: 'up' },
    { id: 5, name: 'RallyAnna', score: '7600', sub: '2100 km • 28 zlotów', trend: 'neutral' },
    { id: 6, name: 'V8Power', score: '6800', sub: '1980 km • 24 zlotów', trend: 'up' },
    { id: 7, name: 'BoostKing', score: '5900', sub: '1650 km • 20 zlotów', trend: 'down' },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Nagłówek */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>RANKING</Text>
        <Text style={styles.headerSubtitle}>NAJLEPSI KIEROWCY</Text>
      </View>

      {/* Przełącznik Kategorii (Prędkość / Dystans) */}
      <View style={styles.categoryTabs}>
        <TouchableOpacity 
          onPress={() => setCategory('speed')}
          style={[styles.tabButton, category === 'speed' && styles.activeTab]}
        >
          <Text style={[styles.tabText, category === 'speed' && styles.activeTabText]}>PRĘDKOŚĆ</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          onPress={() => setCategory('distance')}
          style={[styles.tabButton, category === 'distance' && styles.activeTab]}
        >
          <Text style={[styles.tabText, category === 'distance' && styles.activeTabText]}>DYSTANS</Text>
        </TouchableOpacity>
      </View>

      {/* Przełącznik Czasu */}
      <View style={styles.filterContainer}>
        {['Dziś', 'Tydzień', 'Miesiąc'].map((f) => (
          <TouchableOpacity key={f} onPress={() => setTimeFilter(f.toLowerCase())}>
            <Text style={[styles.filterText, timeFilter === f.toLowerCase() && styles.activeFilterText]}>
              {f}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Podium */}
      <View style={styles.podiumContainer}>
        {/* Miejsce 2 */}
        <PodiumItem item={topThree[0]} height={100} color="#ffffff60" />
        {/* Miejsce 1 */}
        <PodiumItem item={topThree[1]} height={130} color="#e33835" isWinner />
        {/* Miejsce 3 */}
        <PodiumItem item={topThree[2]} height={80} color="#ffffff40" />
      </View>

      {/* Lista Rankingowa */}
      <View style={styles.listContainer}>
        {listData.map((player) => (
          <View key={player.id} style={styles.listItem}>
            <View style={styles.listLeft}>
              <Text style={styles.rankNumber}>{player.id}</Text>
              <View style={styles.listAvatar}>
                <Text style={styles.avatarText}>{player.name.substring(0, 2).toUpperCase()}</Text>
              </View>
              <View>
                <Text style={styles.playerName}>{player.name}</Text>
                <Text style={styles.playerSub}>{player.sub}</Text>
              </View>
            </View>
            <View style={styles.listRight}>
              <Text style={styles.playerScore}>{player.score}</Text>
              {player.trend === 'up' && <Feather name="trending-up" size={16} color="#4de926" />}
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// Komponent pomocniczy dla Podium
const PodiumItem = ({ item, height, color, isWinner }: any) => (
  <View style={styles.podiumColumn}>
    <View style={[styles.avatarCircle, isWinner && styles.winnerCircle]}>
      {isWinner && <MaterialCommunityIcons name="crown" size={24} color="#e33835" style={styles.crown} />}
      <Text style={styles.avatarInitial}>{item.avatar}</Text>
    </View>
    <Text style={styles.podiumName}>{item.name}</Text>
    <Text style={[styles.podiumScore, isWinner && { color: '#e33835' }]}>{item.score}</Text>
    <View style={[styles.podiumBar, { height: height, borderColor: color }]}>
      <Text style={styles.podiumRankText}>{item.rank}</Text>
    </View>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f0f0f",
    paddingHorizontal: "5%",
  },
  header: {
    marginTop: 60,
    marginBottom: 20,
    alignItems: 'center',
  },
  headerTitle: {
    fontFamily: "Orbitron",
    fontSize: 28,
    color: '#fff',
    letterSpacing: 2,
  },
  headerSubtitle: {
    fontFamily: "Orbitron",
    fontSize: 12,
    color: "#ffffff60",
    marginTop: 5,
  },
  categoryTabs: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    padding: 5,
    marginBottom: 20,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: '#e33835',
  },
  tabText: {
    fontFamily: 'Orbitron',
    fontSize: 11,
    color: '#ffffff60',
  },
  activeTabText: {
    color: '#fff',
  },
  filterContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 30,
    marginBottom: 30,
  },
  filterText: {
    fontFamily: 'Orbitron',
    fontSize: 12,
    color: '#ffffff40',
  },
  activeFilterText: {
    color: '#fff',
    textDecorationLine: 'underline',
  },
  podiumContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    marginBottom: 40,
    height: 250,
  },
  podiumColumn: {
    alignItems: 'center',
    width: width * 0.25,
  },
  podiumBar: {
    width: '100%',
    backgroundColor: '#1a1a1a',
    borderTopWidth: 3,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#1a1a1a',
    borderWidth: 2,
    borderColor: '#ffffff20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  winnerCircle: {
    borderColor: '#e33835',
    boxShadow: "0 0 15px #e3383560", // Web/Simulated shadow
  },
  crown: {
    position: 'absolute',
    top: -25,
  },
  avatarInitial: {
    color: '#fff',
    fontFamily: 'Orbitron',
    fontSize: 18,
  },
  podiumName: {
    color: '#fff',
    fontFamily: 'Orbitron',
    fontSize: 10,
    marginBottom: 5,
  },
  podiumScore: {
    color: '#ffffff80',
    fontFamily: 'Orbitron',
    fontSize: 12,
    marginBottom: 10,
  },
  podiumRankText: {
    fontFamily: 'Orbitron',
    fontSize: 24,
    color: '#fff',
  },
  listContainer: {
    gap: 12,
  },
  listItem: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    padding: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  listLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },
  rankNumber: {
    fontFamily: 'Orbitron',
    color: '#ffffff60',
    fontSize: 16,
    width: 20,
  },
  listAvatar: {
    width: 45,
    height: 45,
    borderRadius: 25,
    backgroundColor: '#252525',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#fff',
    fontFamily: 'Orbitron',
    fontSize: 14,
  },
  playerName: {
    color: '#fff',
    fontFamily: 'Orbitron',
    fontSize: 14,
  },
  playerSub: {
    color: '#ffffff40',
    fontFamily: 'Orbitron',
    fontSize: 9,
    marginTop: 2,
  },
  listRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  playerScore: {
    color: '#fff',
    fontFamily: 'Orbitron',
    fontSize: 16,
  },
});