/**
 * 服务器列表项组件
 * 显示单个服务器配置信息
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from 'react-i18next';
import { ServerConfig } from '@/types/api';

interface ServerListItemProps {
  config: ServerConfig;
  isActive: boolean;
  onPress: () => void;
  onEdit: () => void;
  onDelete: () => void;
  affectedRuleCount?: number;
}

export const ServerListItem: React.FC<ServerListItemProps> = ({
  config,
  isActive,
  onPress,
  onEdit,
  onDelete,
  affectedRuleCount = 0,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation();

  const handleDelete = () => {
    Alert.alert(
      t('server.confirmDeleteTitle'),
      `${t('server.confirmDeleteMessage', { name: getServerDisplayName(config) })}${
        affectedRuleCount > 0
          ? `\n\n${t('networkAutoSwitch.affectedRules', { count: affectedRuleCount })}`
          : ''
      }`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: onDelete },
      ]
    );
  };

  const getServerDisplayName = (config: ServerConfig): string => {
    if (config.name) return config.name;
    try {
      const url = new URL(config.url);
      return url.hostname;
    } catch {
      return config.url;
    }
  };

  const getServerTypeLabel = (type: string): string => {
    switch (type) {
      case 'syncclipboard':
        return 'SyncClipboard';
      case 's3':
        return 'S3';
      default:
        return 'WebDAV';
    }
  };

  const getTypeBadgeColors = (type: string) => {
    if (type === 'syncclipboard') {
      return {
        backgroundColor: '#4CAF50' + '20',
        color: '#4CAF50',
      };
    } else if (type === 's3') {
      return {
        backgroundColor: '#2196F3' + '20',
        color: '#2196F3',
      };
    } else {
      return {
        backgroundColor: '#FF9800' + '20',
        color: '#FF9800',
      };
    }
  };

  return (
    <TouchableOpacity
      style={[
        styles.container,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
        isActive && [styles.containerActive, { borderColor: theme.colors.primary }],
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* 服务器信息 */}
      <View style={styles.content}>
        <View style={styles.mainInfo}>
          <Text style={[styles.serverName, { color: theme.colors.text }]} numberOfLines={1}>
            {getServerDisplayName(config)}
          </Text>
          <View
            style={[
              styles.typeBadge,
              { backgroundColor: getTypeBadgeColors(config.type).backgroundColor },
            ]}
          >
            <Text style={[styles.typeText, { color: getTypeBadgeColors(config.type).color }]}>
              {getServerTypeLabel(config.type)}
            </Text>
          </View>
        </View>

        {config.type === 's3' && config.region ? (
          <Text style={[styles.serverUrl, { color: theme.colors.textSecondary }]} numberOfLines={1}>
            🌍 {config.region}
          </Text>
        ) : (
          <Text style={[styles.serverUrl, { color: theme.colors.textSecondary }]} numberOfLines={1}>
            {config.url}
          </Text>
        )}

        <View style={styles.details}>
          <Text style={[styles.detailText, { color: theme.colors.textSecondary }]}>
            {config.type === 's3'
              ? `🪣 ${config.bucketName || t('server.notSet')}`
              : `👤 ${config.username || t('server.notSet')}`}
          </Text>
        </View>
      </View>

      {/* 操作按钮 */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: theme.colors.primary + '10' }]}
          onPress={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          <Text style={[styles.actionButtonText, { color: theme.colors.primary }]}>
            {t('common.edit')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: theme.colors.error + '10' }]}
          onPress={(e) => {
            e.stopPropagation();
            handleDelete();
          }}
        >
          <Text style={[styles.actionButtonText, { color: theme.colors.error }]}>
            {t('common.delete')}
          </Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
  },
  content: {
    marginBottom: 12,
  },
  mainInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  serverName: {
    fontSize: 17,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  typeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  serverUrl: {
    fontSize: 14,
    marginBottom: 8,
  },
  details: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  detailText: {
    fontSize: 13,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  containerActive: {
    borderWidth: 2,
  },
});
