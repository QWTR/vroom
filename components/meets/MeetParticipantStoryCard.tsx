import React from 'react';
import { View, Image } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { LinearGradient } from 'expo-linear-gradient';

export const STORY_W = 1080;
export const STORY_H = 1920;

export interface StoryMeetInfo {
  title: string;
  date: string;
  locationName: string;
}

export interface StoryCarInfo {
  brand: string;
  specs: string;
  photos: string[];
  year?: number | null;
  power?: number | null;
  color?: string | null;
}

interface Props {
  meet: StoryMeetInfo;
  username: string;
  car: StoryCarInfo;
  onCarImageLoad?: () => void;
  onCarImageError?: () => void;
}

function formatMeetDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('pl-PL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function SpecPill({ label }: { label: string }) {
  return (
    <View
      style={{
        borderWidth: 2,
        borderColor: '#e33835',
        borderRadius: 12,
        paddingHorizontal: 20,
        paddingVertical: 10,
        backgroundColor: '#e3383520',
      }}
    >
      <Text style={{ fontFamily: 'Manrope_700Bold', color: '#fff', fontSize: 22, fontWeight: '700', letterSpacing: 0.5 }}>
        {label}
      </Text>
    </View>
  );
}

export function MeetParticipantStoryCard({ meet, username, car, onCarImageLoad, onCarImageError }: Props) {
  const photo = car.photos?.find(Boolean);
  const specs = car.specs?.trim();

  return (
    <View style={{ width: STORY_W, height: STORY_H, backgroundColor: '#050505', overflow: 'hidden' }}>
      {/* Tło + zdjęcie auta */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: STORY_H * 0.58 }}>
        {photo ? (
          <Image
            source={{ uri: photo }}
            style={{ width: STORY_W, height: STORY_H * 0.58 }}
            resizeMode="cover"
            onLoadEnd={onCarImageLoad}
            onError={onCarImageError}
          />
        ) : (
          <View
            style={{ width: STORY_W, height: STORY_H * 0.58, backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' }}
            onLayout={onCarImageLoad}
          >
            <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#444', fontSize: 48 }}>VROOM</Text>
          </View>
        )}
        <LinearGradient
          colors={['transparent', '#050505cc', '#050505']}
          locations={[0.35, 0.75, 1]}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: STORY_H * 0.45 }}
        />
      </View>

      {/* Czerwony akcent */}
      <View style={{ position: 'absolute', top: STORY_H * 0.56, left: 48, right: 48, height: 6, backgroundColor: '#e33835', borderRadius: 3 }} />

      {/* Logo VROOM */}
      <View style={{ position: 'absolute', top: 72, left: 48, right: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Image
          source={require('../../assets/images/logotypRed.png')}
          style={{ width: 220, height: 56 }}
          resizeMode="contain"
        />
        <View style={{ backgroundColor: '#e33835', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12 }}>
          <Text style={{ fontFamily: 'Manrope_700Bold', color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: 1 }}>
            STORY
          </Text>
        </View>
      </View>

      {/* Treść */}
      <View style={{ flex: 1, justifyContent: 'flex-end', paddingHorizontal: 48, paddingBottom: 80 }}>
        <View style={{ alignSelf: 'flex-start', backgroundColor: '#e33835', borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10, marginBottom: 28 }}>
          <Text style={{ fontFamily: 'Manrope_700Bold', color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: 1 }}>
            OFICJALNY UCZESTNIK
          </Text>
        </View>

        <Text
          numberOfLines={3}
          style={{ fontFamily: 'Manrope_700Bold', color: '#fff', fontSize: 52, fontWeight: '800', lineHeight: 60, letterSpacing: 1, marginBottom: 16 }}
        >
          {meet.title.toUpperCase()}
        </Text>

        <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#e33835', fontSize: 24, fontWeight: '700', marginBottom: 8, letterSpacing: 0.5 }}>
          {formatMeetDate(meet.date)}
        </Text>
        <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#aaa', fontSize: 22, marginBottom: 36 }} numberOfLines={2}>
          📍 {meet.locationName}
        </Text>

        <View style={{ height: 2, backgroundColor: '#333', marginBottom: 32 }} />

        <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#888', fontSize: 18, letterSpacing: 1, marginBottom: 8 }}>
          AUTO NA EVENCIE
        </Text>
        <Text
          numberOfLines={2}
          style={{ fontFamily: 'Manrope_700Bold', color: '#fff', fontSize: 64, fontWeight: '900', lineHeight: 72, marginBottom: 12 }}
        >
          {car.brand}
        </Text>
        {!!specs && (
          <Text numberOfLines={3} style={{ fontFamily: 'Manrope_600SemiBold', color: '#ccc', fontSize: 26, lineHeight: 36, marginBottom: 24 }}>
            {specs}
          </Text>
        )}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 36 }}>
          {!!car.year && <SpecPill label={`${car.year} r.`} />}
          {!!car.power && <SpecPill label={`${car.power} KM`} />}
          {!!car.color && <SpecPill label={car.color} />}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <View style={{ width: 4, height: 48, backgroundColor: '#e33835', borderRadius: 2 }} />
          <Text style={{ fontFamily: 'Manrope_700Bold', color: '#e33835', fontSize: 36, fontWeight: '800' }}>
            @{username}
          </Text>
        </View>

        <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#555', fontSize: 18, marginTop: 40, letterSpacing: 1, textAlign: 'center' }}>
          vroom.app
        </Text>
      </View>

      {/* Dekoracyjne paski */}
      <View style={{ position: 'absolute', top: 0, right: 0, width: 8, height: STORY_H, backgroundColor: '#e3383540' }} />
      <View style={{ position: 'absolute', top: 0, left: 0, width: 4, height: STORY_H * 0.35, backgroundColor: '#e33835' }} />
    </View>
  );
}
