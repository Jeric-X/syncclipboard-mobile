/**
 * Quick Actions Bar Component
 * 快速操作栏 - 底部悬浮操作按钮
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useTheme } from '@/hooks/useTheme';

interface QuickActionsBarProps {
  onUpload: () => void;
  onDownload: () => void;
  onSync: () => void;
  disabled?: boolean;
  syncInProgress?: boolean;
}

export const QuickActionsBar: React.FC<QuickActionsBarProps> = ({
  onUpload,
  onDownload,
  onSync,
  disabled = false,
  syncInProgress = false,
}) => {
  const { theme } = useTheme();

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.divider },
      ]}
    >
      {/* 上传按钮 */}
      <TouchableOpacity
        style={[
          styles.button,
          disabled && styles.buttonDisabled,
          { backgroundColor: theme.colors.background },
        ]}
        onPress={onUpload}
        disabled={disabled || syncInProgress}
        activeOpacity={0.7}
      >
        <Text style={styles.buttonIcon}>⬆️</Text>
        <Text
          style={[
            styles.buttonText,
            { color: disabled ? theme.colors.textTertiary : theme.colors.text },
          ]}
        >
          上传
        </Text>
      </TouchableOpacity>

      {/* 同步按钮 (主操作) */}
      <TouchableOpacity
        style={[
          styles.syncButton,
          disabled && styles.buttonDisabled,
          { backgroundColor: disabled ? theme.colors.divider : theme.colors.primary },
        ]}
        onPress={onSync}
        disabled={disabled || syncInProgress}
        activeOpacity={0.7}
      >
        {syncInProgress ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.syncButtonIcon}>🔄</Text>
        )}
        <Text style={styles.syncButtonText}>{syncInProgress ? '同步中...' : '同步'}</Text>
      </TouchableOpacity>

      {/* 下载按钮 */}
      <TouchableOpacity
        style={[
          styles.button,
          disabled && styles.buttonDisabled,
          { backgroundColor: theme.colors.background },
        ]}
        onPress={onDownload}
        disabled={disabled || syncInProgress}
        activeOpacity={0.7}
      >
        <Text style={styles.buttonIcon}>⬇️</Text>
        <Text
          style={[
            styles.buttonText,
            { color: disabled ? theme.colors.textTertiary : theme.colors.text },
          ]}
        >
          下载
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 8,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    marginHorizontal: 4,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonIcon: {
    fontSize: 20,
    marginRight: 6,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  syncButton: {
    flex: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    marginHorizontal: 8,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 4,
  },
  syncButtonIcon: {
    fontSize: 22,
    marginRight: 8,
  },
  syncButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
