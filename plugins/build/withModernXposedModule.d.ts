import { ConfigPlugin } from 'expo/config-plugins';
export declare const LIBXPOSED_R8_RULES = "# modern libxposed API\n-dontwarn io.github.libxposed.annotation.**\n-adaptresourcefilecontents META-INF/xposed/java_init.list\n-keep,allowoptimization,allowobfuscation public class * extends io.github.libxposed.api.XposedModule {\n    public <init>();\n}\n";
export declare function addLibXposedCompileOnly(contents: string): string;
export declare function addAndroidUnitTestDependency(contents: string): string;
export declare function addLibXposedR8Rules(contents: string): string;
declare const _default: ConfigPlugin<void>;
export default _default;
