import { ConfigPlugin, withAppBuildGradle, createRunOncePlugin } from 'expo/config-plugins';

/**
 * Configures Android ABI splits so that separate APKs are built for
 * each CPU architecture (arm64-v8a, armeabi-v7a, x86_64).
 *
 * Each variant gets a unique versionCode by prepending an ABI-specific
 * digit so the Play Store can distinguish them:
 *   armeabi-v7a → versionCode * 10 + 1
 *   arm64-v8a   → versionCode * 10 + 2
 *   x86_64      → versionCode * 10 + 4
 */
const withAbiSplits: ConfigPlugin = (config) => {
  return withAppBuildGradle(config, (config) => {
    const contents = config.modResults.contents;

    // --- 1. splits block ---
    const splitsConfig = `
    splits {
        abi {
            enable true
            reset()
            include "arm64-v8a", "armeabi-v7a", "x86_64"
            universalApk true
        }
    }
`;

    if (!contents.includes('splits {')) {
      const androidBlockMatch = contents.match(/^android\s*\{[\s\S]*?\n\}/m);
      if (androidBlockMatch) {
        const androidBlock = androidBlockMatch[0];
        const modified = androidBlock.replace(/\n\}$/, splitsConfig + '\n}');
        config.modResults.contents = contents.replace(androidBlock, modified);
        console.log('✓ Added splits configuration to build.gradle');
      }
    } else {
      console.log('ℹ splits already configured in build.gradle');
    }

    // --- 2. per-ABI versionCode override ---
    const versionCodeOverride = `

// Assign unique versionCodes per ABI split
import com.android.build.OutputFile

ext.abiCodes = ["armeabi-v7a": 1, "arm64-v8a": 2, "x86_64": 4]

android.applicationVariants.all { variant ->
    variant.outputs.each { output ->
        def abiCode = project.ext.abiCodes.get(output.getFilter(OutputFile.ABI))
        if (abiCode != null) {
            output.versionCodeOverride = variant.versionCode * 10 + abiCode
        }
    }
}
`;

    if (!config.modResults.contents.includes('abiCodes')) {
      config.modResults.contents += versionCodeOverride;
      console.log('✓ Added per-ABI versionCode override to build.gradle');
    }

    return config;
  });
};

export default createRunOncePlugin(withAbiSplits, 'withAbiSplits', '1.0.0');
