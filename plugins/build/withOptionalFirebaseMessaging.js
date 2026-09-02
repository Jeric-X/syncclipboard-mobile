"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addGoogleServicesClasspath = addGoogleServicesClasspath;
exports.applyGoogleServicesPlugin = applyGoogleServicesPlugin;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const config_plugins_1 = require("expo/config-plugins");
const GOOGLE_SERVICES_CLASSPATH = 'com.google.gms:google-services:4.5.0';
const GOOGLE_SERVICES_PLUGIN = 'com.google.gms.google-services';
function resolveGoogleServicesFile(projectRoot, props) {
    return path_1.default.resolve(projectRoot, props.googleServicesFile ?? './google-services.json');
}
function addGoogleServicesClasspath(contents) {
    if (contents.includes('com.google.gms:google-services'))
        return contents;
    return contents.replace(/dependencies\s*\{/, `dependencies {\n    classpath('${GOOGLE_SERVICES_CLASSPATH}')`);
}
function applyGoogleServicesPlugin(contents) {
    if (contents.includes(GOOGLE_SERVICES_PLUGIN))
        return contents;
    return `${contents.trimEnd()}\n\napply plugin: '${GOOGLE_SERVICES_PLUGIN}'\n`;
}
/** Enables standard Firebase Android resources only when a local config file is present. */
const withOptionalFirebaseMessaging = (config, props = {}) => {
    config = (0, config_plugins_1.withProjectBuildGradle)(config, (modConfig) => {
        const source = resolveGoogleServicesFile(modConfig.modRequest.projectRoot, props);
        if (!fs_1.default.existsSync(source)) {
            console.log('ℹ google-services.json not found; FCM remains unavailable');
            return modConfig;
        }
        modConfig.modResults.contents = addGoogleServicesClasspath(modConfig.modResults.contents);
        return modConfig;
    });
    config = (0, config_plugins_1.withAppBuildGradle)(config, (modConfig) => {
        const source = resolveGoogleServicesFile(modConfig.modRequest.projectRoot, props);
        if (!fs_1.default.existsSync(source))
            return modConfig;
        modConfig.modResults.contents = applyGoogleServicesPlugin(modConfig.modResults.contents);
        return modConfig;
    });
    config = (0, config_plugins_1.withDangerousMod)(config, [
        'android',
        async (modConfig) => {
            const source = resolveGoogleServicesFile(modConfig.modRequest.projectRoot, props);
            if (!fs_1.default.existsSync(source))
                return modConfig;
            const destination = path_1.default.join(modConfig.modRequest.platformProjectRoot, 'app', 'google-services.json');
            await fs_1.default.promises.copyFile(source, destination);
            console.log('✓ Copied optional google-services.json for FCM');
            return modConfig;
        },
    ]);
    return config;
};
exports.default = (0, config_plugins_1.createRunOncePlugin)(withOptionalFirebaseMessaging, 'withOptionalFirebaseMessaging', '1.0.0');
