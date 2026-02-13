/**
 * 服务器配置模态框
 * 用于添加或编辑服务器配置
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  Switch,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { ServerConfig } from '@/types/api';
import { createAPIClient } from '@/services';

interface ServerConfigModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (config: ServerConfig) => void;
  initialConfig?: ServerConfig;
  isEditing?: boolean;
}

export const ServerConfigModal: React.FC<ServerConfigModalProps> = ({
  visible,
  onClose,
  onSave,
  initialConfig,
  isEditing = false,
}) => {
  const { theme } = useTheme();
  const [isTesting, setIsTesting] = useState(false);

  // 表单状态
  const [type, setType] = useState<'standalone' | 'webdav'>(initialConfig?.type || 'standalone');
  const [url, setUrl] = useState(initialConfig?.url || '');
  const [username, setUsername] = useState(initialConfig?.username || '');
  const [password, setPassword] = useState(initialConfig?.password || '');
  const [autoSync, setAutoSync] = useState(initialConfig?.autoSync ?? true);
  const [syncInterval, setSyncInterval] = useState(initialConfig?.syncInterval?.toString() || '60');
  const [notificationEnabled, setNotificationEnabled] = useState(
    initialConfig?.notificationEnabled ?? true
  );

  // 重置表单
  useEffect(() => {
    if (visible && initialConfig) {
      setType(initialConfig.type);
      setUrl(initialConfig.url);
      setUsername(initialConfig.username || '');
      setPassword(initialConfig.password || '');
      setAutoSync(initialConfig.autoSync ?? true);
      setSyncInterval(initialConfig.syncInterval?.toString() || '60');
      setNotificationEnabled(initialConfig.notificationEnabled ?? true);
    } else if (visible && !initialConfig) {
      // 新建时重置为空
      setType('standalone');
      setUrl('');
      setUsername('');
      setPassword('');
      setAutoSync(true);
      setSyncInterval('60');
      setNotificationEnabled(true);
    }
  }, [visible, initialConfig]);

  // 验证表单
  const validateForm = (): boolean => {
    if (!url.trim()) {
      Alert.alert('错误', '请输入服务器地址');
      return false;
    }

    // 验证 URL 格式
    try {
      new URL(url);
    } catch {
      Alert.alert('错误', '服务器地址格式不正确');
      return false;
    }

    if (!username.trim()) {
      Alert.alert('错误', '请输入用户名');
      return false;
    }

    if (!password.trim()) {
      Alert.alert('错误', '请输入密码');
      return false;
    }

    const intervalNum = parseInt(syncInterval);
    if (isNaN(intervalNum) || intervalNum < 10) {
      Alert.alert('错误', '同步间隔不能小于 10 秒');
      return false;
    }

    return true;
  };

  // 测试连接
  const handleTestConnection = async () => {
    if (!url.trim() || !username.trim() || !password.trim()) {
      Alert.alert('提示', '请先填写服务器地址、用户名和密码');
      return;
    }

    setIsTesting(true);
    try {
      const testConfig: ServerConfig = {
        type,
        url: url.trim(),
        username: username.trim(),
        password: password.trim(),
      };

      const client = createAPIClient(testConfig);
      await client.testConnection();

      Alert.alert('成功', '服务器连接测试成功！');
    } catch (error: any) {
      Alert.alert('连接失败', error.message || '无法连接到服务器');
    } finally {
      setIsTesting(false);
    }
  };

  // 保存配置
  const handleSave = () => {
    if (!validateForm()) {
      return;
    }

    const config: ServerConfig = {
      type,
      url: url.trim(),
      username: username.trim(),
      password: password.trim(),
      autoSync,
      syncInterval: parseInt(syncInterval),
      notificationEnabled,
    };

    onSave(config);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: theme.colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: theme.colors.divider }]}>
          <TouchableOpacity onPress={onClose} style={styles.headerButton}>
            <Text style={[styles.headerButtonText, { color: theme.colors.primary }]}>取消</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
            {isEditing ? '编辑服务器' : '添加服务器'}
          </Text>
          <TouchableOpacity onPress={handleSave} style={styles.headerButton}>
            <Text
              style={[styles.headerButtonText, { color: theme.colors.primary, fontWeight: '600' }]}
            >
              保存
            </Text>
          </TouchableOpacity>
        </View>

        {/* Form */}
        <ScrollView style={styles.scrollView}>
          {/* 服务器类型 */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
              服务器类型
            </Text>
            <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
              <TouchableOpacity
                style={[
                  styles.typeOption,
                  { borderBottomColor: theme.colors.divider },
                  type === 'standalone' && {
                    backgroundColor: theme.colors.primary + '10',
                  },
                ]}
                onPress={() => setType('standalone')}
              >
                <View style={styles.typeContent}>
                  <Text style={[styles.typeLabel, { color: theme.colors.text }]}>
                    SyncClipboard 服务器
                  </Text>
                  <Text style={[styles.typeDescription, { color: theme.colors.textSecondary }]}>
                    官方独立服务器或客户端内置服务器
                  </Text>
                </View>
                {type === 'standalone' && (
                  <View style={[styles.checkmark, { backgroundColor: theme.colors.primary }]}>
                    <Text style={styles.checkmarkIcon}>✓</Text>
                  </View>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.typeOption,
                  type === 'webdav' && { backgroundColor: theme.colors.primary + '10' },
                ]}
                onPress={() => setType('webdav')}
              >
                <View style={styles.typeContent}>
                  <Text style={[styles.typeLabel, { color: theme.colors.text }]}>
                    WebDAV 服务器
                  </Text>
                  <Text style={[styles.typeDescription, { color: theme.colors.textSecondary }]}>
                    支持 WebDAV 协议的云存储服务
                  </Text>
                </View>
                {type === 'webdav' && (
                  <View style={[styles.checkmark, { backgroundColor: theme.colors.primary }]}>
                    <Text style={styles.checkmarkIcon}>✓</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* 服务器信息 */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
              连接信息
            </Text>
            <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: theme.colors.text }]}>服务器地址</Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      color: theme.colors.text,
                      backgroundColor: theme.colors.background,
                      borderColor: theme.colors.divider,
                    },
                  ]}
                  placeholder={
                    type === 'standalone'
                      ? 'http://192.168.1.100:5033'
                      : 'https://dav.jianguoyun.com/dav'
                  }
                  placeholderTextColor={theme.colors.textTertiary}
                  value={url}
                  onChangeText={setUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: theme.colors.text }]}>用户名</Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      color: theme.colors.text,
                      backgroundColor: theme.colors.background,
                      borderColor: theme.colors.divider,
                    },
                  ]}
                  placeholder="输入用户名"
                  placeholderTextColor={theme.colors.textTertiary}
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: theme.colors.text }]}>密码</Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      color: theme.colors.text,
                      backgroundColor: theme.colors.background,
                      borderColor: theme.colors.divider,
                    },
                  ]}
                  placeholder="输入密码"
                  placeholderTextColor={theme.colors.textTertiary}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              {/* 测试连接按钮 */}
              <TouchableOpacity
                style={[
                  styles.testButton,
                  {
                    backgroundColor: theme.colors.primary + '20',
                    borderColor: theme.colors.primary,
                  },
                ]}
                onPress={handleTestConnection}
                disabled={isTesting}
              >
                {isTesting ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : (
                  <Text style={[styles.testButtonText, { color: theme.colors.primary }]}>
                    测试连接
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* 同步设置 */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
              同步设置
            </Text>
            <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
              <View style={[styles.switchRow, { borderBottomColor: theme.colors.divider }]}>
                <View style={styles.switchLabel}>
                  <Text style={[styles.switchLabelText, { color: theme.colors.text }]}>
                    自动同步
                  </Text>
                  <Text style={[styles.switchDescription, { color: theme.colors.textSecondary }]}>
                    在后台自动同步剪贴板内容
                  </Text>
                </View>
                <Switch
                  value={autoSync}
                  onValueChange={setAutoSync}
                  trackColor={{
                    false: theme.colors.divider,
                    true: theme.colors.primary,
                  }}
                  thumbColor={theme.colors.surface}
                />
              </View>

              {autoSync && (
                <View style={styles.inputGroup}>
                  <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                    同步间隔（秒）
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        color: theme.colors.text,
                        backgroundColor: theme.colors.background,
                        borderColor: theme.colors.divider,
                      },
                    ]}
                    placeholder="60"
                    placeholderTextColor={theme.colors.textTertiary}
                    value={syncInterval}
                    onChangeText={setSyncInterval}
                    keyboardType="number-pad"
                  />
                  <Text style={[styles.inputHint, { color: theme.colors.textTertiary }]}>
                    最小 10 秒，建议 60 秒
                  </Text>
                </View>
              )}

              <View style={styles.switchRow}>
                <View style={styles.switchLabel}>
                  <Text style={[styles.switchLabelText, { color: theme.colors.text }]}>
                    同步通知
                  </Text>
                  <Text style={[styles.switchDescription, { color: theme.colors.textSecondary }]}>
                    同步完成后显示通知
                  </Text>
                </View>
                <Switch
                  value={notificationEnabled}
                  onValueChange={setNotificationEnabled}
                  trackColor={{
                    false: theme.colors.divider,
                    true: theme.colors.primary,
                  }}
                  thumbColor={theme.colors.surface}
                />
              </View>
            </View>
          </View>

          <View style={styles.bottomPadding} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    minWidth: 60,
  },
  headerButtonText: {
    fontSize: 17,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  section: {
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  card: {
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 16,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  typeOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  typeContent: {
    flex: 1,
  },
  typeLabel: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  typeDescription: {
    fontSize: 13,
  },
  checkmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  checkmarkIcon: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 8,
  },
  input: {
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  inputHint: {
    fontSize: 12,
    marginTop: 4,
  },
  testButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    marginTop: 8,
  },
  testButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
  },
  switchLabel: {
    flex: 1,
    marginRight: 12,
  },
  switchLabelText: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  switchDescription: {
    fontSize: 13,
  },
  bottomPadding: {
    height: 40,
  },
});
