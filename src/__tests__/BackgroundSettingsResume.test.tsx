import React from 'react';
// @ts-expect-error React Native 的 Jest 依赖提供 renderer，但未附带类型声明。
import TestRenderer, { act } from 'react-test-renderer';
import { Alert } from 'react-native';
import { BackgroundSettings } from '../screens/settings/BackgroundSettings';
import { requestServiceRuntime } from '../services/ServiceRuntime';
import { useSettingsStore } from '../stores';

jest.mock('../components/settings', () => ({
  SettingsSection: 'section',
  SettingSwitch: 'setting-switch',
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../stores', () => ({ useSettingsStore: jest.fn() }));
jest.mock('../services/ServiceRuntime', () => ({ requestServiceRuntime: jest.fn() }));
jest.mock('../services/ConfigService', () => ({ configService: {} }));
jest.mock('../utils/notificationPermission', () => ({ requestNotificationPermission: jest.fn() }));
jest.mock('clipboard-overlay', () => ({}));
jest.mock('shizuku-clipboard', () => ({}));

const mockEnable = jest.fn();
const mockPause = jest.fn();
const showMessage = jest.fn();
let root: ReturnType<typeof TestRenderer.create>;
const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let previousAct: boolean | undefined;
function toggle() {
  return root.root.findAllByType('setting-switch')[0];
}
async function render(paused: boolean) {
  (useSettingsStore as unknown as jest.Mock).mockReturnValue({
    config: { enableBackgroundTasks: paused },
    isTempDisabledBackgroundTasks: paused,
    setEnableBackgroundTasks: mockEnable,
    setTempDisabledBackgroundTasks: mockPause,
  });
  await act(async () => {
    root = TestRenderer.create(<BackgroundSettings showMessage={showMessage} />);
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  previousAct = testGlobal.IS_REACT_ACT_ENVIRONMENT;
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  (requestServiceRuntime as jest.Mock).mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  testGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
  jest.restoreAllMocks();
});
it('临时停止后，按钮等待共享运行时恢复再显示开启', async () => {
  let release!: () => void;
  (requestServiceRuntime as jest.Mock).mockReturnValue(
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  await render(true);
  let pending!: Promise<void>;
  await act(async () => {
    pending = toggle().props.onChange(true);
  });
  const requested = (requestServiceRuntime as jest.Mock).mock.calls;
  const enabledEarly = toggle().props.value;
  release();
  await act(async () => {
    await pending;
  });
  expect(requested).toEqual([[true]]);
  expect(enabledEarly).toBe(false);
  expect(toggle().props.value).toBe(true);
});
it('恢复失败保留关闭显示并提示原因', async () => {
  (requestServiceRuntime as jest.Mock).mockRejectedValueOnce(new Error('startup failed'));
  await render(true);
  await act(async () => {
    await toggle().props.onChange(true);
  });
  expect(toggle().props.value).toBe(false);
  expect(showMessage).toHaveBeenCalledWith('startup failed', 'error');
});
it('永久停止后的确认开启也请求运行时', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(false);
  await act(async () => {
    await toggle().props.onChange(true);
  });
  const buttons = alert.mock.calls[0][2]!;
  await act(async () => {
    await buttons[1].onPress?.();
  });
  expect(requestServiceRuntime).toHaveBeenCalledWith(true);
  expect(mockEnable).toHaveBeenCalledWith(true);
});
