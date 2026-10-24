import {
  SettingAction,
  SettingDropdown,
  SettingsSection,
  SettingSwitch,
} from '@/components/settings';
import { useStatisticsRecords } from '@/hooks/useStatisticsRecords';
import { useSyncedState } from '@/hooks/useSyncedState';
import { useTheme } from '@/hooks/useTheme';
import { configService } from '@/services/ConfigService';
import { formatLifetimeRecord } from '@/services/statistics/statisticsFormatting';
import { useSettingsStore } from '@/stores';
import { MAX_STATISTICS_RECORDS, useStatisticsStore } from '@/stores/statisticsStore';
import { extractVerificationCode } from '@/tasks/SmsUploadTask';
import { saveLogsToFile, setLogLevel as setLoggerLogLevel, type LogLevel } from '@/utils';
import * as Clipboard from 'expo-clipboard';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { SettingsModuleProps } from './types';

/** 日志导出、调试开关和诊断弹窗。 */
export const LogsAndDebugSettings = ({ showMessage }: SettingsModuleProps) => {
  const { theme } = useTheme();

  const { t, i18n } = useTranslation();

  const statisticsFormatting = { t, locale: i18n.resolvedLanguage || i18n.language };

  const { config, updateModule, setLogLevel } = useSettingsStore();

  const [localDebugModeEnabled, setLocalDebugModeEnabled] = useState(config?.debugMode ?? false);

  const [localDebugOverlayVisible, setLocalDebugOverlayVisible] = useState(
    config?.debugOverlayVisible ?? false
  );

  const [localDebugUrlScheme, setLocalDebugUrlScheme] = useState(config?.debugUrlScheme ?? false);

  const [localDebugColdStartToast, setLocalDebugColdStartToast] = useSyncedState(
    config?.debugColdStartToast ?? false
  );

  const [localDebugUpdateCheckNoLimit, setLocalDebugUpdateCheckNoLimit] = useState(
    config?.debugUpdateCheckNoLimit ?? false
  );

  const [showSmsTestModal, setShowSmsTestModal] = useState(false);

  const [smsTestInput, setSmsTestInput] = useState('');

  const [showStatsModal, setShowStatsModal] = useState(false);

  const statisticsRecords = useStatisticsRecords(showStatsModal);

  // 当配置中的debugMode值变化时，更新本地状态
  useEffect(() => {
    setLocalDebugModeEnabled(config?.debugMode ?? false);
  }, [config?.debugMode]);

  const [isExportingLogs, setIsExportingLogs] = useState<boolean>(false);

  const exportLogsAbortControllerRef = useRef<AbortController | null>(null);

  // 处理切换调试模式
  const handleToggleDebugMode = async (enabled: boolean) => {
    // 立即更新本地状态，避免闪烁
    setLocalDebugModeEnabled(enabled);

    try {
      await updateModule('debug', { debugMode: enabled });
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
      await updateModule('debug', { debugOverlayVisible: enabled });
    } catch (error: unknown) {
      setLocalDebugOverlayVisible(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理切换显示 URL Scheme 调用
  const handleToggleDebugUrlScheme = async (enabled: boolean) => {
    setLocalDebugUrlScheme(enabled);
    try {
      await updateModule('debug', { debugUrlScheme: enabled });
    } catch (error: unknown) {
      setLocalDebugUrlScheme(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理切换冷启动提示，下次冷启动生效
  const handleToggleDebugColdStartToast = async (enabled: boolean) => {
    setLocalDebugColdStartToast(enabled);
    try {
      // 通用 store 更新会吞掉保存异常；直接保存，成功后由订阅更新 store。
      await configService.updateModule('debug', { debugColdStartToast: enabled });
    } catch (error: unknown) {
      setLocalDebugColdStartToast(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理切换启动时检查更新不限次数
  const handleToggleDebugUpdateCheckNoLimit = async (enabled: boolean) => {
    setLocalDebugUpdateCheckNoLimit(enabled);
    try {
      await updateModule('debug', { debugUpdateCheckNoLimit: enabled });
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

  // 查看仅加载记录，写入统一由调试模式控制的心跳负责。
  const handleShowStatistics = async () => {
    try {
      await useStatisticsStore.getState().load();
      setShowStatsModal(true);
    } catch (error) {
      showMessage(error instanceof Error ? error.message : t('common.operationFailed'), 'error');
    }
  };

  const handleClearStatistics = async () => {
    try {
      await useStatisticsStore.getState().clear();
      showMessage(t('settings.statisticsCleared'), 'success');
    } catch (error) {
      showMessage(error instanceof Error ? error.message : t('common.operationFailed'), 'error');
    }
  };

  // 复制所有记录，列表本身按需渲染，避免一次渲染一万条文本。
  const handleCopyStatistics = async () => {
    try {
      await Clipboard.setStringAsync(
        useStatisticsStore.getState().getStatisticsText(statisticsFormatting)
      );
      setShowStatsModal(false);
      showMessage(t('settings.statisticsCopied'), 'success');
    } catch (error) {
      showMessage(error instanceof Error ? error.message : t('common.operationFailed'), 'error');
    }
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
  return (
    <>
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
        />
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

        {localDebugModeEnabled && Platform.OS === 'android' && (
          <SettingSwitch
            label={t('settings.debugColdStartToast')}
            description={t('settings.debugColdStartToastDesc')}
            value={localDebugColdStartToast}
            onChange={handleToggleDebugColdStartToast}
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
      <Modal
        visible={showStatsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowStatsModal(false)}
      >
        <View style={[styles.smsTestModalOverlay, { backgroundColor: theme.colors.overlay }]}>
          <View
            style={[
              styles.smsTestModalContent,
              styles.statisticsModalContent,
              { backgroundColor: theme.colors.surface },
            ]}
          >
            <Text style={[styles.smsTestModalTitle, { color: theme.colors.text }]}>
              {t('settings.statistics')}
            </Text>
            <Text style={[styles.statisticsHint, { color: theme.colors.textSecondary }]}>
              {t('settings.statisticsDescription')}
            </Text>
            <Text style={[styles.statisticsHint, { color: theme.colors.textSecondary }]}>
              {t('settings.statisticsCount', {
                count: statisticsRecords.length,
                max: MAX_STATISTICS_RECORDS,
              })}
            </Text>
            <FlatList
              data={statisticsRecords}
              keyExtractor={(record, index) => `${record.startedAt}-${index}`}
              renderItem={({ item, index }) => (
                <Text style={[styles.statsText, { color: theme.colors.text }]} selectable>
                  {formatLifetimeRecord(item, index, statisticsFormatting)}
                </Text>
              )}
              ListEmptyComponent={
                <Text style={[styles.statsText, { color: theme.colors.textSecondary }]}>
                  {t('settings.statisticsEmpty')}
                </Text>
              }
            />
            <View style={[styles.smsTestModalButtons, styles.statisticsButtons]}>
              <TouchableOpacity
                style={[styles.smsTestModalButton, { backgroundColor: theme.colors.divider }]}
                onPress={handleClearStatistics}
              >
                <Text style={[styles.smsTestModalButtonText, { color: theme.colors.text }]}>
                  {t('settings.statisticsClear')}
                </Text>
              </TouchableOpacity>
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
    </>
  );
};

const styles = StyleSheet.create({
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
  statisticsModalContent: {
    maxHeight: '85%',
  },
  statisticsHint: {
    fontSize: 12,
    marginBottom: 12,
  },
  statisticsButtons: {
    flexWrap: 'wrap',
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
});
