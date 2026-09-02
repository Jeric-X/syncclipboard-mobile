"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LIBXPOSED_R8_RULES = void 0;
exports.addLibXposedCompileOnly = addLibXposedCompileOnly;
exports.addAndroidUnitTestDependency = addAndroidUnitTestDependency;
exports.addLibXposedR8Rules = addLibXposedR8Rules;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const config_plugins_1 = require("expo/config-plugins");
const LIBXPOSED_API = 'io.github.libxposed:api:102.0.0';
const JUNIT = 'junit:junit:4.13.2';
exports.LIBXPOSED_R8_RULES = `# modern libxposed API
-dontwarn io.github.libxposed.annotation.**
-adaptresourcefilecontents META-INF/xposed/java_init.list
-keep,allowoptimization,allowobfuscation public class * extends io.github.libxposed.api.XposedModule {
    public <init>();
}
`;
function addLibXposedCompileOnly(contents) {
    if (contents.includes(LIBXPOSED_API))
        return contents;
    return contents.replace(/dependencies\s*\{/, `dependencies {\n    compileOnly "${LIBXPOSED_API}"`);
}
function addAndroidUnitTestDependency(contents) {
    if (contents.includes(JUNIT))
        return contents;
    return contents.replace(/dependencies\s*\{/, `dependencies {\n    testImplementation "${JUNIT}"`);
}
function addLibXposedR8Rules(contents) {
    if (contents.includes('-adaptresourcefilecontents META-INF/xposed/java_init.list')) {
        return contents;
    }
    return `${contents.trimEnd()}\n\n${exports.LIBXPOSED_R8_RULES}`;
}
/** Packages an optional modern libxposed entry point without changing non-LSPosed behavior. */
const withModernXposedModule = (config) => {
    config = (0, config_plugins_1.withAppBuildGradle)(config, (modConfig) => {
        modConfig.modResults.contents = addAndroidUnitTestDependency(addLibXposedCompileOnly(modConfig.modResults.contents));
        return modConfig;
    });
    config = (0, config_plugins_1.withAndroidManifest)(config, (modConfig) => {
        const application = modConfig.modResults.manifest.application?.[0];
        if (application?.$ && !application.$['android:description']) {
            application.$['android:description'] = '@string/xposed_module_description';
        }
        return modConfig;
    });
    config = (0, config_plugins_1.withDangerousMod)(config, [
        'android',
        async (modConfig) => {
            const proguardPath = path_1.default.join(modConfig.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
            const current = await fs_1.default.promises.readFile(proguardPath, 'utf8');
            const configured = addLibXposedR8Rules(current);
            if (configured !== current) {
                await fs_1.default.promises.writeFile(proguardPath, configured);
                console.log('✓ Added modern libxposed R8 rules');
            }
            return modConfig;
        },
    ]);
    return config;
};
exports.default = (0, config_plugins_1.createRunOncePlugin)(withModernXposedModule, 'withModernXposedModule', '1.0.0');
