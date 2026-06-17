import { AppRegistry, NativeModules } from 'react-native';

let isCarPlayInitialized = false;

export function initCarPlay() {
  console.log('[ANDROID_AUTO_DEBUG] initCarPlay() has been called!');
  
  if (isCarPlayInitialized) {
    console.log('[ANDROID_AUTO_DEBUG] initCarPlay() already initialized. Skipping.');
    return;
  }
  isCarPlayInitialized = true;

  console.log('[ANDROID_AUTO_DEBUG] NativeModules.RNCarPlay exists:', !!NativeModules.RNCarPlay);

  try {
    console.log('[ANDROID_AUTO_DEBUG] [STEP 1] Starting registration of "AndroidAuto" component via AppRegistry...');
    
    // Rejestracja pustego komponentu AndroidAuto - wymagane przez architekturę CarAppService w react-native-carplay
    AppRegistry.registerComponent('AndroidAuto', () => function AndroidAuto() {
      console.log('[ANDROID_AUTO_DEBUG] AndroidAuto entry functional component rendered!');
      return null;
    });
    
    console.log('[ANDROID_AUTO_DEBUG] [STEP 1] Component "AndroidAuto" successfully registered.');
  } catch (err: any) {
    console.error('[ANDROID_AUTO_DEBUG] [STEP 1 ERROR] Failed to register "AndroidAuto" component:', {
      message: err.message,
      stack: err.stack
    });
  }

  if (!NativeModules.RNCarPlay) {
    console.warn('[ANDROID_AUTO_DEBUG] NativeModules.RNCarPlay is undefined! CarPlay/AndroidAuto module is not available in this build.');
    return;
  }

  try {
    console.log('[ANDROID_AUTO_DEBUG] [STEP 2] Requiring "react-native-carplay"...');
    const { CarPlay, PaneTemplate } = require('react-native-carplay');

    console.log('[ANDROID_AUTO_DEBUG] [STEP 2] Loaded modules successfully.', {
      CarPlayExists: !!CarPlay,
      PaneTemplateExists: !!PaneTemplate,
    });

    console.log('[ANDROID_AUTO_DEBUG] [STEP 3] Registering CarPlay.registerOnConnect listener...');
    
    CarPlay.registerOnConnect(() => {
      console.log('[ANDROID_AUTO_DEBUG] Połączono! Generuję PaneTemplate.');
      try {
        const template = new PaneTemplate({
          title: 'VROOM',
          pane: {
            items: [{ text: 'Most działa! Bridgeless pokonany!' }],
          },
        });
        CarPlay.setRootTemplate(template);
        console.log('[ANDROID_AUTO_DEBUG] Szablon ustawiony poprawnie.');
      } catch (error) {
        console.error('[ANDROID_AUTO_DEBUG] Błąd podczas renderowania szablonu:', error);
      }
    });

    console.log('[ANDROID_AUTO_DEBUG] [STEP 3] CarPlay.registerOnConnect listener registered successfully.');

    console.log('[ANDROID_AUTO_DEBUG] [STEP 4] Registering CarPlay.registerOnDisconnect listener...');
    
    CarPlay.registerOnDisconnect(() => {
      console.log('[ANDROID_AUTO_DEBUG] === EVENT TRIGGERED: CarPlay.registerOnDisconnect ===');
    });

    console.log('[ANDROID_AUTO_DEBUG] [STEP 4] CarPlay.registerOnDisconnect listener registered successfully.');

  } catch (err: any) {
    console.error('[ANDROID_AUTO_DEBUG] [CRITICAL OUTER ERROR during initCarPlay]:', {
      message: err.message,
      stack: err.stack
    });
  }
}
