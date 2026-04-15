import React, { useEffect, useState } from 'react';
import { View, Text, Image, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { API_URL } from '../../constants/config';

interface PreviewData {
  title:       string | null;
  description: string | null;
  image:       string | null;
  siteName:    string | null;
  url:         string;
}

interface Props {
  url:   string;
  isMe:  boolean;
  theme: any;
}

export function LinkPreviewCard({ url, isMe, theme }: Props) {
  const [data,    setData]    = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res  = await fetch(`${API_URL}/api/link-preview?url=${encodeURIComponent(url)}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setData({ title: null, description: null, image: null, siteName: null, url });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  const borderColor = isMe ? '#ffffff25' : theme.border2;
  const bg          = isMe ? '#ffffff12' : theme.surface;

  if (loading) return (
    <View style={{ marginTop: 6, padding: 10, borderRadius: 12, borderWidth: 1, borderColor, backgroundColor: bg, alignItems: 'center' }}>
      <ActivityIndicator size="small" color={isMe ? '#ffffff80' : theme.primary} />
    </View>
  );

  // Brak danych — sam link
  if (!data?.title && !data?.image) return (
    <TouchableOpacity
      onPress={() => Linking.openURL(url)}
      activeOpacity={0.8}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}
    >
      <Feather name="link" size={11} color={isMe ? '#ffffff80' : theme.primary} />
      <Text numberOfLines={1} style={{ color: isMe ? '#ffffff80' : theme.primary, fontSize: 11, textDecorationLine: 'underline', flex: 1 }}>
        {url}
      </Text>
    </TouchableOpacity>
  );

  return (
    <TouchableOpacity
      onPress={() => Linking.openURL(url)}
      activeOpacity={0.85}
      style={{ marginTop: 6, borderRadius: 12, borderWidth: 1, borderColor, backgroundColor: bg, overflow: 'hidden' }}
    >
      {!!data?.image && (
        <Image source={{ uri: data.image }} style={{ width: '100%', height: 130 }} resizeMode="cover" />
      )}
      <View style={{ padding: 10, gap: 3 }}>
        {!!data?.siteName && (
          <Text style={{ color: isMe ? '#ffffff60' : theme.textDim, fontFamily: 'Orbitron', fontSize: 8, letterSpacing: 1 }}>
            {data.siteName.toUpperCase()}
          </Text>
        )}
        {!!data?.title && (
          <Text numberOfLines={2} style={{ color: isMe ? '#fff' : theme.text, fontFamily: 'Orbitron', fontSize: 10, fontWeight: '700' }}>
            {data.title}
          </Text>
        )}
        {!!data?.description && (
          <Text numberOfLines={2} style={{ color: isMe ? '#ffffff90' : theme.textDim, fontSize: 11, lineHeight: 15 }}>
            {data.description}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}