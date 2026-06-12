"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_plugins_1 = require("expo/config-plugins");
/**
 * Adds ShareActivity to AndroidManifest.xml.
 * This transparent Activity handles shared content (text, files, images)
 * without showing the main app UI.
 */
function addShareActivity(androidManifest) {
    const { manifest } = androidManifest;
    if (!Array.isArray(manifest.application)) {
        console.warn('withShareActivity: No application array in manifest?');
        return androidManifest;
    }
    const application = manifest.application[0];
    if (!application.activity) {
        application.activity = [];
    }
    const activityName = '.share.ShareActivity';
    const existingIndex = application.activity.findIndex((a) => a.$['android:name'] === activityName);
    const activityEntry = {
        $: {
            'android:name': activityName,
            'android:exported': 'true',
            'android:theme': '@style/Theme.QuickAction.Transparent',
            'android:taskAffinity': '',
            'android:excludeFromRecents': 'true',
            'android:launchMode': 'singleTask',
            'android:screenOrientation': 'portrait',
            'android:configChanges': 'keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode|smallestScreenSize',
        },
        'intent-filter': [
            {
                action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
                category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
                data: [{ $: { 'android:mimeType': '*/*' } }],
            },
            {
                action: [{ $: { 'android:name': 'android.intent.action.SEND_MULTIPLE' } }],
                category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
                data: [{ $: { 'android:mimeType': '*/*' } }],
            },
        ],
    };
    if (existingIndex >= 0) {
        application.activity[existingIndex] = activityEntry;
    }
    else {
        application.activity.push(activityEntry);
    }
    return androidManifest;
}
const withShareActivity = (config) => {
    return (0, config_plugins_1.withAndroidManifest)(config, (config) => {
        config.modResults = addShareActivity(config.modResults);
        return config;
    });
};
exports.default = (0, config_plugins_1.createRunOncePlugin)(withShareActivity, 'withShareActivity', '1.0.0');
