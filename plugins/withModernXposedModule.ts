import fs from 'fs';
import path from 'path';
import {
  ConfigPlugin,
  createRunOncePlugin,
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
} from 'expo/config-plugins';

const LIBXPOSED_API = 'io.github.libxposed:api:102.0.0';

export const LIBXPOSED_R8_RULES = `# modern libxposed API
-dontwarn io.github.libxposed.annotation.**
-adaptresourcefilecontents META-INF/xposed/java_init.list
-keep,allowoptimization,allowobfuscation public class * extends io.github.libxposed.api.XposedModule {
    public <init>();
}
`;

export function addLibXposedCompileOnly(contents: string): string {
  if (contents.includes(LIBXPOSED_API)) return contents;
  return contents.replace(
    /dependencies\s*\{/,
    `dependencies {\n    compileOnly "${LIBXPOSED_API}"`
  );
}

export function addLibXposedR8Rules(contents: string): string {
  if (contents.includes('-adaptresourcefilecontents META-INF/xposed/java_init.list')) {
    return contents;
  }
  return `${contents.trimEnd()}\n\n${LIBXPOSED_R8_RULES}`;
}

/** Packages an optional modern libxposed entry point without changing non-LSPosed behavior. */
const withModernXposedModule: ConfigPlugin = (config) => {
  config = withAppBuildGradle(config, (modConfig) => {
    modConfig.modResults.contents = addLibXposedCompileOnly(modConfig.modResults.contents);
    return modConfig;
  });

  config = withAndroidManifest(config, (modConfig) => {
    const application = modConfig.modResults.manifest.application?.[0];
    if (application?.$ && !application.$['android:description']) {
      application.$['android:description'] = '@string/xposed_module_description';
    }
    return modConfig;
  });

  config = withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const proguardPath = path.join(
        modConfig.modRequest.platformProjectRoot,
        'app',
        'proguard-rules.pro'
      );
      const current = await fs.promises.readFile(proguardPath, 'utf8');
      const configured = addLibXposedR8Rules(current);
      if (configured !== current) {
        await fs.promises.writeFile(proguardPath, configured);
        console.log('✓ Added modern libxposed R8 rules');
      }
      return modConfig;
    },
  ]);

  return config;
};

export default createRunOncePlugin(withModernXposedModule, 'withModernXposedModule', '1.0.0');
