"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const config_plugins_1 = require("expo/config-plugins");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Copies all native Android code from src/android directory to android directory
 * Recursively copies the entire directory structure and replaces PACKAGE_NAME placeholders
 */
const withAndroidNativeCode = (config) => {
    return (0, config_plugins_1.withDangerousMod)(config, [
        'android',
        async (config) => {
            const projectRoot = config.modRequest.projectRoot || process.cwd();
            const packageName = config.android?.package || 'com.jericx.syncclipboardmobile';
            const srcAndroidDir = path.join(projectRoot, 'src', 'android');
            const destAndroidDir = path.join(projectRoot, 'android');
            if (!fs.existsSync(srcAndroidDir)) {
                throw new Error(`Source directory not found: ${srcAndroidDir}`);
            }
            function copyFilesRecursive(sourceDir, destDir) {
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
                    }
                    else {
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
exports.default = (0, config_plugins_1.createRunOncePlugin)(withAndroidNativeCode, 'withAndroidNativeCode', '1.0.0');
