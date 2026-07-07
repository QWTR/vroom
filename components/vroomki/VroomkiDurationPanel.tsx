import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Video } from 'expo-av';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

const PHOTO_DURATIONS = [2000, 2500, 3000, 4000, 5000, 7000, 10000];
const VIDEO_DURATIONS = [15000, 30000, 45000, 60000, 90000];

export function VroomkiDurationPanel({
  hasVideo,
  photoCount,
  photoDurationMs,
  clipDurationMs,
  videoUri,
  onPhotoDurationChange,
  onClipDurationChange,
}: {
  hasVideo: boolean;
  photoCount: number;
  photoDurationMs: number;
  clipDurationMs: number | null;
  videoUri: string | null;
  onPhotoDurationChange: (ms: number) => void;
  onClipDurationChange: (ms: number) => void;
}) {
  const [videoDurationMs, setVideoDurationMs] = useState<number | null>(null);

  const totalPhotoMs = photoCount * photoDurationMs;

  return (
    <View style={{ marginTop: 16, paddingHorizontal: 16 }}>
      {videoUri ? (
        <Video
          source={{ uri: videoUri }}
          style={{ width: 0, height: 0, opacity: 0 }}
          onLoad={(status) => {
            if (!status.isLoaded || !status.durationMillis) return;
            setVideoDurationMs(status.durationMillis);
            if (!clipDurationMs) {
              onClipDurationChange(Math.min(status.durationMillis, 60000));
            }
          }}
        />
      ) : null}

      <Text style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: 10, letterSpacing: 1, marginBottom: 10 }}>
        DŁUGOŚĆ VROOMKI
      </Text>

      {!hasVideo && photoCount > 0 && (
        <>
          <Text style={{ color: '#ffffffaa', fontSize: 11, marginBottom: 8 }}>
            Czas na zdjęcie · łącznie ~{Math.round(totalPhotoMs / 1000)}s
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {PHOTO_DURATIONS.map((ms) => (
              <TouchableOpacity
                key={ms}
                onPress={() => onPhotoDurationChange(ms)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: photoDurationMs === ms ? '#e33835' : '#ffffff14',
                }}
              >
                <Text style={{ color: '#fff', fontSize: 11 }}>{ms / 1000}s</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {hasVideo && (
        <>
          <Text style={{ color: '#ffffffaa', fontSize: 11, marginBottom: 8 }}>
            Maks. długość odtwarzania
            {videoDurationMs ? ` · film ${Math.round(videoDurationMs / 1000)}s` : ''}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {VIDEO_DURATIONS.filter((ms) => !videoDurationMs || ms <= videoDurationMs + 500).map((ms) => (
              <TouchableOpacity
                key={ms}
                onPress={() => onClipDurationChange(ms)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: clipDurationMs === ms ? '#e33835' : '#ffffff14',
                }}
              >
                <Text style={{ color: '#fff', fontSize: 11 }}>{ms / 1000}s</Text>
              </TouchableOpacity>
            ))}
            {videoDurationMs && (
              <TouchableOpacity
                onPress={() => onClipDurationChange(videoDurationMs)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: clipDurationMs === videoDurationMs ? '#e33835' : '#ffffff14',
                }}
              >
                <Text style={{ color: '#fff', fontSize: 11 }}>PEŁNY</Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
        <MaterialIcons name="info-outline" size={14} color="#ffffff88" />
        <Text style={{ color: '#ffffff88', fontSize: 10, flex: 1 }}>
          {hasVideo ? 'Feed odtworzy wybrany fragment filmu.' : 'Slideshow przełącza zdjęcia w wybranym tempie.'}
        </Text>
      </View>
    </View>
  );
}
