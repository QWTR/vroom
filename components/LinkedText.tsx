import React from 'react';
import { Text, Linking, StyleProp, TextStyle } from 'react-native';

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