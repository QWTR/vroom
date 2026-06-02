import { Text, View } from 'react-native';
import { getProvinceLabel } from '../../constants/provinces';

type Props = {
  province?: string | null;
  compact?: boolean;
  theme?: { textDim?: string; border?: string; surface2?: string };
};

/** Etykieta województwa (np. Śląskie) — profil, czat, kluby. */
export function ProvinceBadge({ province, compact, theme }: Props) {
  const label = getProvinceLabel(province);
  if (!label) return null;

  const textDim = theme?.textDim ?? '#888';
  const border = theme?.border ?? '#333';
  const bg = theme?.surface2 ?? '#1a1a1a';

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        paddingHorizontal: compact ? 6 : 8,
        paddingVertical: compact ? 2 : 3,
        borderRadius: 6,
        backgroundColor: `${bg}`,
        borderWidth: 1,
        borderColor: `${border}`,
      }}
    >
      <Text
        style={{
          fontFamily: 'Orbitron',
          fontSize: compact ? 7 : 8,
          color: '#7cb342',
          fontWeight: '700',
          letterSpacing: 0.4,
        }}
      >
        {label.toUpperCase()}
      </Text>
    </View>
  );
}
