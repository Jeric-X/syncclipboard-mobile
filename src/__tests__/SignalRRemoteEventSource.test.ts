jest.mock('signalr-client', () => ({
  getSignalRClient: jest.fn(),
}));

import type { ConnectionState, ProfileChangedEvent, SignalRClient } from 'signalr-client';
import { SignalRRemoteEventSource } from '../services/sync/SignalRRemoteEventSource';
import type { ServerConfig } from '../types/api';

describe('SignalRRemoteEventSource', () => {
  it('adapts SignalR profile events to content-free change hints', async () => {
    let profileListener: ((event: ProfileChangedEvent) => void) | null = null;
    let stateListener: ((state: ConnectionState) => void) | null = null;
    const client = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      isConnected: jest.fn().mockReturnValue(true),
      getConnectionState: jest.fn().mockReturnValue('CONNECTED'),
      onRemoteClipboardChanged: jest.fn((listener) => {
        profileListener = listener;
      }),
      offRemoteClipboardChanged: jest.fn(),
      onRemoteHistoryChanged: jest.fn(),
      offRemoteHistoryChanged: jest.fn(),
      onConnectionStateChanged: jest.fn((listener) => {
        stateListener = listener;
      }),
      offConnectionStateChanged: jest.fn(),
      clearCallbacks: jest.fn(),
    } as unknown as SignalRClient;
    const server: ServerConfig = {
      type: 'syncclipboard',
      url: 'https://sync.example',
      username: 'user',
      password: 'password',
    };
    const source = new SignalRRemoteEventSource(server, client);
    const profileCallback = jest.fn();
    const stateCallback = jest.fn();

    const unsubscribeProfile = source.onProfileChanged(profileCallback);
    const unsubscribeState = source.onConnectionStateChanged(stateCallback);
    await source.connect();

    expect(client.connect).toHaveBeenCalledWith(server);
    expect(source.isConnected()).toBe(true);

    expect(profileListener).not.toBeNull();
    (profileListener as unknown as (event: ProfileChangedEvent) => void)({
      type: 'Text',
      hash: 'server-hash',
      text: 'clipboard body must not enter the hint',
      hasData: false,
      size: 0,
    });
    expect(profileCallback).toHaveBeenCalledWith({ hash: 'server-hash' });

    expect(stateListener).not.toBeNull();
    (stateListener as unknown as (state: ConnectionState) => void)('RECONNECTING');
    expect(stateCallback).toHaveBeenCalledWith('RECONNECTING');

    unsubscribeProfile();
    unsubscribeState();
    expect(client.offRemoteClipboardChanged).toHaveBeenCalledWith(profileListener);
    expect(client.offConnectionStateChanged).toHaveBeenCalledWith(stateListener);

    await source.disconnect();
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });
});
