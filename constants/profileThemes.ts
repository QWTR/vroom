export type ProfileThemePreset = 'default' | 'midnight' | 'sunset' | 'neon';

type ProfilePalette = {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderStrong: string;
  text: string;
  textDim: string;
};

export function getProfileThemePalette(preset: string | null | undefined): ProfilePalette {
  switch (preset) {
    case 'midnight':
      return {
        bg: '#060b16',
        surface: '#0f1728',
        surfaceAlt: '#162039',
        border: '#7aa2ff22',
        borderStrong: '#7aa2ff40',
        text: '#e8eeff',
        textDim: '#9eb1d9',
      };
    case 'sunset':
      return {
        bg: '#1b0905',
        surface: '#2a130d',
        surfaceAlt: '#361a12',
        border: '#ff9a5a22',
        borderStrong: '#ff9a5a40',
        text: '#ffe9dc',
        textDim: '#d9af98',
      };
    case 'neon':
      return {
        bg: '#051510',
        surface: '#0b221b',
        surfaceAlt: '#123028',
        border: '#4de92622',
        borderStrong: '#4de92640',
        text: '#ddfff3',
        textDim: '#93ccb8',
      };
    case 'default':
    default:
      return {
        bg: '#090909',
        surface: '#141414',
        surfaceAlt: '#1b1b1b',
        border: '#ffffff0a',
        borderStrong: '#ffffff18',
        text: '#ffffff',
        textDim: '#ffffff70',
      };
  }
}
