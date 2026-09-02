import React from 'react';
import { Linking, StyleProp, TextStyle } from 'react-native';
import { AppText as Text } from './ui/AppText';

const URL_REGEX = /(https?:\/\/[^\s]+)/g;

interface Props {
  children: string;
  style?:   StyleProp<TextStyle>;
  linkStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
}

export function LinkedText({ children, style, linkStyle, numberOfLines }: Props) {
  const parts = children.split(URL_REGEX);

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((part, i) =>
        URL_REGEX.test(part) ? (
          <Text
            key={i}
            style={[linkStyle, { textDecorationLine: 'underline' }]}
            onPress={() => Linking.openURL(part)}
          >
            {part}
          </Text>
        ) : (
          <Text key={i}>{part}</Text>
        )
      )}
    </Text>
  );
}