import {
  ConfigPlugin,
  withDangerousMod,
  createRunOncePlugin,
} from 'expo/config-plugins';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Copies all native Android code from src/android directory to android directory
 * Recursively copies the entire directory structure and replaces PACKAGE_NAME placeholders
 */
const withAndroidNativeCode: ConfigPlugin = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot || process.cwd();
      const packageName =
        config.android?.package || 'com.jericx.syncclipboardmobile';

      const srcAndroidDir = path.join(projectRoot, 'src', 'android');
      const destAndroidDir = path.join(projectRoot, 'android');

      if (!fs.existsSync(srcAndroidDir)) {
        throw new Error(`Source directory not found: ${srcAndroidDir}`);
      }

      function copyFilesRecursive(sourceDir: string, destDir: string): void {
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }

        const files = fs.readdirSync(sourceDir);

        files.forEach((file) => {
          const sourcePath = path.join(sourceDir, file);
          const destPath = path.join(destDir, file);
          const stat = fs.statSync(sourcePath);

          if (stat.isDirectory()) {
            copyFilesRecursive(sourcePath, destPath);
          } else {
            let content = fs.readFileSync(sourcePath, 'utf8');
            content = content.replace(/PACKAGE_NAME/g, packageName);
            fs.writeFileSync(destPath, content, 'utf8');
            console.log(`✓ Copied: ${path.relative(srcAndroidDir, sourcePath)}`);
          }
        });
      }

      copyFilesRecursive(srcAndroidDir, destAndroidDir);
      console.log('✓ Android native code copied successfully');

      return config;
    },
  ]);
};

export default createRunOncePlugin(
  withAndroidNativeCode,
  'withAndroidNativeCode',
  '1.0.0'
);
