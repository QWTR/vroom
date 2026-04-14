import React from 'react';
import {
  View, Text, Modal, TouchableOpacity,
  ScrollView, Platform, Pressable, Dimensions,
} from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import MapView, { Polyline, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { useTheme } from '../../contexts/ThemeContext';
import type { TripStats } from '../../hooks/useTripStats';
import { customMapStyle, lightMapStyle } from '../../constants/mapConfig';

const { height: SCREEN_H } = Dimensions.get('window');

function formatTime(sec: number): string {
  if (!sec || sec <= 0) return '0s';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

interface Props {
  visible: boolean;
  stats:   TripStats | null;
  onClose: () => void;
}

export function TripStatsModal({ visible, stats, onClose }: Props) {
  const { theme, isDark } = useTheme();

  if (!stats) return null;

  const diffSec  = stats.estimatedSec - stats.elapsedSec;
  const faster   = diffSec > 0;
  const diffAbs  = Math.abs(diffSec);
  const diffText = formatTime(diffAbs);

  const pts = stats.trackedPoints;
  const hasRoute = pts.length > 1;

  const mapRegion = hasRoute ? (() => {
    const lats  = pts.map(p => p.latitude);
    const lngs  = pts.map(p => p.longitude);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    return {
      latitude:       (minLat + maxLat) / 2,
      longitude:      (minLng + maxLng) / 2,
      latitudeDelta:  Math.max((maxLat - minLat) * 1.5, 0.004),
      longitudeDelta: Math.max((maxLng - minLng) * 1.5, 0.004),
    };
  })() : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, backgroundColor: '#000000bb', justifyContent: 'flex-end' }}>
        {/* Tapnięcie tła zamyka */}
        <Pressable
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          onPress={onClose}
        />

        <View style={{
          backgroundColor:      theme.surface,
          borderTopLeftRadius:  24,
          borderTopRightRadius: 24,
          maxHeight:            SCREEN_H * 0.82,
          borderTopWidth:       1,
          borderColor:          theme.border2,
          paddingBottom:        Platform.OS === 'ios' ? 34 : 20,
        }}>
          {/* Handle */}
          <View style={{
            width: 40, height: 4, borderRadius: 2,
            backgroundColor: theme.border3,
            alignSelf: 'center', marginTop: 12, marginBottom: 0,
          }} />

          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {/* ── Nagłówek ─────────────────────────────────── */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <View style={{
                width: 36, height: 36, borderRadius: 10,
                backgroundColor: '#e3383520', borderWidth: 1, borderColor: '#e3383540',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <MaterialIcons name="flag" size={20} color="#e33835" />
              </View>
              <Text style={{
                fontFamily: 'Orbitron', fontSize: 14,
                color: theme.text, letterSpacing: 2,
                fontWeight: '700', flex: 1,
              }}>
                STATYSTYKI PRZEJAZDU
              </Text>
              <TouchableOpacity
                onPress={onClose}
                style={{
                  width: 30, height: 30, borderRadius: 15,
                  backgroundColor: theme.surface2,
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <MaterialIcons name="close" size={16} color={theme.textDim} />
              </TouchableOpacity>
            </View>

            {/* ── Mapa historii trasy ───────────────────────── */}
            {hasRoute && mapRegion ? (
              <View style={{
                borderRadius: 16, overflow: 'hidden',
                marginBottom: 14, height: 180,
                borderWidth: 1, borderColor: theme.border,
              }}>
                <MapView
                  provider={PROVIDER_GOOGLE}
                  style={{ flex: 1 }}
                  customMapStyle={isDark ? customMapStyle : lightMapStyle}
                  initialRegion={mapRegion}
                  scrollEnabled={false}
                  zoomEnabled={false}
                  pitchEnabled={false}
                  rotateEnabled={false}
                  toolbarEnabled={false}
                  liteMode
                >
                  {/* Cień */}
                  <Polyline
                    coordinates={pts}
                    strokeColor="#00000060"
                    strokeWidth={8}
                    geodesic
                    lineCap="round"
                    lineJoin="round"
                  />
                  {/* Linia trasy */}
                  <Polyline
                    coordinates={pts}
                    strokeColor="#e33835"
                    strokeWidth={4}
                    geodesic
                    lineCap="round"
                    lineJoin="round"
                  />
                  {/* Start */}
                  <Marker
                    coordinate={pts[0]}
                    anchor={{ x: 0.5, y: 0.5 }}
                    tracksViewChanges={false}
                  >
                    <View style={{
                      width: 12, height: 12, borderRadius: 6,
                      backgroundColor: '#4de926',
                      borderWidth: 2, borderColor: '#fff',
                    }} />
                  </Marker>
                  {/* Koniec */}
                  <Marker
                    coordinate={pts[pts.length - 1]}
                    anchor={{ x: 0.5, y: 0.5 }}
                    tracksViewChanges={false}
                  >
                    <View style={{
                      width: 12, height: 12, borderRadius: 6,
                      backgroundColor: '#e33835',
                      borderWidth: 2, borderColor: '#fff',
                    }} />
                  </Marker>
                </MapView>

                {/* Dystans overlay */}
                <View style={{
                  position: 'absolute', bottom: 8, left: 8,
                  backgroundColor: '#111111cc', borderRadius: 8,
                  paddingHorizontal: 8, paddingVertical: 4,
                  flexDirection: 'row', alignItems: 'center', gap: 4,
                }}>
                  <MaterialIcons name="straighten" size={10} color="#ffffff80" />
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 9, color: '#ffffff80' }}>
                    {stats.distanceKm.toFixed(1)} km
                  </Text>
                </View>
              </View>
            ) : (
              // Placeholder jeśli brak punktów trasy
              <View style={{
                height: 80, borderRadius: 16, marginBottom: 14,
                backgroundColor: theme.surface2,
                borderWidth: 1, borderColor: theme.border,
                alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                <MaterialIcons name="map" size={24} color={theme.border3} />
                <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim }}>
                  BRAK DANYCH TRASY
                </Text>
              </View>
            )}

            {/* ── Siatka 2×2 ───────────────────────────────── */}
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
              {/* Max prędkość */}
              <View style={[card(theme), { flex: 1 }]}>
                <View style={iconWrap('#e33835')}>
                  <MaterialIcons name="speed" size={16} color="#e33835" />
                </View>
                <Text style={label(theme)}>MAX PRĘDKOŚĆ</Text>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3 }}>
                  <Text style={[value(theme), { color: '#e33835' }]}>{stats.maxSpeedKmh}</Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.textDim, marginBottom: 3 }}>km/h</Text>
                </View>
              </View>

              {/* Śred. prędkość */}
              <View style={[card(theme), { flex: 1 }]}>
                <View style={iconWrap('#268bff')}>
                  <MaterialCommunityIcons name="gauge" size={16} color="#268bff" />
                </View>
                <Text style={label(theme)}>ŚRED. PRĘDKOŚĆ</Text>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3 }}>
                  <Text style={[value(theme), { color: '#268bff' }]}>{stats.avgSpeedKmh}</Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 10, color: theme.textDim, marginBottom: 3 }}>km/h</Text>
                </View>
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
              {/* Czas przejazdu */}
              <View style={[card(theme), { flex: 1 }]}>
                <View style={iconWrap('#4de926')}>
                  <MaterialIcons name="timer" size={16} color="#4de926" />
                </View>
                <Text style={label(theme)}>CZAS PRZEJAZDU</Text>
                <Text style={[value(theme), { color: '#4de926', fontSize: 20 }]}>
                  {formatTime(stats.elapsedSec)}
                </Text>
              </View>

              {/* Szacowany czas */}
              <View style={[card(theme), { flex: 1 }]}>
                <View style={iconWrap('#FFD700')}>
                  <MaterialIcons name="navigation" size={16} color="#FFD700" />
                </View>
                <Text style={label(theme)}>SZAC. CZAS</Text>
                <Text style={[value(theme), { color: '#FFD700', fontSize: 20 }]}>
                  {formatTime(stats.estimatedSec)}
                </Text>
              </View>
            </View>

            {/* ── Porównanie czasu ──────────────────────────── */}
            {stats.estimatedSec > 0 && diffAbs > 2 && (
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 12,
                backgroundColor: faster ? '#4de92612' : '#e3383512',
                borderRadius: 14, padding: 14, marginBottom: 10,
                borderWidth: 1, borderColor: faster ? '#4de92630' : '#e3383530',
              }}>
                <View style={{
                  width: 40, height: 40, borderRadius: 10,
                  backgroundColor: faster ? '#4de92620' : '#e3383520',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <MaterialIcons
                    name={faster ? 'trending-up' : 'trending-down'}
                    size={22}
                    color={faster ? '#4de926' : '#e33835'}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 8, color: theme.textDim, letterSpacing: 1 }}>
                    {faster ? 'SZYBCIEJ NIŻ PROGNOZA' : 'WOLNIEJ NIŻ PROGNOZA'}
                  </Text>
                  <Text style={{
                    fontFamily: 'Orbitron', fontSize: 22,
                    fontWeight: '700', marginTop: 2,
                    color: faster ? '#4de926' : '#e33835',
                  }}>
                    {faster ? '-' : '+'}{diffText}
                  </Text>
                </View>
              </View>
            )}

            {/* ── Dystans ───────────────────────────────────── */}
            <View style={[card(theme), {
              flexDirection: 'row', alignItems: 'center',
              gap: 12, marginBottom: 4,
            }]}>
              <View style={iconWrap(theme.primary)}>
                <MaterialIcons name="straighten" size={16} color={theme.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={label(theme)}>DYSTANS</Text>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
                  <Text style={value(theme)}>{stats.distanceKm.toFixed(1)}</Text>
                  <Text style={{ fontFamily: 'Orbitron', fontSize: 11, color: theme.textDim, marginBottom: 3 }}>km</Text>
                </View>
              </View>
            </View>

          </ScrollView>

          {/* ── Przycisk zamknij ──────────────────────────── */}
          <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            <TouchableOpacity
              style={{
                backgroundColor: '#e33835',
                borderRadius: 14, paddingVertical: 14,
                alignItems: 'center',
              }}
              onPress={onClose}
              activeOpacity={0.85}
            >
              <Text style={{
                fontFamily: 'Orbitron', fontSize: 12,
                color: '#fff', fontWeight: '700', letterSpacing: 2,
              }}>
                ZAMKNIJ
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Style helpers ─────────────────────────────────────────
const card = (theme: any) => ({
  backgroundColor: theme.surface2,
  borderRadius:    14,
  padding:         14,
  borderWidth:     1,
  borderColor:     theme.border,
  gap:             6 as any,
});

const iconWrap = (color: string) => ({
  width:            28,
  height:           28,
  borderRadius:     8,
  backgroundColor:  color + '20',
  alignItems:       'center' as const,
  justifyContent:   'center' as const,
  marginBottom:     2,
});

const label = (theme: any) => ({
  fontFamily:    'Orbitron',
  fontSize:      8,
  color:         theme.textDim,
  letterSpacing: 1,
});

const value = (theme: any) => ({
  fontFamily: 'Orbitron',
  fontSize:   24,
  color:      theme.text,
  fontWeight: '700' as const,
});