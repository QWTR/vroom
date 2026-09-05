import { registerGlobals } from '@livekit/react-native';

registerGlobals();

require('./lib/networkDiagnostics');
require('./lib/notifications/runtime');
require('expo-router/entry');
