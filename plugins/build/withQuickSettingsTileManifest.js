"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_plugins_1 = require("expo/config-plugins");
/**
 * Adds Quick Settings Tile service to AndroidManifest.xml
 */
function addQuickSettingsTileService(androidManifest) {
    const { manifest } = androidManifest;
    if (!Array.isArray(manifest.application)) {
        console.warn('withQuickSettingsTile: No application array in manifest?');
        return androidManifest;
    }
    const application = manifest.application[0];
    if (!application.service) {
        application.service = [];
    }
    const tileService = {
        $: {
            'android:name': '.quicksettings.DownloadTileService',
            'android:exported': 'true',
            'android:icon': '@mipmap/ic_launcher',
            'android:label': '@string/tile_download_label',
            'android:permission': 'android.permission.BIND_QUICK_SETTINGS_TILE',
        },
        'intent-filter': [
            {
                action: [
                    {
                        $: {
                            'android:name': 'android.service.quicksettings.action.QS_TILE',
                        },
                    },
                ],
            },
        ],
    };
    const existingService = application.service.find((service) => service.$['android:name'] === '.quicksettings.DownloadTileService');
    if (!existingService) {
        application.service.push(tileService);
    }
    return androidManifest;
}
/**
 * Plugin to add Quick Settings Tile service to AndroidManifest
 */
const withQuickSettingsTileManifest = (config) => {
    return (0, config_plugins_1.withAndroidManifest)(config, (config) => {
        config.modResults = addQuickSettingsTileService(config.modResults);
        return config;
    });
};
exports.default = (0, config_plugins_1.createRunOncePlugin)(withQuickSettingsTileManifest, 'withQuickSettingsTileManifest', '1.0.0');
