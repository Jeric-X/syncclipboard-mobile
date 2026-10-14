"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_plugins_1 = require("expo/config-plugins");
const withForegroundService = (config) => {
    return (0, config_plugins_1.withAndroidManifest)(config, (modConfig) => {
        const manifest = modConfig.modResults.manifest;
        // Add FOREGROUND_SERVICE permission
        if (!manifest['uses-permission']) {
            manifest['uses-permission'] = [];
        }
        const permissions = manifest['uses-permission'];
        const addPermission = (name) => {
            if (!permissions.some((p) => p.$?.['android:name'] === name)) {
                permissions.push({ $: { 'android:name': name } });
                console.log(`✅ Added permission: ${name}`);
            }
        };
        addPermission('android.permission.FOREGROUND_SERVICE');
        addPermission('android.permission.FOREGROUND_SERVICE_SPECIAL_USE');
        // Register Service in <application>
        const application = manifest.application?.[0];
        if (application) {
            if (!application.service) {
                application.service = [];
            }
            const serviceClassName = 'expo.modules.foregroundservice.SyncForegroundService';
            let service = application.service.find((s) => s.$?.['android:name'] === serviceClassName);
            if (!service) {
                service = {
                    $: {
                        'android:name': serviceClassName,
                        'android:enabled': 'true',
                        'android:exported': 'false',
                    },
                };
                application.service.push(service);
                console.log(`✅ Registered service: ${serviceClassName}`);
            }
            service.$['android:foregroundServiceType'] = 'specialUse';
            const subtypeName = 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE';
            // Expo 的 ManifestService 类型尚未包含 Android 的 <property> 节点。
            const serviceWithProperties = service;
            const properties = (serviceWithProperties.property ??= []);
            const subtype = properties.find((property) => property.$['android:name'] === subtypeName);
            const subtypeValue = 'User-enabled continuous clipboard monitoring and cross-device clipboard synchronization, ' +
                'with a persistent notification and user controls to pause or stop the service.';
            if (subtype) {
                subtype.$['android:value'] = subtypeValue;
            }
            else {
                properties.push({ $: { 'android:name': subtypeName, 'android:value': subtypeValue } });
            }
        }
        return modConfig;
    });
};
exports.default = withForegroundService;
