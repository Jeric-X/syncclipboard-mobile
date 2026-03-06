"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_plugins_1 = require("expo/config-plugins");
/**
 * Registers ShortcutPackage in MainApplication so that the ShortcutModule
 * NativeModule is available to JavaScript.
 */
const withShortcutModule = (config) => {
    return (0, config_plugins_1.withMainApplication)(config, (config) => {
        let contents = config.modResults.contents;
        const importLine = 'import com.jericx.syncclipboardmobile.shortcut.ShortcutPackage';
        // Add the import if not already present
        if (!contents.includes('ShortcutPackage')) {
            // Insert before the first expo import (stable anchor point)
            contents = contents.replace('import expo.modules.ApplicationLifecycleDispatcher', `${importLine}\nimport expo.modules.ApplicationLifecycleDispatcher`);
            // Register the package inside getPackages().apply { … }
            contents = contents.replace('// add(MyReactNativePackage())', '// add(MyReactNativePackage())\n              add(ShortcutPackage())');
            console.log('✓ Registered ShortcutPackage in MainApplication.kt');
        }
        else {
            console.log('ℹ ShortcutPackage already registered in MainApplication.kt');
        }
        config.modResults.contents = contents;
        return config;
    });
};
exports.default = (0, config_plugins_1.createRunOncePlugin)(withShortcutModule, 'withShortcutModule', '1.0.0');
