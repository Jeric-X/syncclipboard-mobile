import { Platform } from 'react-native';
import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

const MODULE_NAME = 'PushEventSourceModule';

export interface NativePushProfileChangeHint {
  hash: string;
}

type NativeEvents = {
  onProfileChanged: (hint: NativePushProfileChangeHint) => void;
  onTokenChanged: () => void;
};

interface NativePushEventSourceModule {
  isFirebaseConfigured(): boolean;
  getToken(): Promise<string | null>;
  consumePendingProfileChangeHint(): NativePushProfileChangeHint | null;
  addListener<K extends keyof NativeEvents>(
    eventName: K,
    listener: NativeEvents[K]
  ): EventSubscription;
}

const NativeModule: NativePushEventSourceModule | null =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<NativePushEventSourceModule>(MODULE_NAME)
    : null;

export function isFirebaseConfigured(): boolean {
  return NativeModule?.isFirebaseConfigured() ?? false;
}

export async function getToken(): Promise<string | null> {
  return (await NativeModule?.getToken()) ?? null;
}

export function consumePendingProfileChangeHint(): NativePushProfileChangeHint | null {
  return NativeModule?.consumePendingProfileChangeHint() ?? null;
}

export function addProfileChangedListener(
  listener: (hint: NativePushProfileChangeHint) => void
): EventSubscription {
  return NativeModule?.addListener('onProfileChanged', listener) ?? { remove: () => {} };
}

export function addTokenChangedListener(listener: () => void): EventSubscription {
  return NativeModule?.addListener('onTokenChanged', listener) ?? { remove: () => {} };
}
