"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_plugins_1 = require("expo/config-plugins");
/**
 * Registers NativeUtilPackage in MainApplication so that the NativeUtilModule
 * NativeModule is available to JavaScript.
 */
const withNativeUtilModule = (config) => {
    return (0, config_plugins_1.withMainApplication)(config, (config) => {
        let contents = config.modResults.contents;
        const importLine = 'import com.jericx.syncclipboardmobile.nativeutil.NativeUtilPackage';
        const addLine = 'add(NativeUtilPackage())';
        // Add the import if not already present
        if (!contents.includes(importLine)) {
            contents = contents.replace('import expo.modules.ApplicationLifecycleDispatcher', `${importLine}\nimport expo.modules.ApplicationLifecycleDispatcher`);
        }
        // Register add(NativeUtilPackage()) if not already present
        if (!contents.includes(addLine)) {
            // Anchor on the stable RN-template comment line, not on other packages
            contents = contents.replace('// add(MyReactNativePackage())', '// add(MyReactNativePackage())\n              add(NativeUtilPackage())');
            if (contents.includes(addLine)) {
                console.log('✓ Registered NativeUtilPackage in MainApplication.kt');
            }
            else {
                console.warn('⚠ Failed to register NativeUtilPackage: anchor comment not found');
            }
        }
        else {
            console.log('ℹ NativeUtilPackage already registered in MainApplication.kt');
        }
        config.modResults.contents = contents;
        return config;
    });
};
exports.default = (0, config_plugins_1.createRunOncePlugin)(withNativeUtilModule, 'withNativeUtilModule', '1.0.0');
