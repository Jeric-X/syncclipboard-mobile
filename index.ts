import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';

import App from './App';
import QuickActionApp from './src/QuickActionApp';
import ServiceRestartApp from './src/ServiceRestartApp';
import SmsUploadTask from './src/tasks/SmsUploadTask';
import ServiceRuntimeHeadlessTask from './src/tasks/ServiceRuntimeHeadlessTask';
import { installServiceRuntime } from './src/services/ServiceRuntime';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

// Separate entry point for the transparent QuickActionActivity
AppRegistry.registerComponent('quickAction', () => QuickActionApp);

// Fallback UI when the user taps a notification after headless recovery fails
AppRegistry.registerComponent('serviceRestart', () => ServiceRestartApp);

// Headless JS task for SMS verification code upload (runs without UI)
AppRegistry.registerHeadlessTask('SmsUploadTask', () => SmsUploadTask);
AppRegistry.registerHeadlessTask('ServiceRuntimeHeadlessTask', () => ServiceRuntimeHeadlessTask);

installServiceRuntime();
