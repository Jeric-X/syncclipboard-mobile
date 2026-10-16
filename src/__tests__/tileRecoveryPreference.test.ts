import * as ForegroundService from 'foreground-service';
import { configService } from '../services/ConfigService';
import { useSettingsStore } from '../stores/settingsStore';
import { DEFAULT_APP_CONFIG, type AppConfig } from '../types/storage';

jest.mock('foreground-service', () => ({ setTileRecoveryEnabled: jest.fn() }));
jest.mock('../services/NetworkAutoSwitchService', () => ({ networkAutoSwitchService: {} }));
jest.mock('../services/ConfigService', () => ({
  configService: { getConfig: jest.fn(), updateConfig: jest.fn(), subscribe: jest.fn() },
}));

// 使用真实 settingsStore 的配置加载和服务订阅，验证原生冷启动许可。
const savedConfigChanged = (configService.subscribe as jest.Mock).mock.calls[0][0] as (
  config: AppConfig
) => void;

beforeEach(() => {
  jest.clearAllMocks();
  useSettingsStore.setState({ config: null, isLoaded: false });
});

it('默认配置不会允许下拉磁贴唤起任务', async () => {
  (configService.getConfig as jest.Mock).mockResolvedValue(DEFAULT_APP_CONFIG);
  await useSettingsStore.getState().loadConfig();
  expect(ForegroundService.setTileRecoveryEnabled).toHaveBeenLastCalledWith(false);
});

it('后台任务和磁贴恢复同时开启才允许冷启动，不依赖通知和上传下载开关', async () => {
  (configService.getConfig as jest.Mock).mockResolvedValue({
    ...DEFAULT_APP_CONFIG,
    enableBackgroundTasks: true,
    enableTileRecovery: true,
    enableForegroundNotification: false,
    enableBackgroundUpload: false,
    enableBackgroundDownload: false,
  });
  await useSettingsStore.getState().loadConfig();
  expect(ForegroundService.setTileRecoveryEnabled).toHaveBeenLastCalledWith(true);
});

it.each([
  { enableBackgroundTasks: false, enableTileRecovery: true },
  { enableBackgroundTasks: true, enableTileRecovery: false },
  { enableBackgroundTasks: true, enableTileRecovery: undefined },
])('已保存配置变化后及时撤销原生许可：%j', (flags) => {
  savedConfigChanged({
    ...DEFAULT_APP_CONFIG,
    enableBackgroundTasks: true,
    enableTileRecovery: true,
  });
  savedConfigChanged({ ...DEFAULT_APP_CONFIG, ...flags } as AppConfig);
  expect(ForegroundService.setTileRecoveryEnabled).toHaveBeenLastCalledWith(false);
});

it('配置保存失败时 UI 乐观更新不能启用原生恢复', async () => {
  useSettingsStore.setState({
    config: { ...DEFAULT_APP_CONFIG, enableBackgroundTasks: true },
  });
  (configService.updateConfig as jest.Mock).mockRejectedValue(new Error('disk full'));
  await useSettingsStore.getState().updateConfig({ enableTileRecovery: true });
  expect(ForegroundService.setTileRecoveryEnabled).not.toHaveBeenCalled();
});
