import { AppRegistry, NativeModules } from 'react-native';

export function initCarPlay() {
  if (!NativeModules.RNCarPlay) return;

  try {
    // Rejestracja pustego komponentu AndroidAuto - wymagane przez architekturę CarAppService w react-native-carplay
    AppRegistry.registerComponent('AndroidAuto', () => function AndroidAuto() {
      return null;
    });

    const { CarPlay, NavigationTemplate, ListTemplate, GridTemplate, TabBarTemplate } = require('react-native-carplay');
    const CarMapScreen = require('../components/carplay/CarMapScreen').default;

    CarPlay.registerOnConnect(() => {
      try {
        // 1. Ekran mapy / nawigacji (główny widok na Surface)
        const mapTemplate = new NavigationTemplate({
          id: 'VroomMap',
          component: CarMapScreen,
          actions: [], // Puste na start, zostanie zaktualizowane poźniej
          mapButtons: [
            {
              id: 'report',
              icon: require('../assets/images/Frame1933.png'), // Tymczasowa ikona, lepiej dać plus/ostrzeżenie
            }
          ]
        });

        // 2. Ekran zgłoszeń (GridTemplate ukryty pod Action)
        const warningsTemplate = new GridTemplate({
          title: 'Zgłoś',
          buttons: [
            {
              id: 'police',
              titleVariants: ['Policja'],
              image: require('../assets/images/Frame1933.png'),
            },
            {
              id: 'camera',
              titleVariants: ['Fotoradar'],
              image: require('../assets/images/Frame1933.png'),
            },
            {
              id: 'hazard',
              titleVariants: ['Zagrożenie'],
              image: require('../assets/images/Frame1933.png'),
            }
          ]
        });

        // Eventy dla mapy - np klikniecie przycisku mapy pokaze ekran zgloszen
        mapTemplate.onMapButtonPressed = ({ id }) => {
          if (id === 'report') {
            CarPlay.pushTemplate(warningsTemplate, true);
          }
        };

        warningsTemplate.onButtonPressed = ({ id }) => {
          import('react-native').then(({ DeviceEventEmitter }) => {
            DeviceEventEmitter.emit('CarPlayReportWarning', id);
          });
          CarPlay.popTemplate(true);
        };

        // 3. Ekran Ekipa (ListTemplate)
        const friendsTemplate = new ListTemplate({
          title: 'Ekipa',
          sections: [
            {
              items: [
                {
                  text: 'Brak znajomych w pobliżu',
                  detailText: 'Zaproś znajomych do wspólnej jazdy',
                }
              ]
            }
          ]
        });

        // TabBar łączący wszystko
        const tabBar = new TabBarTemplate({
          title: 'VROOM',
          templates: [mapTemplate, friendsTemplate]
        });

        CarPlay.setRootTemplate(tabBar);
      } catch (e) {
        console.warn('Błąd podczas ustawiania szablonów CarPlay:', e);
      }
    });
  } catch (err) {
    console.warn('Błąd inicjalizacji react-native-carplay:', err);
  }
}
