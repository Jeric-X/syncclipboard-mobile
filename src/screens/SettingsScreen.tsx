/**
 * 设置页面
 * 提供主题切换功能、服务器配置、多用户切换
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  TextInput,
  Alert,
} from 'react-native';
import { Paths, Directory } from 'expo-file-system';
import { calculateDirectorySize, clearDirectory } from '@/utils/fileStorage';
import { CLIPBOARD_TEMP_DIR } from '@/utils/fileStorage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import type { ThemeMode } from '@/theme';
import { useSettingsStore } from '@/stores';
import { ServerConfigModal, ServerListItem, MessageToast } from '@/components';
import { ServerConfig } from '@/types/api';
import { useMessageToast } from '@/hooks/useMessageToast';
import { ShortcutService } from '@/services';

export const SettingsScreen = () => {
  const { theme, themeMode, setThemeMode } = useTheme();
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
  } = useSettingsStore();

  const [showServerModal, setShowServerModal] = useState(false);
  const [editingServerIndex, setEditingServerIndex] = useState<number | null>(null);
  const { message, showMessage, handleMessageShown } = useMessageToast();

  // 本地状态用于跟踪Switch的当前值，避免闪烁
  const [localAutoSyncEnabled, setLocalAutoSyncEnabled] = useState(config?.autoSync ?? false);
  const [localDebugModeEnabled, setLocalDebugModeEnabled] = useState(config?.debugMode ?? false);

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

  // 计算存储大小
  useEffect(() => {
    calculateStorageSizes();
  }, []);

  const themeOptions: { label: string; value: ThemeMode }[] = [
    { label: '跟随系统', value: 'auto' },
    { label: '浅色模式', value: 'light' },
    { label: '深色模式', value: 'dark' },
  ];

  // 获取服务器列表
  const servers = config?.servers || [];
  const activeServerIndex = config?.activeServerIndex ?? -1;
  const autoDownloadMaxSizeMB = Math.round(
    (config?.autoDownloadMaxSize ?? 5 * 1024 * 1024) / (1024 * 1024)
  );

  // 本地 state 用于输入框
  const [maxSizeInput, setMaxSizeInput] = useState(autoDownloadMaxSizeMB.toString());
  const [maxHistoryItemsInput, setMaxHistoryItemsInput] = useState(
    (config?.maxHistoryItems ?? 1000).toString()
  );

  // 存储大小状态
  const [cacheSize, setCacheSize] = useState<number>(0);
  const [historySize, setHistorySize] = useState<number>(0);
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
        showMessage('服务器配置已更新', 'success');
      } else {
        await addServer(serverConfig);
        showMessage('服务器已添加', 'success');
      }
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '操作失败', 'error');
    }
  };

  // 处理删除服务器
  const handleDeleteServer = async (index: number) => {
    try {
      await deleteServer(index);
      showMessage('服务器已删除', 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '删除失败', 'error');
    }
  };

  // 处理切换激活服务器
  const handleSetActiveServer = async (index: number) => {
    if (index === activeServerIndex) {
      return; // 已经是激活状态
    }

    try {
      await setActiveServer(index);
      showMessage('已切换服务器', 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '切换失败', 'error');
    }
  };

  // 处理切换自动复制
  const handleToggleAutoSync = async (enabled: boolean) => {
    // 立即更新本地状态，避免闪烁
    setLocalAutoSyncEnabled(enabled);

    try {
      await setAutoSync(enabled);
      showMessage(enabled ? '已启用自动复制' : '已禁用自动复制', 'success');
    } catch (error: unknown) {
      // 如果设置失败，恢复原来的状态
      setLocalAutoSyncEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  // 处理最大文件大小输入
  const handleMaxSizeBlur = async () => {
    try {
      const sizeMB = parseInt(maxSizeInput, 10);
      if (isNaN(sizeMB) || sizeMB < 0) {
        setMaxSizeInput(autoDownloadMaxSizeMB.toString());
        showMessage('请输入有效的数字', 'error');
        return;
      }
      const sizeInBytes = sizeMB * 1024 * 1024;
      await setAutoDownloadMaxSize(sizeInBytes);
      showMessage(`已设置最大文件大小为 ${sizeMB}MB`, 'success');
    } catch (error: unknown) {
      setMaxSizeInput(autoDownloadMaxSizeMB.toString());
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  // 处理历史记录最大保留条数输入
  const handleMaxHistoryItemsBlur = async () => {
    try {
      const maxItems = parseInt(maxHistoryItemsInput, 10);
      if (isNaN(maxItems) || maxItems < 10) {
        setMaxHistoryItemsInput((config?.maxHistoryItems ?? 1000).toString());
        showMessage('请输入大于等于10的数字', 'error');
        return;
      }
      await updateConfig({ maxHistoryItems: maxItems });
      showMessage(`已设置历史记录最大保留条数为 ${maxItems}条`, 'success');

      // 更新历史记录存储的最大大小
      const { historyStorage } = await import('@/services');
      historyStorage.setMaxHistorySize(maxItems);
    } catch (error: unknown) {
      setMaxHistoryItemsInput((config?.maxHistoryItems ?? 1000).toString());
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  // 处理切换调试模式
  const handleToggleDebugMode = async (enabled: boolean) => {
    // 立即更新本地状态，避免闪烁
    setLocalDebugModeEnabled(enabled);

    try {
      await updateConfig({ debugMode: enabled });
      showMessage(enabled ? '已启用调试模式' : '已禁用调试模式', 'success');
    } catch (error: unknown) {
      // 如果设置失败，恢复原来的状态
      setLocalDebugModeEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  // 计算存储大小
  const calculateStorageSizes = async () => {
    setIsCalculating(true);
    try {
      // 使用setTimeout模拟异步操作，避免UI阻塞
      await new Promise((resolve) => setTimeout(resolve, 100));
      const cacheSizeValue = calculateDirectorySize(cacheDir);
      const historySizeValue = calculateDirectorySize(historyDir);
      setCacheSize(cacheSizeValue);
      setHistorySize(historySizeValue);
    } catch (error) {
      console.error('Failed to calculate storage sizes:', error);
    } finally {
      setIsCalculating(false);
    }
  };

  // 清除缓存
  const handleClearCache = () => {
    Alert.alert(
      '清空缓存',
      '确定要清空缓存目录吗？这将删除所有缓存文件。',
      [
        {
          text: '取消',
          style: 'cancel',
        },
        {
          text: '确定',
          onPress: async () => {
            try {
              clearDirectory(cacheDir);
              await calculateStorageSizes();
              showMessage('缓存已清空', 'success');
            } catch {
              showMessage('清空缓存失败', 'error');
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  // 处理添加下载快捷方式
  const handleAddDownloadShortcut = async () => {
    try {
      await ShortcutService.addDownloadShortcut();
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '添加失败', 'error');
    }
  };

  // 处理添加上传快捷方式
  const handleAddUploadShortcut = async () => {
    try {
      await ShortcutService.addUploadShortcut();
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '添加失败', 'error');
    }
  };

  // 格式化文件大小
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      edges={['bottom']}
    >
      <ScrollView style={styles.scrollView}>
        {/* 服务器配置部分 */}
        <View style={styles.section}>
          <View style={[styles.sectionHeaderBase, styles.sectionHeaderRow]}>
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>服务器配置</Text>
            <TouchableOpacity
              style={[styles.addButton, { backgroundColor: theme.colors.primary }]}
              onPress={handleAddServer}
            >
              <Text style={[styles.addButtonText, { color: theme.colors.white }]}>＋ 添加</Text>
            </TouchableOpacity>
          </View>

          {servers.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: theme.colors.surface }]}>
              <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                还没有配置服务器
              </Text>
              <Text style={[styles.emptyHint, { color: theme.colors.textTertiary }]}>
                点击右上角"添加"按钮添加第一个服务器
              </Text>
            </View>
          ) : (
            servers.map((server, index) => (
              <ServerListItem
                key={index}
                config={server}
                isActive={index === activeServerIndex}
                onPress={() => handleSetActiveServer(index)}
                onEdit={() => handleEditServer(index)}
                onDelete={() => handleDeleteServer(index)}
              />
            ))
          )}
        </View>

        {/* 同步设置部分 */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderBase}>
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>同步设置</Text>
          </View>

          <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
            <View style={[styles.settingRow, { borderBottomColor: theme.colors.divider }]}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: theme.colors.text }]}>自动复制</Text>
                <Text style={[styles.settingDescription, { color: theme.colors.textTertiary }]}>
                  仅在切换到前台时生效
                </Text>
              </View>
              <Switch
                value={localAutoSyncEnabled}
                onValueChange={handleToggleAutoSync}
                trackColor={{ false: theme.colors.divider, true: theme.colors.primary }}
                thumbColor={localAutoSyncEnabled ? theme.colors.surface : theme.colors.textTertiary}
              />
            </View>

            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                  允许自动同步的数据大小
                </Text>
                <Text style={[styles.settingDescription, { color: theme.colors.textTertiary }]}>
                  小于此大小的文件将自动下载
                </Text>
              </View>
              <View style={styles.inputContainer}>
                <TextInput
                  style={[
                    styles.sizeInput,
                    {
                      color: theme.colors.text,
                      borderColor: theme.colors.divider,
                      backgroundColor: theme.colors.background,
                    },
                  ]}
                  value={maxSizeInput}
                  onChangeText={setMaxSizeInput}
                  onBlur={handleMaxSizeBlur}
                  keyboardType="number-pad"
                  placeholder="5"
                  placeholderTextColor={theme.colors.textTertiary}
                />
                <Text style={[styles.unitLabel, { color: theme.colors.textSecondary }]}>MB</Text>
              </View>
            </View>
          </View>
        </View>

        {/* 快捷操作部分 */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderBase}>
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>快捷操作</Text>
          </View>

          <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
            <View style={[styles.settingRow, { borderBottomColor: theme.colors.divider }]}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                  添加桌面快捷方式：下载
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: theme.colors.primary }]}
                onPress={handleAddDownloadShortcut}
              >
                <Text style={[styles.actionButtonText, { color: theme.colors.white }]}>添加</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                  添加桌面快捷方式：上传
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: theme.colors.primary }]}
                onPress={handleAddUploadShortcut}
              >
                <Text style={[styles.actionButtonText, { color: theme.colors.white }]}>添加</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* 存储部分 */}
        <View style={styles.section}>
          <View style={[styles.sectionHeaderBase, styles.sectionHeaderRow]}>
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>存储</Text>
            <TouchableOpacity
              style={[styles.refreshButton, { backgroundColor: theme.colors.primary }]}
              onPress={calculateStorageSizes}
              disabled={isCalculating}
            >
              <Text style={[styles.refreshButtonText, { color: theme.colors.white }]}>
                {isCalculating ? '计算中...' : '重新计算'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
            <View style={[styles.settingRow, { borderBottomColor: theme.colors.divider }]}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                  缓存空间占用
                </Text>
                <Text style={[styles.settingDescription, { color: theme.colors.textTertiary }]}>
                  {isCalculating ? '加载中...' : formatFileSize(cacheSize)}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.clearButton, { backgroundColor: theme.colors.primary }]}
                onPress={handleClearCache}
                disabled={isCalculating}
              >
                <Text style={[styles.clearButtonText, { color: theme.colors.white }]}>清理</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.settingRow, { borderBottomColor: theme.colors.divider }]}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                  历史记录空间占用
                </Text>
                <Text style={[styles.settingDescription, { color: theme.colors.textTertiary }]}>
                  {isCalculating ? '加载中...' : formatFileSize(historySize)}
                </Text>
              </View>
            </View>

            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                  历史记录最大保留条数
                </Text>
                <Text style={[styles.settingDescription, { color: theme.colors.textTertiary }]}>
                  最小值为10条
                </Text>
              </View>
              <View style={styles.inputContainer}>
                <TextInput
                  style={[
                    styles.sizeInput,
                    {
                      color: theme.colors.text,
                      borderColor: theme.colors.divider,
                      backgroundColor: theme.colors.background,
                    },
                  ]}
                  value={maxHistoryItemsInput}
                  onChangeText={setMaxHistoryItemsInput}
                  onBlur={handleMaxHistoryItemsBlur}
                  keyboardType="number-pad"
                  placeholder="100"
                  placeholderTextColor={theme.colors.textTertiary}
                />
                <Text style={[styles.unitLabel, { color: theme.colors.textSecondary }]}>条</Text>
              </View>
            </View>
          </View>
        </View>

        {/* 主题设置部分 */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderBase}>
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>外观</Text>
          </View>

          <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.cardTitle, { color: theme.colors.text }]}>主题模式</Text>

            {themeOptions.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[styles.optionItem, { borderBottomColor: theme.colors.divider }]}
                onPress={() => setThemeMode(option.value)}
              >
                <Text style={[styles.optionLabel, { color: theme.colors.text }]}>
                  {option.label}
                </Text>
                {themeMode === option.value && (
                  <View style={[styles.checkmark, { backgroundColor: theme.colors.primary }]}>
                    <Text style={[styles.checkmarkIcon, { color: theme.colors.surface }]}>✓</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 应用信息部分 */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderBase}>
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>关于</Text>
          </View>

          <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
            <View style={[styles.infoRow, { borderBottomColor: theme.colors.divider }]}>
              <Text style={[styles.infoLabel, { color: theme.colors.textSecondary }]}>版本</Text>
              <Text style={[styles.infoValue, { color: theme.colors.text }]}>1.0.0 (Beta)</Text>
            </View>

            <View style={[styles.infoRow, { borderBottomColor: theme.colors.divider }]}>
              <Text style={[styles.infoLabel, { color: theme.colors.textSecondary }]}>
                当前主题
              </Text>
              <Text style={[styles.infoValue, { color: theme.colors.text }]}>
                {theme.isDark ? '深色' : '浅色'}
              </Text>
            </View>

            <View style={[styles.infoRow, { borderBottomColor: theme.colors.divider }]}>
              <Text style={[styles.infoLabel, { color: theme.colors.textSecondary }]}>
                服务器数量
              </Text>
              <Text style={[styles.infoValue, { color: theme.colors.text }]}>
                {servers.length} 个
              </Text>
            </View>

            <View style={[styles.settingRow, styles.settingRowNoBorder]}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: theme.colors.text }]}>调试模式</Text>
              </View>
              <Switch
                value={localDebugModeEnabled}
                onValueChange={handleToggleDebugMode}
                trackColor={{ false: theme.colors.divider, true: theme.colors.primary }}
                thumbColor={
                  localDebugModeEnabled ? theme.colors.surface : theme.colors.textTertiary
                }
              />
            </View>
          </View>
        </View>

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
  addButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  emptyCard: {
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
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
  card: {
    marginHorizontal: 16,
    borderRadius: 12,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  optionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionLabel: {
    fontSize: 16,
  },
  checkmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmarkIcon: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  infoLabel: {
    fontSize: 16,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '500',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sizeInput: {
    width: 80,
    height: 40,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    textAlign: 'right',
  },
  unitLabel: {
    fontSize: 16,
    marginLeft: 8,
    fontWeight: '500',
  },
  bottomPadding: {
    height: 40,
  },
  settingRowNoBorder: {
    borderBottomWidth: 0,
  },
  clearButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  clearButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  refreshButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  refreshButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  actionButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
