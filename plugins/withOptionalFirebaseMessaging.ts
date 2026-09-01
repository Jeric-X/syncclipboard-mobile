import fs from 'fs';
import path from 'path';
import {
  ConfigPlugin,
  createRunOncePlugin,
  withAppBuildGradle,
  withDangerousMod,
  withProjectBuildGradle,
} from 'expo/config-plugins';

const GOOGLE_SERVICES_CLASSPATH = 'com.google.gms:google-services:4.5.0';
const GOOGLE_SERVICES_PLUGIN = 'com.google.gms.google-services';

interface OptionalFirebaseMessagingProps {
  googleServicesFile?: string;
}

function resolveGoogleServicesFile(
  projectRoot: string,
  props: OptionalFirebaseMessagingProps
): string {
  return path.resolve(projectRoot, props.googleServicesFile ?? './google-services.json');
}

export function addGoogleServicesClasspath(contents: string): string {
  if (contents.includes('com.google.gms:google-services')) return contents;
  return contents.replace(
    /dependencies\s*\{/,
    `dependencies {\n    classpath('${GOOGLE_SERVICES_CLASSPATH}')`
  );
}

export function applyGoogleServicesPlugin(contents: string): string {
  if (contents.includes(GOOGLE_SERVICES_PLUGIN)) return contents;
  return `${contents.trimEnd()}\n\napply plugin: '${GOOGLE_SERVICES_PLUGIN}'\n`;
}

/** Enables standard Firebase Android resources only when a local config file is present. */
const withOptionalFirebaseMessaging: ConfigPlugin<OptionalFirebaseMessagingProps> = (
  config,
  props = {}
) => {
  config = withProjectBuildGradle(config, (modConfig) => {
    const source = resolveGoogleServicesFile(modConfig.modRequest.projectRoot, props);
    if (!fs.existsSync(source)) {
      console.log('ℹ google-services.json not found; FCM remains unavailable');
      return modConfig;
    }
    modConfig.modResults.contents = addGoogleServicesClasspath(modConfig.modResults.contents);
    return modConfig;
  });

  config = withAppBuildGradle(config, (modConfig) => {
    const source = resolveGoogleServicesFile(modConfig.modRequest.projectRoot, props);
    if (!fs.existsSync(source)) return modConfig;
    modConfig.modResults.contents = applyGoogleServicesPlugin(modConfig.modResults.contents);
    return modConfig;
  });

  config = withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const source = resolveGoogleServicesFile(modConfig.modRequest.projectRoot, props);
      if (!fs.existsSync(source)) return modConfig;

      const destination = path.join(
        modConfig.modRequest.platformProjectRoot,
        'app',
        'google-services.json'
      );
      await fs.promises.copyFile(source, destination);
      console.log('✓ Copied optional google-services.json for FCM');
      return modConfig;
    },
  ]);

  return config;
};

export default createRunOncePlugin(
  withOptionalFirebaseMessaging,
  'withOptionalFirebaseMessaging',
  '1.0.0'
);
