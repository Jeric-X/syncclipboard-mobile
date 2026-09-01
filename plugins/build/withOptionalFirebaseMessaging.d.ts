import { ConfigPlugin } from 'expo/config-plugins';
interface OptionalFirebaseMessagingProps {
    googleServicesFile?: string;
}
export declare function addGoogleServicesClasspath(contents: string): string;
export declare function applyGoogleServicesPlugin(contents: string): string;
declare const _default: ConfigPlugin<OptionalFirebaseMessagingProps>;
export default _default;
