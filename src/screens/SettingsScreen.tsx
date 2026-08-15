/**
 * 设置页面
 * 提供主题切换功能、服务器配置、多用户切换
 */

import React, { useCallback, useEffect, useState, useRef } from 'react';
import {
  AppState,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  Linking,
  Platform,
  PermissionsAndroid,
  Modal,
} from 'react-native';
import { APP_VERSION } from '@/constants';
import { Paths, Directory } from 'expo-file-system';
import { calculateDirectorySize, clearDirectory } from '@/utils/fileStorage';
import { CLIPBOARD_TEMP_DIR } from '@/utils/fileStorage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import type { ThemeMode } from '@/theme';
import { useSettingsStore } from '@/stores';
import { ServerConfigModal, ServerListItem, MessageToast } from '@/components';
import {
  SettingsSection,
  SettingItem,
  SettingSwitch,
  ThemedSwitch,
  SettingInput,
  SettingDropdown,
  SettingAction,
} from '@/components/settings';
import { ServerConfig } from '@/types/api';
import { useMessageToast } from '@/hooks/useMessageToast';
import {
  shortcut,
  checkForUpdate,
  calculateLogSize,
  clearLogs,
  saveLogsToFile,
  setLogLevel as setLoggerLogLevel,
  type LogLevel,
  getPreferredAbi,
  findAssetForAbi,
  checkApkCache,
  downloadApk,
  installApk,
  cleanOldApkCache,
  type ReleaseAssetInfo,
  type ApkSource,
  formatFileSize,
} from '@/utils';
import { Plus, RefreshCw, ChevronDown, ChevronUp } from 'react-native-feather';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { hasOverlayPermission, requestOverlayPermission } from 'clipboard-overlay';
import {
  getSupportedAbis,
  isIgnoringBatteryOptimizations,
  requestIgnoreBatteryOptimizations,
  setExcludeFromRecents,
} from 'native-util';
import {
  isShizukuAvailable,
  hasShizukuPermission,
  requestShizukuPermission,
} from 'shizuku-clipboard';
import { extractVerificationCode } from '@/tasks/SmsUploadTask';
import { setStaticReceiverEnabled } from 'sms-forwarder';
import { useTranslation } from 'react-i18next';
import { useI18n } from '@/hooks/useI18n';
import type { Language } from '@/i18n';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { SettingsStackParamList } from '@/navigation/types';
import { ChevronRight } from 'react-native-feather';
import { useNetworkAutoSwitch } from '@/hooks/useNetworkAutoSwitch';
import { networkAutoSwitchService } from '@/services/NetworkAutoSwitchService';
import { currentNetworkService, type WifiPermissionState } from '@/services/CurrentNetworkService';
import { getNetworkAutoSwitchDescription } from '@/utils/networkAutoSwitch';
import {
  hasNotificationPermission,
  requestNotificationPermission,
} from '@/utils/notificationPermission';

export const SettingsScreen = () => {
  const { theme, themeMode, setThemeMode } = useTheme();
  const { t } = useTranslation();
  const { language: currentLanguage, systemLanguage, setLanguage } = useI18n();
  const navigation = useNavigation<StackNavigationProp<SettingsStackParamList>>();
  const autoSwitchRuntime = useNetworkAutoSwitch();
  const {
    config,
    isLoaded,
    loadConfig,
    addServer,
    updateServer,
    deleteServer,
    setActiveServer,
    setAutoSync,
    setAutoDownloadMaxSize,
    updateConfig,
    setAutoCheckUpdate,
    setLastUpdateCheckDate,
    setUpdateToBeta,
    setUpdateChannel,
    setEnableHistorySync,
    setLogLevel,
    setRemotePollingInterval,
    setLocalPollingInterval,
    setEnableBackgroundDownload,
    setEnableBackgroundUpload,
    setEnableClipboardOverlay,
    setEnableBackgroundTasks,
    setEnableSmsForwarding,
    setEnableShizukuClipboard,
    isTempDisabledBackgroundTasks,
    setTempDisabledBackgroundTasks,
    setAutoSaveSyncFile,
    setSyncFileSavePath,
    updateNetworkAutoSwitch,
  } = useSettingsStore();

  const [showServerModal, setShowServerModal] = useState(false);
  const [editingServerIndex, setEditingServerIndex] = useState<number | null>(null);
  const [serversCollapsed, setServersCollapsed] = useState(true);
  const { message, showMessage, handleMessageShown } = useMessageToast();

  // 本地状态用于跟踪Switch的当前值，避免闪烁
  const [localAutoSyncEnabled, setLocalAutoSyncEnabled] = useState(config?.autoSync ?? false);
  const [localDebugModeEnabled, setLocalDebugModeEnabled] = useState(config?.debugMode ?? false);
  const [localAutoCheckUpdateEnabled, setLocalAutoCheckUpdateEnabled] = useState(
    config?.autoCheckUpdate ?? true
  );
  const [localUpdateToBetaEnabled, setLocalUpdateToBetaEnabled] = useState(
    config?.updateToBeta ?? false
  );
  const [localUpdateChannel, setLocalUpdateChannel] = useState<'github' | 'gitee'>(
    config?.updateChannel ?? 'github'
  );
  const [localHistorySyncEnabled, setLocalHistorySyncEnabled] = useState(
    config?.enableHistorySync ?? false
  );
  const [localBackgroundDownloadEnabled, setLocalBackgroundDownloadEnabled] = useState(
    config?.enableBackgroundDownload ?? false
  );
  const [localBackgroundUploadEnabled, setLocalBackgroundUploadEnabled] = useState(
    config?.enableBackgroundUpload ?? false
  );
  const [localBackgroundTasksEnabled, setLocalBackgroundTasksEnabled] = useState(
    (config?.enableBackgroundTasks ?? false) && !isTempDisabledBackgroundTasks
  );
  const [localClipboardOverlayEnabled, setLocalClipboardOverlayEnabled] = useState(
    config?.enableClipboardOverlay ?? false
  );
  const [localShizukuClipboardEnabled, setLocalShizukuClipboardEnabled] = useState(
    config?.enableShizukuClipboard ?? false
  );
  const [localSmsForwardingEnabled, setLocalSmsForwardingEnabled] = useState(
    config?.enableSmsForwarding ?? false
  );
  const [localAutoSaveSyncFileEnabled, setLocalAutoSaveSyncFileEnabled] = useState(
    config?.autoSaveSyncFile ?? false
  );
  const [localSyncFileSavePath, setLocalSyncFileSavePath] = useState(
    config?.syncFileSavePath ?? ''
  );
  const [localForegroundNotification, setLocalForegroundNotification] = useState(
    config?.enableForegroundNotification ?? true
  );
  const [localSyncToastEnabled, setLocalSyncToastEnabled] = useState(
    config?.syncToastEnabled ?? true
  );
  const [localDebugOverlayVisible, setLocalDebugOverlayVisible] = useState(
    config?.debugOverlayVisible ?? false
  );
  const [localDebugUrlScheme, setLocalDebugUrlScheme] = useState(config?.debugUrlScheme ?? false);
  const [localDebugUpdateCheckNoLimit, setLocalDebugUpdateCheckNoLimit] = useState(
    config?.debugUpdateCheckNoLimit ?? false
  );
  const [showSmsTestModal, setShowSmsTestModal] = useState(false);
  const [smsTestInput, setSmsTestInput] = useState('');
  const [localHideFromRecents, setLocalHideFromRecents] = useState(
    config?.hideFromRecents ?? false
  );
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [localImageAutoDownload, setLocalImageAutoDownload] = useState<'wifi' | 'always' | 'off'>(
    config?.historyImageAutoDownload ?? 'wifi'
  );
  const [statsText, setStatsText] = useState('');

  // 更新检查状态
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  // APK 下载状态
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const updateCheckAbortRef = useRef<AbortController | null>(null);
  const latestAssetsRef = useRef<ReleaseAssetInfo[]>([]);
  const latestTagRef = useRef<string>('');
  const releaseNotesRef = useRef<string | undefined>(undefined);

  const appVersion = APP_VERSION;

  // 加载配置
  useEffect(() => {
    if (!isLoaded) {
      loadConfig();
    }
  }, [isLoaded, loadConfig]);

  // 当配置中的autoSync值变化时，更新本地状态
  useEffect(() => {
    setLocalAutoSyncEnabled(config?.autoSync ?? false);
  }, [config?.autoSync]);

  // 当配置中的debugMode值变化时，更新本地状态
  useEffect(() => {
    setLocalDebugModeEnabled(config?.debugMode ?? false);
  }, [config?.debugMode]);

  // 当配置中的autoCheckUpdate值变化时，更新本地状态
  useEffect(() => {
    setLocalAutoCheckUpdateEnabled(config?.autoCheckUpdate ?? true);
  }, [config?.autoCheckUpdate]);

  useEffect(() => {
    setLocalUpdateToBetaEnabled(config?.updateToBeta ?? false);
  }, [config?.updateToBeta]);

  useEffect(() => {
    setLocalUpdateChannel(config?.updateChannel ?? 'github');
  }, [config?.updateChannel]);

  useEffect(() => {
    setLocalHistorySyncEnabled(config?.enableHistorySync ?? true);
  }, [config?.enableHistorySync]);

  useEffect(() => {
    setLocalBackgroundDownloadEnabled(config?.enableBackgroundDownload ?? false);
  }, [config?.enableBackgroundDownload]);

  useEffect(() => {
    setLocalBackgroundUploadEnabled(config?.enableBackgroundUpload ?? false);
  }, [config?.enableBackgroundUpload]);

  useEffect(() => {
    setLocalBackgroundTasksEnabled(
      (config?.enableBackgroundTasks ?? false) && !isTempDisabledBackgroundTasks
    );
  }, [config?.enableBackgroundTasks, isTempDisabledBackgroundTasks]);

  useEffect(() => {
    setLocalClipboardOverlayEnabled(config?.enableClipboardOverlay ?? false);
  }, [config?.enableClipboardOverlay]);

  useEffect(() => {
    setLocalShizukuClipboardEnabled(config?.enableShizukuClipboard ?? false);
  }, [config?.enableShizukuClipboard]);

  useEffect(() => {
    setLocalSmsForwardingEnabled(config?.enableSmsForwarding ?? false);
  }, [config?.enableSmsForwarding]);

  useEffect(() => {
    setLocalAutoSaveSyncFileEnabled(config?.autoSaveSyncFile ?? false);
  }, [config?.autoSaveSyncFile]);

  useEffect(() => {
    setLocalSyncFileSavePath(config?.syncFileSavePath ?? '');
  }, [config?.syncFileSavePath]);

  useEffect(() => {
    setLocalForegroundNotification(config?.enableForegroundNotification ?? true);
  }, [config?.enableForegroundNotification]);

  useEffect(() => {
    setLocalSyncToastEnabled(config?.syncToastEnabled ?? true);
  }, [config?.syncToastEnabled]);

  useEffect(() => {
    setLocalHideFromRecents(config?.hideFromRecents ?? false);
  }, [config?.hideFromRecents]);

  useEffect(() => {
    setLocalImageAutoDownload(config?.historyImageAutoDownload ?? 'wifi');
  }, [config?.historyImageAutoDownload]);

  // 计算存储大小
  useEffect(() => {
    calculateStorageSizes();
  }, []);

  // 刷新权限状态
  const refreshPermissions = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    setIsRefreshingPermissions(true);
    try {
      const [notif, sms, wifiLocation, wifiBackgroundLocation] = await Promise.all([
        hasNotificationPermission(),
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS),
        currentNetworkService.getFineLocationPermissionState(),
        currentNetworkService.getBackgroundLocationPermissionState(),
      ]);
      setPermNotification(notif);
      setPermOverlay(hasOverlayPermission());
      setPermSms(sms);
      setPermWifiLocation(wifiLocation === 'granted');
      setPermWifiBackgroundLocation(
        wifiBackgroundLocation === 'granted' || wifiBackgroundLocation === 'unavailable'
      );
      setLocationServicesEnabled(currentNetworkService.isLocationServicesEnabled());
      setPermBattery(isIgnoringBatteryOptimizations());
      const shizukuUp = isShizukuAvailable();
      setShizukuAvailable(shizukuUp);
      setPermShizuku(shizukuUp && hasShizukuPermission());
    } catch (e) {
      console.warn('[Settings] Failed to check permissions:', e);
    } finally {
      setIsRefreshingPermissions(false);
    }
  }, []);

  useEffect(() => {
    void refreshPermissions();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshPermissions();
    });
    return () => subscription.remove();
  }, [refreshPermissions]);

  // 自动检查更新（每天一次）
  useEffect(() => {
    if (!isLoaded) return;
    if (!(config?.autoCheckUpdate ?? true)) return;
    const today = new Date().toISOString().slice(0, 10);
    if (
      !(config?.debugUpdateCheckNoLimit ?? false) &&
      (config?.lastUpdateCheckDate ?? '') === today
    )
      return;
    runUpdateCheck(false, config?.updateToBeta ?? false);
  }, [isLoaded]);

  const themeOptions: { label: string; value: ThemeMode }[] = [
    { label: t('settings.themeAuto'), value: 'auto' },
    { label: t('settings.themeLight'), value: 'light' },
    { label: t('settings.themeDark'), value: 'dark' },
  ];

  // 语言选项：zh/en label 用 native 名称（中文/English），auto label 跟随 UI 语言并标注当前系统语言
  const langNativeNames: Record<string, string> = {
    zh: t('settings.languageZh'),
    en: t('settings.languageEn'),
  };
  const languageOptions: { label: string; value: Language }[] = [
    {
      label: `${t('settings.languageAuto')}（${
        langNativeNames[systemLanguage] ?? systemLanguage
      }）`,
      value: 'auto',
    },
    { label: langNativeNames['zh'] ?? t('settings.languageZh'), value: 'zh' as Language },
    { label: 'English', value: 'en' },
  ];

  const imageAutoDownloadOptions: { label: string; value: 'wifi' | 'always' | 'off' }[] = [
    { label: t('settings.imageAutoDownloadWifi'), value: 'wifi' },
    { label: t('settings.imageAutoDownloadAlways'), value: 'always' },
    { label: t('settings.imageAutoDownloadOff'), value: 'off' },
  ];

  // 获取服务器列表
  const servers = config?.servers || [];
  const activeServerIndex = config?.activeServerIndex ?? -1;
  const activeServer = activeServerIndex >= 0 ? servers[activeServerIndex] : null;
  const autoDownloadMaxSizeMB = Math.round(
    (config?.autoDownloadMaxSize ?? 5 * 1024 * 1024) / (1024 * 1024)
  );

  // 本地 state 用于输入框
  const [maxSizeInput, setMaxSizeInput] = useState(autoDownloadMaxSizeMB.toString());
  const [maxHistoryItemsInput, setMaxHistoryItemsInput] = useState(
    (config?.maxHistoryItems ?? 1000).toString()
  );
  const [remotePollingInput, setRemotePollingInput] = useState(
    ((config?.remotePollingInterval ?? 3000) / 1000).toString()
  );
  const [localPollingInput, setLocalPollingInput] = useState(
    ((config?.localPollingInterval ?? 1000) / 1000).toString()
  );

  // 存储大小状态
  const [cacheSize, setCacheSize] = useState<number>(0);
  const [historySize, setHistorySize] = useState<number>(0);
  const [logSize, setLogSize] = useState<number>(0);
  const [isCalculating, setIsCalculating] = useState<boolean>(true);
  const [isExportingLogs, setIsExportingLogs] = useState<boolean>(false);
  const exportLogsAbortControllerRef = useRef<AbortController | null>(null);

  // 权限状态
  const [permNotification, setPermNotification] = useState<boolean>(false);
  const [permOverlay, setPermOverlay] = useState<boolean>(false);
  const [permSms, setPermSms] = useState<boolean>(false);
  const [permWifiLocation, setPermWifiLocation] = useState<boolean>(false);
  const [permWifiBackgroundLocation, setPermWifiBackgroundLocation] = useState<boolean>(false);
  const [locationServicesEnabled, setLocationServicesEnabled] = useState<boolean>(false);
  const [permBattery, setPermBattery] = useState<boolean>(false);
  const [permShizuku, setPermShizuku] = useState<boolean>(false);
  const [shizukuAvailable, setShizukuAvailable] = useState<boolean>(false);
  const [isRefreshingPermissions, setIsRefreshingPermissions] = useState<boolean>(false);
  const hasBatteryOptRequested = useRef<boolean>(false);

  const handleNetworkPermissionResult = (
    result: WifiPermissionState,
    update: (granted: boolean) => void
  ) => {
    update(result === 'granted' || result === 'unavailable');
    if (result === 'blocked') {
      Alert.alert(
        t('settings.permissionWifiBlockedTitle'),
        t('settings.permissionWifiBlockedMessage'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('common.goToSettings'), onPress: currentNetworkService.openSystemSettings },
        ]
      );
    }
  };

  // 目录对象
  const cacheDir = CLIPBOARD_TEMP_DIR;
  const historyDir = new Directory(Paths.document, 'clipboards', 'history');

  // 调试日志
  useEffect(() => {
    try {
      console.log('Cache directory:', cacheDir.uri);
      console.log('History directory:', historyDir.uri);
      console.log('Cache directory exists:', cacheDir.exists);
      console.log('History directory exists:', historyDir.exists);
    } catch (error) {
      console.error('Error checking directories:', error);
    }
  }, []);

  // 处理添加服务器
  const handleAddServer = () => {
    setEditingServerIndex(null);
    setShowServerModal(true);
  };

  // 处理编辑服务器
  const handleEditServer = (index: number) => {
    setEditingServerIndex(index);
    setShowServerModal(true);
  };

  // 处理保存服务器
  const handleSaveServer = async (serverConfig: ServerConfig) => {
    try {
      if (editingServerIndex !== null) {
        await updateServer(editingServerIndex, serverConfig);
        showMessage(t('settings.serverUpdated'), 'success');
      } else {
        await addServer(serverConfig);
        showMessage(t('settings.serverAdded'), 'success');
      }
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('common.operationFailed'), 'error');
    }
  };

  // 处理删除服务器
  const handleDeleteServer = async (index: number) => {
    try {
      await deleteServer(index);
      showMessage(t('settings.serverDeleted'), 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('common.operationFailed'), 'error');
    }
  };

  // 处理切换激活服务器
  const handleSetActiveServer = async (index: number) => {
    if (index === activeServerIndex) {
      if (servers.length > 1) {
        setServersCollapsed(true);
      }
      return;
    }

    if (servers.length > 1) {
      setServersCollapsed(true);
    }

    if (config?.networkAutoSwitch.enabled) {
      networkAutoSwitchService.beginManualOverride();
    }

    try {
      const { getHistorySyncService } = await import('@/services/history/HistorySyncService');
      const syncService = getHistorySyncService();
      syncService.cancelAll();
    } catch {
      // ignore
    }

    try {
      await setActiveServer(index);
      await updateConfig({ needsHistoryReorganize: true });
      showMessage(t('settings.serverSwitched'), 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('common.operationFailed'), 'error');
    }
  };

  const handleNetworkAutoSwitchToggle = (enabled: boolean) => {
    if (enabled && servers.length === 0) {
      Alert.alert(t('networkAutoSwitch.title'), t('networkAutoSwitch.needServer'), [
        { text: t('common.confirm') },
      ]);
      return;
    }
    void updateNetworkAutoSwitch({ enabled });
  };

  // 处理切换自动复制
  const handleToggleAutoSync = async (enabled: boolean) => {
    // 立即更新本地状态，避免闪烁
    setLocalAutoSyncEnabled(enabled);

    try {
      await setAutoSync(enabled);
      showMessage(
        enabled ? t('settings.autoSyncEnabled') : t('settings.autoSyncDisabled'),
        'success'
      );
    } catch (error: unknown) {
      // 如果设置失败，恢复原来的状态
      setLocalAutoSyncEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理切换后台任务总开关
  const handleToggleBackgroundTasks = async (enabled: boolean) => {
    if (enabled) {
      // 如果是临时停止状态，直接清除标志，不需要弹窗确认
      if (isTempDisabledBackgroundTasks) {
        setLocalBackgroundTasksEnabled(true);
        setTempDisabledBackgroundTasks(false);
        showMessage(t('settings.backgroundTasksResumed'), 'success');
        return;
      }
      Alert.alert(
        t('settings.enableBackgroundTasksTitle'),
        t('settings.enableBackgroundTasksMessage'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.confirmEnable'),
            onPress: async () => {
              setLocalBackgroundTasksEnabled(true);
              try {
                await setEnableBackgroundTasks(true);
                showMessage(t('settings.backgroundTasksEnabled'), 'success');
              } catch (error: unknown) {
                setLocalBackgroundTasksEnabled(false);
                showMessage(
                  error instanceof Error ? error.message : t('common.setFailed'),
                  'error'
                );
              }
            },
          },
        ]
      );
      return;
    }

    setLocalBackgroundTasksEnabled(false);
    try {
      await setEnableBackgroundTasks(false);
      showMessage(t('settings.backgroundTasksDisabled'), 'success');
    } catch (error: unknown) {
      setLocalBackgroundTasksEnabled(true);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理切换后台下载远程
  const handleToggleBackgroundDownload = async (enabled: boolean) => {
    if (enabled) {
      setLocalBackgroundDownloadEnabled(true);
      try {
        await setEnableBackgroundDownload(true);
        showMessage(t('settings.backgroundDownloadEnabled'), 'success');
      } catch (error: unknown) {
        setLocalBackgroundDownloadEnabled(false);
        showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
      }
      return;
    }

    setLocalBackgroundDownloadEnabled(false);
    try {
      await setEnableBackgroundDownload(false);
      showMessage(t('settings.backgroundDownloadDisabled'), 'success');
    } catch (error: unknown) {
      setLocalBackgroundDownloadEnabled(true);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理切换后台上传本地
  const handleToggleBackgroundUpload = async (enabled: boolean) => {
    if (enabled) {
      Alert.alert(
        t('settings.enableBackgroundUploadTitle'),
        t('settings.enableBackgroundUploadMessage'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.confirmEnable'),
            onPress: async () => {
              setLocalBackgroundUploadEnabled(true);
              try {
                await setEnableBackgroundUpload(true);
                showMessage(t('settings.backgroundUploadEnabled'), 'success');
              } catch (error: unknown) {
                setLocalBackgroundUploadEnabled(false);
                showMessage(
                  error instanceof Error ? error.message : t('common.setFailed'),
                  'error'
                );
              }
            },
          },
        ]
      );
      return;
    }

    setLocalBackgroundUploadEnabled(false);
    try {
      await setEnableBackgroundUpload(false);
      showMessage(t('settings.backgroundUploadDisabled'), 'success');
    } catch (error: unknown) {
      setLocalBackgroundUploadEnabled(true);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理切换悬浮窗获取剪贴板
  const handleToggleClipboardOverlay = async (enabled: boolean) => {
    if (enabled && Platform.OS === 'android') {
      Alert.alert(
        t('settings.enableClipboardOverlayTitle'),
        t('settings.enableClipboardOverlayMessage'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('settings.confirmOk'),
            onPress: async () => {
              if (!hasOverlayPermission()) {
                requestOverlayPermission();
                return;
              }
              setLocalClipboardOverlayEnabled(true);
              try {
                await setEnableClipboardOverlay(true);
                showMessage(t('settings.clipboardOverlayEnabled'), 'success');
              } catch (error: unknown) {
                setLocalClipboardOverlayEnabled(false);
                showMessage(
                  error instanceof Error ? error.message : t('common.setFailed'),
                  'error'
                );
              }
            },
          },
        ]
      );
      return;
    }

    setLocalClipboardOverlayEnabled(enabled);

    try {
      await setEnableClipboardOverlay(enabled);
      showMessage(
        enabled ? t('settings.clipboardOverlayEnabled') : t('settings.clipboardOverlayDisabled'),
        'success'
      );
    } catch (error: unknown) {
      setLocalClipboardOverlayEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理切换 Shizuku 获取剪贴板
  const handleToggleShizukuClipboard = async (enabled: boolean) => {
    if (enabled && Platform.OS === 'android') {
      // 检查 Shizuku 是否可用
      if (!isShizukuAvailable()) {
        Alert.alert(t('settings.shizukuNotRunningTitle'), t('settings.shizukuNotRunningMessage'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.learnMore'),
            onPress: () => Linking.openURL('https://shizuku.rikka.app/guide/setup/'),
          },
        ]);
        return;
      }

      // 检查 Shizuku 权限
      if (!hasShizukuPermission()) {
        const requested = requestShizukuPermission();
        if (!requested) {
          Alert.alert(
            t('settings.permissionRequestFailed'),
            t('settings.shizukuPermissionRequestFailed')
          );
          return;
        }
        showMessage(t('settings.shizukuGrantThenEnable'), 'info');
        return;
      }

      setLocalShizukuClipboardEnabled(true);
      try {
        // 启用 Shizuku 时自动关闭悬浮窗方式
        if (localClipboardOverlayEnabled) {
          setLocalClipboardOverlayEnabled(false);
          await setEnableClipboardOverlay(false);
        }
        await setEnableShizukuClipboard(true);
        showMessage(t('settings.shizukuClipboardEnabled'), 'success');
      } catch (error: unknown) {
        setLocalShizukuClipboardEnabled(false);
        showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
      }
      return;
    }

    setLocalShizukuClipboardEnabled(enabled);
    try {
      await setEnableShizukuClipboard(enabled);
      showMessage(
        enabled ? t('settings.shizukuClipboardEnabled') : t('settings.shizukuClipboardDisabled'),
        'success'
      );
    } catch (error: unknown) {
      setLocalShizukuClipboardEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理切换自动上传短信验证码
  const handleToggleSmsForwarding = async (enabled: boolean) => {
    if (enabled && Platform.OS === 'android') {
      const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
      if (!granted) {
        const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
        if (result !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert(t('settings.smsPermissionTitle'), t('settings.smsPermissionMessage'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('common.goToSettings'), onPress: () => Linking.openSettings() },
          ]);
          return;
        }
      }
    }

    setLocalSmsForwardingEnabled(enabled);
    try {
      await setEnableSmsForwarding(enabled);
      // 同步静态短信接收器状态
      if (Platform.OS === 'android') {
        setStaticReceiverEnabled(enabled);
      }
      if (enabled) {
        const granted = await requestNotificationPermission();
        if (granted) setPermNotification(true);
      }
      showMessage(
        enabled ? t('settings.smsForwardingEnabled') : t('settings.smsForwardingDisabled'),
        'success'
      );
    } catch (error: unknown) {
      setLocalSmsForwardingEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理切换自动保存同步文件
  const handleToggleAutoSaveSyncFile = async (enabled: boolean) => {
    setLocalAutoSaveSyncFileEnabled(enabled);
    try {
      await setAutoSaveSyncFile(enabled);
      showMessage(
        enabled ? t('settings.autoSaveSyncFileEnabled') : t('settings.autoSaveSyncFileDisabled'),
        'success'
      );
    } catch (error: unknown) {
      setLocalAutoSaveSyncFileEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理选择同步文件保存路径
  const handlePickSyncFileSavePath = async () => {
    try {
      const directory = await Directory.pickDirectoryAsync();
      if (directory) {
        const path = directory.uri;
        setLocalSyncFileSavePath(path);
        await setSyncFileSavePath(path);
        showMessage(t('settings.syncFileSavePathSet'), 'success');
      }
    } catch (error: unknown) {
      // 用户取消选择不显示错误
      if (error instanceof Error && !error.message.includes('cancelled')) {
        showMessage(error.message, 'error');
      }
    }
  };

  // 处理切换前台服务常驻通知
  const handleToggleForegroundNotification = async (enabled: boolean) => {
    if (!enabled) {
      Alert.alert(
        t('settings.disableForegroundNotifTitle'),
        t('settings.disableForegroundNotifMessage'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('settings.confirmClose'),
            onPress: async () => {
              setLocalForegroundNotification(false);
              try {
                await updateConfig({ enableForegroundNotification: false });
              } catch (error: unknown) {
                setLocalForegroundNotification(true);
                showMessage(
                  error instanceof Error ? error.message : t('common.setFailed'),
                  'error'
                );
              }
            },
          },
        ]
      );
      return;
    }

    setLocalForegroundNotification(true);
    try {
      await updateConfig({ enableForegroundNotification: true });
      const granted = await requestNotificationPermission();
      if (granted) setPermNotification(true);
    } catch (error: unknown) {
      setLocalForegroundNotification(false);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理最大文件大小输入
  const handleMaxSizeBlur = async () => {
    try {
      const sizeMB = parseInt(maxSizeInput, 10);
      if (isNaN(sizeMB) || sizeMB < 0) {
        setMaxSizeInput(autoDownloadMaxSizeMB.toString());
        showMessage(t('settings.invalidNumber'), 'error');
        return;
      }
      const sizeInBytes = sizeMB * 1024 * 1024;
      await setAutoDownloadMaxSize(sizeInBytes);
      showMessage(t('settings.maxSizeSet', { size: sizeMB }), 'success');
    } catch (error: unknown) {
      setMaxSizeInput(autoDownloadMaxSizeMB.toString());
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理历史记录最大保留条数输入
  const handleMaxHistoryItemsBlur = async () => {
    try {
      const maxItems = parseInt(maxHistoryItemsInput, 10);
      if (isNaN(maxItems) || maxItems < 10) {
        setMaxHistoryItemsInput((config?.maxHistoryItems ?? 1000).toString());
        showMessage(t('settings.numberMin10'), 'error');
        return;
      }
      await updateConfig({ maxHistoryItems: maxItems });
      showMessage(t('settings.maxHistoryItemsSet', { count: maxItems }), 'success');

      // 更新历史记录存储的最大大小
      const { historyStorage } = await import('@/storage');
      historyStorage.setMaxHistorySize(maxItems);
    } catch (error: unknown) {
      setMaxHistoryItemsInput((config?.maxHistoryItems ?? 1000).toString());
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理远程轮询间隔输入
  const handleRemotePollingBlur = async () => {
    try {
      const seconds = parseInt(remotePollingInput, 10);
      if (isNaN(seconds) || seconds < 1) {
        setRemotePollingInput(((config?.remotePollingInterval ?? 3000) / 1000).toString());
        showMessage(t('settings.numberMin1'), 'error');
        return;
      }
      const ms = seconds * 1000;
      await setRemotePollingInterval(ms);
      showMessage(t('settings.remotePollingSet', { seconds }), 'success');
    } catch (error: unknown) {
      setRemotePollingInput(((config?.remotePollingInterval ?? 3000) / 1000).toString());
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理本地轮询间隔输入
  const handleLocalPollingBlur = async () => {
    try {
      const seconds = parseInt(localPollingInput, 10);
      if (isNaN(seconds) || seconds < 1) {
        setLocalPollingInput(((config?.localPollingInterval ?? 1000) / 1000).toString());
        showMessage(t('settings.numberMin1'), 'error');
        return;
      }
      const ms = seconds * 1000;
      await setLocalPollingInterval(ms);
      showMessage(t('settings.localPollingSet', { seconds }), 'success');
    } catch (error: unknown) {
      setLocalPollingInput(((config?.localPollingInterval ?? 1000) / 1000).toString());
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 过滤输入，只允许正整数
  const filterPositiveInteger = (value: string): string => {
    const filtered = value.replace(/[^0-9]/g, '');
    if (filtered === '') return '';
    const num = parseInt(filtered, 10);
    return num > 0 ? filtered : '';
  };

  // 处理切换调试模式
  const handleToggleDebugMode = async (enabled: boolean) => {
    // 立即更新本地状态，避免闪烁
    setLocalDebugModeEnabled(enabled);

    try {
      await updateConfig({ debugMode: enabled });
      showMessage(
        enabled ? t('settings.debugModeEnabled') : t('settings.debugModeDisabled'),
        'success'
      );
    } catch (error: unknown) {
      // 如果设置失败，恢复原来的状态
      setLocalDebugModeEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理切换调试悬浮窗显示
  const handleToggleDebugOverlayVisible = async (enabled: boolean) => {
    setLocalDebugOverlayVisible(enabled);
    try {
      await updateConfig({ debugOverlayVisible: enabled });
      showMessage(
        enabled ? t('settings.debugOverlayEnabled') : t('settings.debugOverlayDisabled'),
        'success'
      );
    } catch (error: unknown) {
      setLocalDebugOverlayVisible(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理切换显示 URL Scheme 调用
  const handleToggleDebugUrlScheme = async (enabled: boolean) => {
    setLocalDebugUrlScheme(enabled);
    try {
      await updateConfig({ debugUrlScheme: enabled });
    } catch (error: unknown) {
      setLocalDebugUrlScheme(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理切换启动时检查更新不限次数
  const handleToggleDebugUpdateCheckNoLimit = async (enabled: boolean) => {
    setLocalDebugUpdateCheckNoLimit(enabled);
    try {
      await updateConfig({ debugUpdateCheckNoLimit: enabled });
    } catch (error: unknown) {
      setLocalDebugUpdateCheckNoLimit(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 测试验证码短信提取
  const handleTestSmsCode = () => {
    const code = extractVerificationCode(smsTestInput);
    if (code) {
      Alert.alert(t('settings.smsExtractSuccess'), t('settings.smsExtractCode', { code }));
    } else {
      Alert.alert(t('settings.smsExtractFailed'), t('settings.smsExtractFailedMessage'));
    }
  };

  // 显示统计信息弹窗
  const handleShowStatistics = async () => {
    const { useStatisticsStore } = await import('@/stores/statisticsStore');
    const store = useStatisticsStore.getState();
    if (!store.isLoaded) {
      await store.load();
    }
    setStatsText(useStatisticsStore.getState().getStatisticsText());
    setShowStatsModal(true);
  };

  // 复制统计信息到剪贴板
  const handleCopyStatistics = async () => {
    const Clipboard = await import('expo-clipboard');
    await Clipboard.setStringAsync(statsText);
    setShowStatsModal(false);
    showMessage(t('settings.statisticsCopied'), 'success');
  };

  // 处理切换自动检查更新
  const handleToggleAutoCheckUpdate = async (enabled: boolean) => {
    setLocalAutoCheckUpdateEnabled(enabled);
    try {
      await setAutoCheckUpdate(enabled);
    } catch (error: unknown) {
      setLocalAutoCheckUpdateEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理切换更新到测试版
  const handleToggleUpdateToBeta = async (enabled: boolean) => {
    setLocalUpdateToBetaEnabled(enabled);
    try {
      await setUpdateToBeta(enabled);
    } catch (error: unknown) {
      setLocalUpdateToBetaEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  const handleToggleUpdateChannel = async (channel: 'github' | 'gitee') => {
    // 静默取消正在进行的检查更新
    if (updateCheckAbortRef.current) {
      updateCheckAbortRef.current.abort();
      updateCheckAbortRef.current = null;
    }
    // 静默取消正在进行的下载
    if (downloadAbortRef.current) {
      downloadAbortRef.current.abort();
      downloadAbortRef.current = null;
    }
    // 重置状态
    setIsCheckingUpdate(false);
    setIsDownloading(false);
    setUpdateAvailable(false);
    setLatestVersion(null);

    setLocalUpdateChannel(channel);
    try {
      await setUpdateChannel(channel);
    } catch (error: unknown) {
      setLocalUpdateChannel(channel === 'github' ? 'gitee' : 'github');
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  const handleToggleHistorySync = async (enabled: boolean) => {
    try {
      const { getHistorySyncService } = await import('@/services/history/HistorySyncService');
      const syncService = getHistorySyncService();
      syncService.cancelAll();

      if (!enabled) {
        await syncService.resetSyncCursor();
      }
    } catch {
      // ignore
    }

    setLocalHistorySyncEnabled(enabled);
    try {
      await setEnableHistorySync(enabled);

      if (!enabled) {
        await updateConfig({ needsHistoryReorganize: true });
      }

      showMessage(
        enabled ? t('settings.historySyncEnabled') : t('settings.historySyncDisabled'),
        'success'
      );
    } catch (error: unknown) {
      setLocalHistorySyncEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理历史记录图片自动下载设置变更
  const handleImageAutoDownloadChange = async (value: 'wifi' | 'always' | 'off') => {
    setLocalImageAutoDownload(value);
    try {
      await updateConfig({ historyImageAutoDownload: value });
    } catch {
      setLocalImageAutoDownload(config?.historyImageAutoDownload ?? 'wifi');
    }
  };

  // 处理切换同步 Toast 通知
  const handleToggleSyncToast = async (enabled: boolean) => {
    setLocalSyncToastEnabled(enabled);
    try {
      await updateConfig({ syncToastEnabled: enabled });
    } catch (error: unknown) {
      setLocalSyncToastEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理切换最近任务隐藏
  const handleToggleHideFromRecents = async (enabled: boolean) => {
    setLocalHideFromRecents(enabled);
    try {
      if (Platform.OS === 'android') {
        setExcludeFromRecents(enabled);
      }
      await updateConfig({ hideFromRecents: enabled });
    } catch (error: unknown) {
      setLocalHideFromRecents(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 执行更新检查逻辑
  const runUpdateCheck = async (showNoUpdateToast: boolean, includeBeta?: boolean) => {
    // 取消之前的检查
    if (updateCheckAbortRef.current) {
      updateCheckAbortRef.current.abort();
    }
    updateCheckAbortRef.current = new AbortController();

    setIsCheckingUpdate(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await setLastUpdateCheckDate(today);
      const useBeta = includeBeta ?? config?.updateToBeta ?? false;
      const channel = config?.updateChannel ?? 'github';
      const result = await checkForUpdate(
        appVersion,
        useBeta,
        channel,
        updateCheckAbortRef.current.signal
      );
      if (result.hasUpdate) {
        setUpdateAvailable(true);
        setLatestVersion(result.latestVersion);
        latestAssetsRef.current = result.assets;
        latestTagRef.current = result.tagName;
        releaseNotesRef.current = result.releaseNotes;
        showUpdateDialog(result.latestVersion, result.assets, result.releaseNotes);
      } else {
        setUpdateAvailable(false);
        setLatestVersion(null);
        if (showNoUpdateToast) {
          showMessage(t('settings.alreadyLatest'), 'success');
        }
      }
      cleanOldApkCache(appVersion);
    } catch (e) {
      // 如果是用户取消，不显示错误
      if (e instanceof Error && e.name === 'AbortError') {
        return;
      }
      if (showNoUpdateToast) {
        showMessage(t('settings.checkUpdateFailed'), 'error');
      }
    } finally {
      setIsCheckingUpdate(false);
      updateCheckAbortRef.current = null;
    }
  };

  // 取消更新检查
  const handleCancelUpdateCheck = () => {
    if (updateCheckAbortRef.current) {
      updateCheckAbortRef.current.abort();
      setIsCheckingUpdate(false);
      updateCheckAbortRef.current = null;
      showMessage(t('settings.updateCheckCancelled'), 'info');
    }
  };

  // 点击"更新"按钮：先检查缓存，有则直接安装，否则弹渠道选择
  const handleUpdateButtonPress = async (
    version: string,
    assets: ReleaseAssetInfo[],
    releaseNotes?: string
  ) => {
    if (isDownloading) return;

    let preferredAbi: string = 'universal';
    try {
      const abis = getSupportedAbis();
      preferredAbi = getPreferredAbi(abis);
    } catch (e) {
      console.warn('[UpdateDownload] getSupportedAbis failed:', e);
    }

    const asset = findAssetForAbi(assets, preferredAbi as Parameters<typeof findAssetForAbi>[1]);
    if (!asset) {
      showUpdateDialog(version, assets, releaseNotes);
      return;
    }

    const cached = await checkApkCache(version, asset);
    console.log(`[UpdateDownload] pre-check cache=${cached ?? 'miss'}`);
    if (cached) {
      await installApk(cached);
    } else {
      showUpdateDialog(version, assets, releaseNotes);
    }
  };

  const showUpdateDialog = (version: string, assets: ReleaseAssetInfo[], releaseNotes?: string) => {
    const channel = config?.updateChannel ?? 'github';
    const channelName = channel === 'github' ? 'GitHub' : 'Gitee';
    const body = releaseNotes
      ? t('settings.newVersionMessageWithChannel', {
          newVersion: version,
          currentVersion: appVersion,
          channel: channelName,
          notes: releaseNotes,
        })
      : t('settings.newVersionMessageNoNotesWithChannel', {
          newVersion: version,
          currentVersion: appVersion,
          channel: channelName,
        });
    Alert.alert(t('settings.newVersionTitle'), body, [
      { text: t('common.later'), style: 'cancel' },
      {
        text: t('settings.updateNow'),
        onPress: () => handleDownloadApk(channel, version, assets),
      },
    ]);
  };

  // 下载 APK
  const handleDownloadApk = async (
    source: ApkSource,
    version: string,
    assets: ReleaseAssetInfo[]
  ) => {
    if (isDownloading) return;

    // 检测设备 ABI
    let preferredAbi: string = 'universal';
    try {
      const abis = getSupportedAbis();
      preferredAbi = getPreferredAbi(abis);
      console.log(
        `[UpdateDownload] supportedAbis=${JSON.stringify(abis)} preferred=${preferredAbi}`
      );
    } catch (e) {
      console.warn('[UpdateDownload] getSupportedAbis failed:', e);
    }

    const asset = findAssetForAbi(assets, preferredAbi as Parameters<typeof findAssetForAbi>[1]);
    console.log(
      `[UpdateDownload] source=${source} version=${version} assets=${assets
        .map((a) => a.name)
        .join(',')} selectedAsset=${asset?.name ?? 'none'}`
    );
    if (!asset) {
      showMessage(t('settings.noSuitableApk'), 'error');
      return;
    }

    setIsDownloading(true);
    setDownloadProgress(0);

    const abortController = new AbortController();
    downloadAbortRef.current = abortController;

    try {
      // 检查是否已有缓存
      const cached = await checkApkCache(version, asset);
      console.log(`[UpdateDownload] cache check result=${cached ?? 'miss'}`);
      if (cached) {
        await installApk(cached);
        return;
      }

      const fileUri = await downloadApk({
        asset,
        source,
        version,
        signal: abortController.signal,
        onProgress: (info) => {
          setDownloadProgress(info.progress);
        },
      });

      console.log(`[UpdateDownload] download finished fileUri=${fileUri}`);
      setUpdateAvailable(false);
      setLatestVersion(null);
      await installApk(fileUri);
    } catch (err) {
      console.error('[UpdateDownload] error:', err);
      if (err instanceof Error && err.name === 'AbortError') {
        showMessage(t('settings.downloadCanceled'), 'info');
      } else {
        showMessage(err instanceof Error ? err.message : t('common.operationFailed'), 'error');
      }
    } finally {
      setIsDownloading(false);
      setDownloadProgress(0);
      downloadAbortRef.current = null;
    }
  };

  // 取消下载对话框
  const handleCancelDownload = () => {
    Alert.alert(t('settings.cancelDownloadTitle'), t('settings.cancelDownloadMessage'), [
      { text: t('settings.continueDownload'), style: 'cancel' },
      {
        text: t('settings.cancelDownloadTitle'),
        style: 'destructive',
        onPress: () => downloadAbortRef.current?.abort(),
      },
    ]);
  };

  // 计算存储大小
  const calculateStorageSizes = async () => {
    setIsCalculating(true);
    try {
      // 使用setTimeout模拟异步操作，避免UI阻塞
      await new Promise((resolve) => setTimeout(resolve, 100));
      const cacheSizeValue = calculateDirectorySize(cacheDir);
      const historySizeValue = calculateDirectorySize(historyDir);
      const logSizeValue = calculateLogSize();
      setCacheSize(cacheSizeValue);
      setHistorySize(historySizeValue);
      setLogSize(logSizeValue);
    } catch (error) {
      console.error('Failed to calculate storage sizes:', error);
    } finally {
      setIsCalculating(false);
    }
  };

  // 清除缓存
  const handleClearCache = () => {
    Alert.alert(
      t('settings.clearCacheTitle'),
      t('settings.clearCacheMessage'),
      [
        {
          text: t('common.cancel'),
          style: 'cancel',
        },
        {
          text: t('settings.confirmOk'),
          onPress: async () => {
            try {
              clearDirectory(cacheDir);
              await calculateStorageSizes();
              showMessage(t('settings.cacheCleared'), 'success');
            } catch {
              showMessage(t('settings.clearCacheFailed'), 'error');
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  // 清除日志
  const handleClearLogs = () => {
    Alert.alert(
      t('settings.clearLogsTitle'),
      t('settings.clearLogsMessage'),
      [
        {
          text: t('common.cancel'),
          style: 'cancel',
        },
        {
          text: t('settings.confirmOk'),
          onPress: async () => {
            try {
              clearLogs();
              await calculateStorageSizes();
              showMessage(t('settings.logsCleared'), 'success');
            } catch {
              showMessage(t('settings.clearLogsFailed'), 'error');
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  // 导出日志
  const handleExportLogs = async () => {
    if (isExportingLogs) {
      exportLogsAbortControllerRef.current?.abort();
      return;
    }

    const abortController = new AbortController();
    exportLogsAbortControllerRef.current = abortController;
    setIsExportingLogs(true);

    try {
      await saveLogsToFile(abortController.signal);
      showMessage(t('settings.logsSaved'), 'success');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        showMessage(t('settings.exportCanceled'), 'info');
      } else {
        const message = error instanceof Error ? error.message : t('common.operationFailed');
        showMessage(message, 'error');
      }
    } finally {
      setIsExportingLogs(false);
      exportLogsAbortControllerRef.current = null;
    }
  };

  // 设置日志等级
  const handleSetLogLevel = async (level: LogLevel) => {
    try {
      await setLogLevel(level);
      setLoggerLogLevel(level);
      showMessage(t('settings.logLevelSet', { level }), 'success');
    } catch {
      showMessage(t('settings.logLevelSetFailed'), 'error');
    }
  };

  // 处理添加下载快捷方式
  const handleAddDownloadShortcut = async () => {
    try {
      await shortcut.addDownloadShortcut();
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('common.operationFailed'), 'error');
    }
  };

  // 处理添加上传快捷方式
  const handleAddUploadShortcut = async () => {
    try {
      await shortcut.addUploadShortcut();
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('common.operationFailed'), 'error');
    }
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      edges={[]}
    >
      <ScrollView style={styles.scrollView}>
        {/* 服务器配置部分 */}
        <View style={styles.section}>
          <View style={[styles.sectionHeaderBase, styles.sectionHeaderRow]}>
            <TouchableOpacity
              style={styles.sectionTitleContainer}
              onPress={() => servers.length > 1 && setServersCollapsed(!serversCollapsed)}
              disabled={servers.length <= 1}
            >
              <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                {t('settings.serverSection')}
              </Text>
              {servers.length > 1 && (
                <View style={styles.collapseIcon}>
                  {serversCollapsed ? (
                    <ChevronDown color={theme.colors.textSecondary} width={18} height={18} />
                  ) : (
                    <ChevronUp color={theme.colors.textSecondary} width={18} height={18} />
                  )}
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconButton} onPress={handleAddServer}>
              <Plus color={theme.colors.primary} width={20} height={20} />
            </TouchableOpacity>
          </View>

          {servers.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: theme.colors.surface }]}>
              <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                {t('settings.noServers')}
              </Text>
              <Text style={[styles.emptyHint, { color: theme.colors.textTertiary }]}>
                {t('settings.noServersHint')}
              </Text>
            </View>
          ) : serversCollapsed && servers.length > 1 ? (
            activeServer && (
              <ServerListItem
                config={activeServer}
                isActive={true}
                onPress={() => {}}
                onEdit={() => handleEditServer(activeServerIndex)}
                onDelete={() => handleDeleteServer(activeServerIndex)}
                affectedRuleCount={
                  config?.networkAutoSwitch.rules.filter(
                    (rule) => rule.targetServerId === activeServer.id
                  ).length
                }
              />
            )
          ) : (
            servers.map((server, index) => (
              <ServerListItem
                key={server.id ?? index}
                config={server}
                isActive={index === activeServerIndex}
                onPress={() => handleSetActiveServer(index)}
                onEdit={() => handleEditServer(index)}
                onDelete={() => handleDeleteServer(index)}
                affectedRuleCount={
                  config?.networkAutoSwitch.rules.filter(
                    (rule) => rule.targetServerId === server.id
                  ).length
                }
              />
            ))
          )}
          <View
            style={[
              styles.autoSwitchCard,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
            ]}
          >
            <SettingItem
              label={t('networkAutoSwitch.title')}
              description={getNetworkAutoSwitchDescription(
                config?.networkAutoSwitch.enabled ?? false,
                autoSwitchRuntime,
                t
              )}
              descriptionLink={
                config?.networkAutoSwitch.enabled && autoSwitchRuntime.manualOverride
                  ? {
                      text: t('networkAutoSwitch.restoreAuto'),
                      onPress: () => void networkAutoSwitchService.clearManualOverride(),
                    }
                  : undefined
              }
              showBorder={false}
              pressFeedback="highlight"
              onPress={() => navigation.navigate('NetworkAutoSwitch')}
            >
              <View style={styles.autoSwitchControls}>
                <ThemedSwitch
                  testID="settings-network-auto-switch"
                  value={config?.networkAutoSwitch.enabled ?? false}
                  onValueChange={handleNetworkAutoSwitchToggle}
                />
                <ChevronRight color={theme.colors.textSecondary} width={20} height={20} />
              </View>
            </SettingItem>
          </View>
        </View>

        {/* 同步设置部分 */}
        <SettingsSection title={t('settings.syncSection')}>
          <SettingSwitch
            label={t('settings.autoSync')}
            description={t('settings.autoSyncDesc')}
            value={localAutoSyncEnabled}
            onChange={handleToggleAutoSync}
          />

          <SettingSwitch
            label={t('settings.syncToast')}
            description={t('settings.syncToastDesc')}
            value={localSyncToastEnabled}
            onChange={handleToggleSyncToast}
          />

          <SettingInput
            label={t('settings.autoDownloadMaxSize')}
            description={t('settings.autoDownloadMaxSizeDesc')}
            value={maxSizeInput}
            onChangeText={setMaxSizeInput}
            onBlur={handleMaxSizeBlur}
            unit="MB"
            keyboardType="number-pad"
            placeholder="5"
          />

          {activeServer?.type !== 'syncclipboard' && (
            <SettingInput
              label={t('settings.remotePollingInterval')}
              value={remotePollingInput}
              onChangeText={setRemotePollingInput}
              onBlur={handleRemotePollingBlur}
              unit={t('settings.unitSecond')}
              keyboardType="number-pad"
              placeholder="3"
              filter={filterPositiveInteger}
            />
          )}

          <SettingInput
            label={t('settings.localPollingInterval')}
            value={localPollingInput}
            onChangeText={setLocalPollingInput}
            onBlur={handleLocalPollingBlur}
            unit={t('settings.unitSecond')}
            keyboardType="number-pad"
            placeholder="1"
            filter={filterPositiveInteger}
          />

          <SettingSwitch
            label={t('settings.autoSaveSyncFile')}
            description={t('settings.autoSaveSyncFileDesc')}
            value={localAutoSaveSyncFileEnabled}
            onChange={handleToggleAutoSaveSyncFile}
          />

          {localAutoSaveSyncFileEnabled && (
            <SettingAction
              label={t('settings.syncFileSavePath')}
              description={localSyncFileSavePath || t('settings.syncFileSavePathNotSet')}
              buttonText={t('settings.syncFileSavePathPick')}
              onPress={handlePickSyncFileSavePath}
            />
          )}
        </SettingsSection>

        {/* 历史记录部分 */}
        <SettingsSection title={t('settings.historySection')}>
          <SettingSwitch
            label={t('settings.historySync')}
            description={
              activeServer?.type !== 'syncclipboard'
                ? t('settings.historySyncNotSupported')
                : t('settings.historySyncDesc')
            }
            value={localHistorySyncEnabled && activeServer?.type === 'syncclipboard'}
            onChange={handleToggleHistorySync}
            disabled={activeServer?.type !== 'syncclipboard'}
          />

          <SettingInput
            label={t('settings.maxHistoryItems')}
            description={t('settings.maxHistoryItemsDesc')}
            value={maxHistoryItemsInput}
            onChangeText={setMaxHistoryItemsInput}
            onBlur={handleMaxHistoryItemsBlur}
            unit={t('settings.unitItem')}
            keyboardType="number-pad"
            placeholder="100"
          />

          <SettingDropdown
            label={t('settings.imageAutoDownload')}
            options={imageAutoDownloadOptions}
            value={localImageAutoDownload}
            onChange={handleImageAutoDownloadChange}
          />

          <SettingSwitch
            label={t('settings.showImageCopyButton')}
            description={t('settings.showImageCopyButtonDesc')}
            value={config?.showImageCopyButton ?? false}
            onChange={(enabled) => updateConfig({ showImageCopyButton: enabled })}
          />
        </SettingsSection>

        {/* 后台任务部分 */}
        {Platform.OS === 'android' && (
          <SettingsSection title={t('settings.backgroundTasksSection')}>
            <SettingSwitch
              label={t('settings.backgroundTasksSection')}
              description={
                isTempDisabledBackgroundTasks
                  ? t('settings.backgroundTasksTempStopped')
                  : t('settings.backgroundTasksDesc')
              }
              value={localBackgroundTasksEnabled}
              onChange={handleToggleBackgroundTasks}
            />

            <SettingSwitch
              label={t('settings.foregroundNotification')}
              description={t('settings.foregroundNotificationDesc')}
              value={localBackgroundTasksEnabled && localForegroundNotification}
              onChange={handleToggleForegroundNotification}
              disabled={!localBackgroundTasksEnabled}
            />

            <SettingSwitch
              label={t('settings.backgroundDownload')}
              value={localBackgroundTasksEnabled && localBackgroundDownloadEnabled}
              onChange={handleToggleBackgroundDownload}
              disabled={!localBackgroundTasksEnabled}
            />

            <SettingSwitch
              label={t('settings.backgroundUpload')}
              value={localBackgroundTasksEnabled && localBackgroundUploadEnabled}
              onChange={handleToggleBackgroundUpload}
              disabled={!localBackgroundTasksEnabled}
            />

            <SettingSwitch
              label={t('settings.clipboardOverlay')}
              value={localBackgroundTasksEnabled && localClipboardOverlayEnabled}
              onChange={handleToggleClipboardOverlay}
              disabled={!localBackgroundTasksEnabled}
            />

            <SettingSwitch
              label={t('settings.shizukuClipboard')}
              descriptionLink={{
                text: t('settings.shizukuWebsite'),
                onPress: () => Linking.openURL('https://shizuku.rikka.app/'),
              }}
              value={localBackgroundTasksEnabled && localShizukuClipboardEnabled}
              onChange={handleToggleShizukuClipboard}
              disabled={!localBackgroundTasksEnabled}
            />
          </SettingsSection>
        )}

        {/* 短信自动化部分 */}
        {Platform.OS === 'android' && (
          <SettingsSection title={t('settings.smsSection')}>
            <SettingSwitch
              label={t('settings.smsForwarding')}
              value={localSmsForwardingEnabled}
              onChange={handleToggleSmsForwarding}
            />
          </SettingsSection>
        )}

        {/* 权限管理部分 */}
        {Platform.OS === 'android' && (
          <SettingsSection
            title={t('settings.permissionsSection')}
            headerRight={
              <TouchableOpacity
                style={styles.iconButton}
                onPress={refreshPermissions}
                disabled={isRefreshingPermissions}
              >
                <RefreshCw color={theme.colors.primary} width={16} height={16} />
              </TouchableOpacity>
            }
          >
            <SettingSwitch
              label={t('settings.permissionNotification')}
              value={permNotification}
              onChange={async () => {
                if (permNotification) {
                  await Linking.openSettings();
                  return;
                }
                const granted = await requestNotificationPermission({ showFailureAlert: false });
                setPermNotification(granted);
                if (!granted) {
                  await Linking.openSettings();
                }
              }}
            />

            <SettingSwitch
              label={t('settings.permissionWifiLocation')}
              description={t('settings.permissionWifiLocationDesc')}
              value={permWifiLocation}
              onChange={async () => {
                if (permWifiLocation) {
                  await currentNetworkService.openSystemSettings();
                  return;
                }
                handleNetworkPermissionResult(
                  await currentNetworkService.requestFineLocationPermission(),
                  setPermWifiLocation
                );
              }}
            />

            {Number(Platform.Version) >= 29 && (
              <SettingSwitch
                label={t('settings.permissionWifiBackgroundLocation')}
                description={t('settings.permissionWifiBackgroundLocationDesc')}
                value={permWifiBackgroundLocation}
                onChange={async () => {
                  if (permWifiBackgroundLocation) {
                    await currentNetworkService.openSystemSettings();
                    return;
                  }

                  if (!permWifiLocation) {
                    const fineResult = await currentNetworkService.requestFineLocationPermission();
                    handleNetworkPermissionResult(fineResult, setPermWifiLocation);
                    if (fineResult !== 'granted') return;
                  }

                  Alert.alert(
                    t('settings.permissionWifiBackgroundLocationTitle'),
                    t('settings.permissionWifiBackgroundLocationMessage'),
                    [
                      { text: t('common.cancel'), style: 'cancel' },
                      {
                        text:
                          Number(Platform.Version) >= 30
                            ? t('common.goToSettings')
                            : t('common.confirm'),
                        onPress: async () => {
                          if (Number(Platform.Version) >= 30) {
                            await currentNetworkService.openSystemSettings();
                            return;
                          }
                          handleNetworkPermissionResult(
                            await currentNetworkService.requestBackgroundLocationPermission(),
                            setPermWifiBackgroundLocation
                          );
                        },
                      },
                    ]
                  );
                }}
              />
            )}

            <SettingSwitch
              label={t('settings.locationServices')}
              description={t('settings.locationServicesDesc')}
              value={locationServicesEnabled}
              onChange={currentNetworkService.openLocationSettings}
            />

            <SettingSwitch
              label={t('settings.permissionOverlay')}
              description={t('settings.permissionOverlayDesc')}
              value={permOverlay}
              onChange={() => requestOverlayPermission()}
            />

            <SettingSwitch
              label={t('settings.permissionSms')}
              description={t('settings.permissionSmsDesc')}
              value={permSms}
              onChange={() => Linking.openSettings()}
            />

            <SettingSwitch
              label={t('settings.permissionShizuku')}
              description={
                shizukuAvailable
                  ? t('settings.permissionShizukuDesc')
                  : t('settings.shizukuNotRunningDesc')
              }
              value={permShizuku}
              onChange={async () => {
                if (!shizukuAvailable) {
                  Alert.alert(
                    t('settings.shizukuNotRunningTitle'),
                    t('settings.shizukuNotRunningMessage'),
                    [
                      {
                        text: t('common.learnMore'),
                        onPress: () => Linking.openURL('https://shizuku.rikka.app/guide/setup/'),
                      },
                      { text: t('common.cancel'), style: 'cancel' },
                    ]
                  );
                  return;
                }
                if (!permShizuku) {
                  requestShizukuPermission();
                  setTimeout(refreshPermissions, 2000);
                }
              }}
            />

            <SettingSwitch
              label={t('settings.permissionBattery')}
              description={t('settings.permissionBatteryDesc')}
              value={permBattery}
              onChange={async () => {
                if (hasBatteryOptRequested.current) {
                  Alert.alert(
                    t('settings.batteryOptDialogTitle'),
                    t('settings.batteryOptDialogMessage'),
                    [
                      {
                        text: t('common.goToSettings'),
                        onPress: () => Linking.openSettings(),
                      },
                      { text: t('common.cancel'), style: 'cancel' },
                    ]
                  );
                  return;
                }
                requestIgnoreBatteryOptimizations();
                hasBatteryOptRequested.current = true;
              }}
            />
          </SettingsSection>
        )}

        {/* 快捷操作部分 */}
        <SettingsSection title={t('settings.shortcutsSection')}>
          <SettingAction
            label={t('settings.addDownloadShortcut')}
            buttonText={t('common.add')}
            onPress={handleAddDownloadShortcut}
          />

          <SettingAction
            label={t('settings.addUploadShortcut')}
            buttonText={t('common.add')}
            onPress={handleAddUploadShortcut}
          />
        </SettingsSection>

        {/* 存储部分 */}
        <SettingsSection
          title={t('settings.storageSection')}
          headerRight={
            <TouchableOpacity
              style={styles.iconButton}
              onPress={calculateStorageSizes}
              disabled={isCalculating}
            >
              <RefreshCw color={theme.colors.primary} width={16} height={16} />
            </TouchableOpacity>
          }
        >
          <SettingAction
            label={t('settings.cacheSize')}
            description={isCalculating ? t('common.loading') : formatFileSize(cacheSize)}
            buttonText={t('common.clearAction')}
            onPress={handleClearCache}
            loading={isCalculating}
          />

          <SettingAction
            label={t('settings.logSize')}
            description={isCalculating ? t('common.loading') : formatFileSize(logSize)}
            buttonText={t('common.clearAction')}
            onPress={handleClearLogs}
            loading={isCalculating}
          />

          <SettingItem
            label={t('settings.historySize')}
            description={isCalculating ? t('common.loading') : formatFileSize(historySize)}
          />
        </SettingsSection>

        {/* 日志设置部分 */}
        <SettingsSection title={t('settings.logsSection')}>
          <SettingDropdown
            label={t('settings.logLevel')}
            options={[
              { label: t('settings.logLevelDebug'), value: 'debug' as LogLevel },
              { label: t('settings.logLevelInfo'), value: 'info' as LogLevel },
              { label: t('settings.logLevelWarn'), value: 'warn' as LogLevel },
              { label: t('settings.logLevelError'), value: 'error' as LogLevel },
            ]}
            value={config?.logLevel ?? 'info'}
            onChange={handleSetLogLevel}
          />

          <SettingAction
            label={t('settings.exportLogs')}
            buttonText={isExportingLogs ? t('common.cancel') : t('common.export')}
            onPress={handleExportLogs}
            loading={isCalculating}
          />
        </SettingsSection>

        {/* 外观设置部分 */}
        <SettingsSection title={t('settings.appearanceSection')}>
          <SettingDropdown
            label={t('settings.language')}
            options={languageOptions}
            value={currentLanguage}
            onChange={(value) => setLanguage(value)}
          />

          <SettingDropdown
            label={t('settings.theme')}
            options={themeOptions}
            value={themeMode}
            onChange={(value) => setThemeMode(value)}
          />

          {Platform.OS === 'android' && (
            <SettingSwitch
              label={t('settings.hideFromRecents')}
              description={t('settings.hideFromRecentsDesc')}
              value={localHideFromRecents}
              onChange={handleToggleHideFromRecents}
            />
          )}
        </SettingsSection>

        {/* 应用信息部分 */}
        <SettingsSection title={t('settings.aboutSection')}>
          <SettingAction
            label={`${t('settings.version')} ${appVersion}`}
            buttonText={
              isCheckingUpdate
                ? t('settings.checkingUpdate')
                : isDownloading
                  ? t('settings.downloadingUpdate', { percent: Math.round(downloadProgress * 100) })
                  : updateAvailable
                    ? t('settings.updateAvailable', { version: latestVersion })
                    : t('settings.checkUpdate')
            }
            buttonStyle={isDownloading || updateAvailable ? 'primary' : 'secondary'}
            onPress={() => {
              if (isCheckingUpdate) {
                handleCancelUpdateCheck();
              } else if (isDownloading) {
                handleCancelDownload();
              } else if (updateAvailable) {
                handleUpdateButtonPress(
                  latestVersion ?? '',
                  latestAssetsRef.current,
                  releaseNotesRef.current
                );
              } else {
                runUpdateCheck(true, localUpdateToBetaEnabled);
              }
            }}
          />

          <SettingSwitch
            label={t('settings.autoCheckUpdate')}
            value={localAutoCheckUpdateEnabled}
            onChange={handleToggleAutoCheckUpdate}
          />

          <SettingSwitch
            label={t('settings.updateToBeta')}
            value={localUpdateToBetaEnabled}
            onChange={handleToggleUpdateToBeta}
          />

          <SettingDropdown
            label={t('settings.updateChannel')}
            options={[
              { label: 'Gitee', value: 'gitee' as const },
              { label: 'GitHub', value: 'github' as const },
            ]}
            value={localUpdateChannel}
            onChange={(value) => handleToggleUpdateChannel(value)}
          />

          <SettingItem description={t('settings.openSource')}>
            <TouchableOpacity
              onPress={() => Linking.openURL('https://github.com/Jeric-X/syncclipboard-mobile')}
              hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
            >
              <MaterialCommunityIcons name="github" size={24} color={theme.colors.textTertiary} />
            </TouchableOpacity>
          </SettingItem>
        </SettingsSection>

        {/* 调试部分 */}
        <SettingsSection title={t('settings.debugSection')}>
          <SettingSwitch
            label={t('settings.debugMode')}
            value={localDebugModeEnabled}
            onChange={handleToggleDebugMode}
          />

          {localDebugModeEnabled && Platform.OS === 'android' && (
            <SettingSwitch
              label={t('settings.debugOverlay')}
              description={t('settings.debugOverlayDesc')}
              value={localDebugOverlayVisible}
              onChange={handleToggleDebugOverlayVisible}
            />
          )}

          {localDebugModeEnabled && (
            <SettingSwitch
              label={t('settings.debugUrlScheme')}
              value={localDebugUrlScheme}
              onChange={handleToggleDebugUrlScheme}
            />
          )}

          {localDebugModeEnabled && (
            <SettingAction
              label={t('settings.debugSmsTest')}
              buttonText={t('common.test')}
              onPress={() => {
                setSmsTestInput('');
                setShowSmsTestModal(true);
              }}
            />
          )}

          {localDebugModeEnabled && (
            <SettingSwitch
              label={t('settings.debugUpdateCheckNoLimit')}
              description={t('settings.debugUpdateCheckNoLimitDesc')}
              value={localDebugUpdateCheckNoLimit}
              onChange={handleToggleDebugUpdateCheckNoLimit}
            />
          )}

          {localDebugModeEnabled && (
            <SettingAction
              label={t('settings.statistics')}
              buttonText={t('common.view')}
              onPress={handleShowStatistics}
            />
          )}
        </SettingsSection>

        <View style={styles.bottomPadding} />
      </ScrollView>

      {/* 消息提示 */}
      <MessageToast message={message} onMessageShown={handleMessageShown} />

      {/* 服务器配置模态框 */}
      <ServerConfigModal
        visible={showServerModal}
        onClose={() => setShowServerModal(false)}
        onSave={handleSaveServer}
        initialConfig={editingServerIndex !== null ? servers[editingServerIndex] : undefined}
        isEditing={editingServerIndex !== null}
      />

      {/* 测试验证码短信模态框 */}
      <Modal
        visible={showSmsTestModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSmsTestModal(false)}
      >
        <View style={[styles.smsTestModalOverlay, { backgroundColor: theme.colors.overlay }]}>
          <View style={[styles.smsTestModalContent, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.smsTestModalTitle, { color: theme.colors.text }]}>
              {t('settings.smsTestTitle')}
            </Text>
            <TextInput
              style={[
                styles.smsTestModalInput,
                {
                  color: theme.colors.text,
                  borderColor: theme.colors.divider,
                  backgroundColor: theme.colors.background,
                },
              ]}
              placeholder={t('settings.smsTestInputPlaceholder')}
              placeholderTextColor={theme.colors.textTertiary}
              value={smsTestInput}
              onChangeText={setSmsTestInput}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
            <View style={styles.smsTestModalButtons}>
              <TouchableOpacity
                style={[styles.smsTestModalButton, { backgroundColor: theme.colors.divider }]}
                onPress={() => setShowSmsTestModal(false)}
              >
                <Text style={[styles.smsTestModalButtonText, { color: theme.colors.text }]}>
                  {t('common.cancel')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.smsTestModalButton, { backgroundColor: theme.colors.primary }]}
                onPress={handleTestSmsCode}
              >
                <Text style={[styles.smsTestModalButtonText, { color: theme.colors.white }]}>
                  {t('common.test')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 统计信息模态框 */}
      <Modal
        visible={showStatsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowStatsModal(false)}
      >
        <View style={[styles.smsTestModalOverlay, { backgroundColor: theme.colors.overlay }]}>
          <View style={[styles.smsTestModalContent, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.smsTestModalTitle, { color: theme.colors.text }]}>
              {t('settings.statistics')}
            </Text>
            <Text style={[styles.statsText, { color: theme.colors.text }]} selectable>
              {statsText}
            </Text>
            <View style={styles.smsTestModalButtons}>
              <TouchableOpacity
                style={[styles.smsTestModalButton, { backgroundColor: theme.colors.divider }]}
                onPress={() => setShowStatsModal(false)}
              >
                <Text style={[styles.smsTestModalButtonText, { color: theme.colors.text }]}>
                  {t('common.close')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.smsTestModalButton, { backgroundColor: theme.colors.primary }]}
                onPress={handleCopyStatistics}
              >
                <Text style={[styles.smsTestModalButtonText, { color: theme.colors.white }]}>
                  {t('common.copy')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  section: {
    marginTop: 20,
  },
  sectionHeaderBase: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  collapseIcon: {
    marginTop: 1,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyCard: {
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 8,
  },
  emptyHint: {
    fontSize: 14,
    textAlign: 'center',
  },
  bottomPadding: {
    height: 40,
  },
  smsTestModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  smsTestModalContent: {
    width: '100%',
    borderRadius: 12,
    padding: 20,
  },
  smsTestModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  smsTestModalInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 100,
    marginBottom: 16,
  },
  statsText: {
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 16,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  smsTestModalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  smsTestModalButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  smsTestModalButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  autoSwitchControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  autoSwitchCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
});
