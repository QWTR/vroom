import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, TouchableOpacity, ActivityIndicator, useWindowDimensions } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import { RouteMiniMap } from '../profile/RouteMiniMap';
import { API_URL } from '../../constants/config';

export type RoutePreviewData = {
  type:     'route';
  routeId:  number;
  name:     string;
  distance: number;
  points:   { latitude: number; longitude: number }[];
  isPublic?: boolean;
};

export function normalizeRoutePoints(
  raw: Array<{ latitude?: number; longitude?: number; lat?: number; lng?: number }> | undefined | null,
): { latitude: number; longitude: number }[] {
  if (!raw?.length) return [];
  return raw
    .map((p) => ({
      latitude:  Number(p.latitude ?? p.lat),
      longitude: Number(p.longitude ?? p.lng),
    }))
    .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
}

export function parseRoutePostContent(content: string): RoutePreviewData | null {
  try {
    const parsed = JSON.parse(content);
    if (parsed?.type !== 'route' || !parsed?.routeId) return null;
    const points = normalizeRoutePoints(parsed.points);
    return {
      type:     'route',
      routeId:  Number(parsed.routeId),
      name:     String(parsed.name ?? 'Trasa'),
      distance: Number(parsed.distance) || 0,
      points,
      isPublic: !!parsed.isPublic,
    };
  } catch {
    return null;
  }
}

type Props = {
  data: RoutePreviewData;
  onNavigate?: (data: RoutePreviewData) => void;
  /** Pełna szerokość karty w feedzie dyskusji (domyślnie true). */
  fullWidth?: boolean;
};

export function RoutePreviewCard({ data, onNavigate, fullWidth = true }: Props) {
  const { theme } = useTheme();
  const router = useRouter();
  const { width: screenW } = useWindowDimensions();
  const [points, setPoints] = useState(data.points);
  const [loadingPts, setLoadingPts] = useState(false);
  const mapWidth = fullWidth ? Math.max(200, screenW - 56) : 200;
  const mapHeight = fullWidth ? 120 : 90;

  useEffect(() => {
    setPoints(data.points);
  }, [data.points, data.routeId]);

  const ensurePoints = useCallback(async () => {
    if (points.length >= 2) return points;
    setLoadingPts(true);
    try {
      const token = await AsyncStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/routes/${data.routeId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const full = await res.json();
        const loaded = normalizeRoutePoints(full?.points);
        if (loaded.length >= 2) {
          setPoints(loaded);
          return loaded;
        }
      }
    } catch {
      /* ignore */
    } finally {
      setLoadingPts(false);
    }
    return points;
  }, [data.routeId, points]);

  useEffect(() => {
    if (data.points.length < 2) void ensurePoints();
  }, [data.points.length, data.routeId, ensurePoints]);

  const displayPoints = useMemo(() => points, [points]);

  const handleNavigate = async () => {
    const pts = await ensurePoints();
    const payload = { ...data, points: pts.length >= 2 ? pts : data.points };
    if (onNavigate) {
      onNavigate(payload);
      return;
    }
    if (pts.length < 2) return;
    await AsyncStorage.setItem('nav_route', JSON.stringify({
      routeId:   data.routeId,
      routeName: data.name,
      points:    pts,
      distance:  data.distance,
    }));
    router.push('/(tabs)/map' as any);
  };

  return (
    <View style={{
      marginHorizontal: fullWidth ? 14 : 0,
      marginBottom: 12,
      borderRadius: 14,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: theme.border2,
      backgroundColor: theme.surface2,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, paddingBottom: 6 }}>
        <MaterialCommunityIcons name="map-marker-path" size={14} color={theme.primary} />
        <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, letterSpacing: 1, flex: 1 }}>
          TRASA
        </Text>
        <View style={[{
          width: 20, height: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center', borderWidth: 1,
        }, data.isPublic
          ? { backgroundColor: '#4de92612', borderColor: '#4de92630' }
          : { backgroundColor: theme.surface4, borderColor: theme.border2 }]}>
          <MaterialIcons name={data.isPublic ? 'public' : 'lock'} size={9} color={data.isPublic ? '#4de926' : theme.textDim} />
        </View>
      </View>

      <View style={{
        marginHorizontal: 8,
        borderRadius: 10,
        overflow: 'hidden',
        backgroundColor: theme.surface3,
        borderWidth: 1,
        borderColor: theme.border,
        minHeight: 100,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {loadingPts && displayPoints.length < 2 ? (
          <ActivityIndicator color={theme.primary} />
        ) : displayPoints.length >= 2 ? (
          <RouteMiniMap points={displayPoints} width={mapWidth} height={mapHeight} />
        ) : (
          <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim, padding: 16 }}>
            Brak podglądu geometrii
          </Text>
        )}
      </View>

      <Text style={{
        fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.text, fontWeight: '700',
        marginHorizontal: 10, marginTop: 8,
      }} numberOfLines={1}>
        {data.name}
      </Text>
      <View style={{ flexDirection: 'row', gap: 12, marginHorizontal: 10, marginTop: 4, marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <MaterialIcons name="straighten" size={11} color={theme.primary} />
          <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim }}>
            {data.distance.toFixed(1)} km
          </Text>
        </View>
        {displayPoints.length >= 2 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <MaterialIcons name="place" size={11} color={theme.textDim} />
            <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.textDim }}>
              {displayPoints.length} pkt
            </Text>
          </View>
        )}
      </View>

      <TouchableOpacity
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
          backgroundColor: theme.primary, margin: 8, marginTop: 0, borderRadius: 10, paddingVertical: 9,
        }}
        onPress={() => void handleNavigate()}
        activeOpacity={0.85}
      >
        <MaterialIcons name="navigation" size={13} color={theme.onPrimary} />
        <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: theme.onPrimary, fontWeight: '700', letterSpacing: 0.5 }}>
          NAWIGUJ PO TEJ TRASIE
        </Text>
      </TouchableOpacity>
    </View>
  );
}
