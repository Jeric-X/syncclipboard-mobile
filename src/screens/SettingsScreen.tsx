/**
 * 设置页面
 * 提供主题切换功能、服务器配置、多用户切换
 */

import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import type { ThemeMode } from '@/theme';
import { useSettingsStore } from '@/stores';
import { ServerConfigModal, ServerListItem } from '@/components';
import { ServerConfig } from '@/types/api';

type MessageType = 'success' | 'error' | 'info';

export const SettingsScreen = () => {
  const { theme, themeMode, setThemeMode } = useTheme();
  const { config, isLoaded, loadConfig, addServer, updateServer, deleteServer, setActiveServer } =
    useSettingsStore();

  const [showServerModal, setShowServerModal] = useState(false);
  const [editingServerIndex, setEditingServerIndex] = useState<number | null>(null);
  const [message, setMessage] = useState<{ text: string; type: MessageType } | null>(null);
  const [fadeAnim] = useState(new Animated.Value(0));
  const messageTimer = useRef<NodeJS.Timeout | null>(null);

  // 加载配置
  useEffect(() => {
    if (!isLoaded) {
      loadConfig();
    }
  }, [isLoaded, loadConfig]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (messageTimer.current) {
        clearTimeout(messageTimer.current);
      }
    };
  }, []);

  // 显示消息提示
  const showMessage = (text: string, type: MessageType = 'info') => {
    // 清除之前的定时器
    if (messageTimer.current) {
      clearTimeout(messageTimer.current);
    }

    setMessage({ text, type });

    // 淡入动画
    Animated.sequence([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.delay(2500),
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setMessage(null);
    });
  };

  const themeOptions: { label: string; value: ThemeMode }[] = [
    { label: '跟随系统', value: 'auto' },
    { label: '浅色模式', value: 'light' },
    { label: '深色模式', value: 'dark' },
  ];

  // 获取服务器列表
  const servers = config?.servers || [];
  const activeServerIndex = config?.activeServerIndex ?? -1;

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
    } catch (error: any) {
      showMessage(error.message || '操作失败', 'error');
    }
  };

  // 处理删除服务器
  const handleDeleteServer = async (index: number) => {
    try {
      await deleteServer(index);
      showMessage('服务器已删除', 'success');
    } catch (error: any) {
      showMessage(error.message || '删除失败', 'error');
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
    } catch (error: any) {
      showMessage(error.message || '切换失败', 'error');
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView style={styles.scrollView}>
        {/* 服务器配置部分 */}
        <View style={styles.section}>
          <View style={[styles.sectionHeaderBase, styles.sectionHeaderRow]}>
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>服务器配置</Text>
            <TouchableOpacity
              style={[styles.addButton, { backgroundColor: theme.colors.primary }]}
              onPress={handleAddServer}
            >
              <Text style={styles.addButtonText}>+ 添加</Text>
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

            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: theme.colors.textSecondary }]}>
                服务器数量
              </Text>
              <Text style={[styles.infoValue, { color: theme.colors.text }]}>
                {servers.length} 个
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.bottomPadding} />
      </ScrollView>

      {/* 消息提示 */}
      {message && (
        <Animated.View
          style={[
            styles.messageContainer,
            {
              backgroundColor:
                message.type === 'success'
                  ? '#4CAF50'
                  : message.type === 'error'
                    ? '#F44336'
                    : theme.colors.primary,
              opacity: fadeAnim,
            },
          ]}
        >
          <Text style={styles.messageText}>{message.text}</Text>
        </Animated.View>
      )}

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
  messageContainer: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    right: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  messageText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '500',
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
    color: '#fff',
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
  bottomPadding: {
    height: 40,
  },
});
