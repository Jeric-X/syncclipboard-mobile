import { SettingAction, SettingItem, SettingsSection } from '@/components/settings';
import { useTheme } from '@/hooks/useTheme';
import { calculateLogSize, clearLogs, formatFileSize } from '@/utils';
import { calculateDirectorySize, clearDirectory, CLIPBOARD_TEMP_DIR } from '@/utils/fileStorage';
import { Directory, Paths } from 'expo-file-system';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, TouchableOpacity } from 'react-native';
import { RefreshCw } from 'react-native-feather';
import type { SettingsModuleProps } from './types';

/** 缓存、日志和历史记录空间统计及清理操作。 */
export const StorageSettings = ({ showMessage }: SettingsModuleProps) => {
  const { theme } = useTheme();

  const { t } = useTranslation();

  // 计算存储大小
  useEffect(() => {
    void calculateStorageSizes();
  }, []);

  // 存储大小状态
  const [cacheSize, setCacheSize] = useState<number>(0);

  const [historySize, setHistorySize] = useState<number>(0);

  const [logSize, setLogSize] = useState<number>(0);

  const [isCalculating, setIsCalculating] = useState<boolean>(true);

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
  return (
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
  );
};

const styles = StyleSheet.create({
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
