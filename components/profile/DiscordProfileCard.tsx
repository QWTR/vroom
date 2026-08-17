import React from 'react';
import { Image, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { DiscordProfile } from '../../constants/profile';
import { GLASS_BORDER, GLASS_SHADOW, glassSurface } from './profileCardTheme';

const DISCORD_BLURPLE = '#5865F2';

type Props = {
  discord: DiscordProfile;
  theme: {
    text: string;
    textDim: string;
    surface: string;
    border: string;
  };
};

export function DiscordProfileCard({ discord, theme }: Props) {
  return (
    <View
      style={{
        backgroundColor: glassSurface(theme.surface, '88'),
        borderRadius: 20,
        borderWidth: 1,
        borderColor: DISCORD_BLURPLE + '55',
        padding: 15,
        marginBottom: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 13,
        ...GLASS_SHADOW,
      }}
      accessibilityLabel={`Discord: ${discord.displayName}, @${discord.username}`}
    >
      <View
        style={{
          width: 50,
          height: 50,
          borderRadius: 17,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: DISCORD_BLURPLE + '22',
          borderWidth: 1,
          borderColor: GLASS_BORDER,
        }}
      >
        {discord.avatarUrl ? (
          <Image source={{ uri: discord.avatarUrl }} style={{ width: 50, height: 50 }} />
        ) : (
          <MaterialIcons name="discord" size={25} color={DISCORD_BLURPLE} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <MaterialIcons name="discord" size={15} color={DISCORD_BLURPLE} />
          <Text
            style={{
              fontFamily: 'Orbitron',
              fontSize: 8,
              color: DISCORD_BLURPLE,
              letterSpacing: 1.5,
              fontWeight: '800',
            }}
          >
            DISCORD
          </Text>
        </View>
        <Text
          numberOfLines={1}
          style={{ fontFamily: 'Orbitron', fontSize: 12, color: theme.text, fontWeight: '800', marginTop: 5 }}
        >
          {discord.displayName}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 11, color: theme.textDim, marginTop: 2 }}>
          @{discord.username}
        </Text>
      </View>
      <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: '#23A55A' }} />
    </View>
  );
}
