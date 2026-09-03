import React, { forwardRef, useMemo } from 'react';
import {
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from 'react-native';
import {
  MAX_COMBINED_FONT_SCALE,
  MIN_INPUT_FONT_SIZE,
  MIN_READABLE_FONT_SIZE,
  TYPOGRAPHY,
  manropeFamilyForWeight,
  type TypographyVariant,
} from '../../constants/typography';
import { ensureContrast } from '../../constants/theme';
import { useReadability } from '../../contexts/ReadabilityContext';
import { useTheme } from '../../contexts/ThemeContext';

type AppTextProps = TextProps & {
  variant?: TypographyVariant;
  contrastBackground?: string | string[];
  allowAppScaling?: boolean;
};

function useReadableTextStyle(
  style: TextProps['style'] | TextInputProps['style'],
  variant: TypographyVariant,
  minimumSize: number,
  contrastBackground?: string | string[],
  allowAppScaling = true,
) {
  const { textSize, textScale } = useReadability();
  const { theme } = useTheme();
  return useMemo(() => {
    const flattened = StyleSheet.flatten(style) as TextStyle | undefined;
    const token = TYPOGRAPHY[variant];
    const requestedSize = typeof flattened?.fontSize === 'number' ? flattened.fontSize : token.fontSize;
    const compactMinimum = minimumSize === MIN_INPUT_FONT_SIZE ? 12 : 8;
    const activeMinimum = allowAppScaling && textSize === 'compact' ? compactMinimum : minimumSize;
    const baseSize = Math.max(minimumSize, requestedSize);
    const appScale = allowAppScaling ? textScale : 1;
    const displayedSize = Math.max(activeMinimum, baseSize * appScale);
    const appliedScale = displayedSize / baseSize;
    const requestedLineHeight = typeof flattened?.lineHeight === 'number'
      ? flattened.lineHeight
      : token.lineHeight * (baseSize / token.fontSize);
    const lineHeightRatio = Math.max(1.2, requestedLineHeight / Math.max(1, requestedSize));
    const fontWeight = flattened?.fontWeight ?? token.fontWeight;
    const commonSurfaces = [theme.bg, theme.bgAlt, theme.surface, theme.surface2, theme.surface3];
    const backgrounds = contrastBackground == null
      ? commonSurfaces
      : Array.isArray(contrastBackground) ? contrastBackground : [contrastBackground];
    const readableColor = typeof flattened?.color === 'string' && flattened.color.startsWith('#')
      ? ensureContrast(flattened.color, backgrounds, baseSize >= 18 ? 3 : 4.5)
      : flattened?.color;

    return {
      style: [
        style,
        {
          fontFamily: manropeFamilyForWeight(fontWeight),
          fontWeight: 'normal' as const,
          fontSize: displayedSize,
          lineHeight: Math.ceil(displayedSize * lineHeightRatio),
          letterSpacing: typeof flattened?.letterSpacing === 'number'
            ? Math.max(-0.2, Math.min(flattened.letterSpacing, 1))
            : undefined,
          color: readableColor,
        },
      ],
      maxFontSizeMultiplier: MAX_COMBINED_FONT_SCALE / appliedScale,
    };
  }, [allowAppScaling, contrastBackground, minimumSize, style, textScale, textSize, theme, variant]);
}

export const AppText = forwardRef<React.ElementRef<typeof NativeText>, AppTextProps>(function AppText(
  { variant = 'bodySmall', style, allowFontScaling = true, maxFontSizeMultiplier, contrastBackground, allowAppScaling = true, ...props },
  ref,
) {
  const readable = useReadableTextStyle(style, variant, MIN_READABLE_FONT_SIZE, contrastBackground, allowAppScaling);
  return (
    <NativeText
      ref={ref}
      {...props}
      allowFontScaling={allowFontScaling}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? readable.maxFontSizeMultiplier}
      style={readable.style}
    />
  );
});

export const AppTextInput = forwardRef<React.ElementRef<typeof NativeTextInput>, TextInputProps>(function AppTextInput(
  { style, allowFontScaling = true, maxFontSizeMultiplier, placeholderTextColor, ...props },
  ref,
) {
  const { theme } = useTheme();
  const readable = useReadableTextStyle(style, 'body', MIN_INPUT_FONT_SIZE, theme.surface3);
  const readablePlaceholder = typeof placeholderTextColor === 'string' && placeholderTextColor.startsWith('#')
    ? ensureContrast(placeholderTextColor, [theme.surface3], 4.5)
    : placeholderTextColor ?? theme.textMuted;
  return (
    <NativeTextInput
      ref={ref}
      {...props}
      allowFontScaling={allowFontScaling}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? readable.maxFontSizeMultiplier}
      placeholderTextColor={readablePlaceholder}
      style={readable.style}
    />
  );
});
