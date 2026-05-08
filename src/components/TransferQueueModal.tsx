import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { X, Upload, Download, AlertCircle, Clock, CheckCircle } from 'react-native-feather';
import { useTheme } from '@/hooks/useTheme';
import { useTransferQueueStore } from '@/stores/transferQueueStore';
import { TransferTask, getHistoryTransferQueue } from '@/services/history/HistoryTransferQueue';
import { formatFileSize } from '@/utils';

interface TransferQueueModalProps {
  visible: boolean;
  onClose: () => void;
}

const statusLabels: Record<string, string> = {
  pending: '等待中',
  running: '传输中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  waitForRetry: '等待重试',
};

const statusColors: Record<string, string> = {
  pending: '#FFA726',
  running: '#2196F3',
  completed: '#4CAF50',
  failed: '#F44336',
  cancelled: '#9E9E9E',
  waitForRetry: '#FF9800',
};

export const TransferQueueModal: React.FC<TransferQueueModalProps> = ({ visible, onClose }) => {
  const { theme } = useTheme();
  const { tasks, subscribe, pendingCount, activeCount } = useTransferQueueStore();

  useEffect(() => {
    if (visible) {
      return subscribe();
    }
  }, [visible, subscribe]);

  const handleCancelTask = (task: TransferTask) => {
    const queue = getHistoryTransferQueue();
    queue.cancelTask(task.profileId, task.type);
  };

  const renderTask = ({ item: task }: { item: TransferTask }) => {
    const displayText = task.displayName || task.profileId.slice(0, 8);
    const statusColor = statusColors[task.status] || theme.colors.textSecondary;

    return (
      <View
        style={[
          styles.taskItem,
          { backgroundColor: theme.colors.background, borderColor: theme.colors.divider },
        ]}
      >
        <View style={styles.taskHeader}>
          <View style={[styles.taskTypeIcon, { backgroundColor: theme.colors.primaryLight }]}>
            {task.type === 'upload' ? (
              <Upload width={16} height={16} color={theme.colors.primary} />
            ) : (
              <Download width={16} height={16} color={theme.colors.success || '#4CAF50'} />
            )}
          </View>
          <View style={styles.taskInfo}>
            <Text style={[styles.taskText, { color: theme.colors.text }]} numberOfLines={1}>
              {displayText}
            </Text>
            <View style={styles.taskStatusRow}>
              <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
                {task.status === 'running' && (
                  <ActivityIndicator size="small" color={statusColor} />
                )}
                {task.status === 'failed' && (
                  <AlertCircle width={12} height={12} color={statusColor} />
                )}
                {task.status === 'completed' && (
                  <CheckCircle width={12} height={12} color={statusColor} />
                )}
                {(task.status === 'pending' || task.status === 'waitForRetry') && (
                  <Clock width={12} height={12} color={statusColor} />
                )}
                <Text style={[styles.statusText, { color: statusColor }]}>
                  {statusLabels[task.status]}
                </Text>
              </View>
              {task.status === 'running' && task.progress >= 0 && (
                <Text style={[styles.progressText, { color: theme.colors.textSecondary }]}>
                  {Math.round(task.progress)}%
                  {task.totalBytes
                    ? ` (${formatFileSize(task.bytesTransferred)}/${formatFileSize(
                        task.totalBytes
                      )})`
                    : ''}
                </Text>
              )}
              {task.status === 'running' && task.progress < 0 && (
                <Text style={[styles.progressText, { color: theme.colors.textSecondary }]}>
                  {formatFileSize(task.bytesTransferred)}
                </Text>
              )}
            </View>
          </View>
          {(task.status === 'pending' ||
            task.status === 'running' ||
            task.status === 'waitForRetry') && (
            <TouchableOpacity
              style={[styles.cancelButton, { borderColor: theme.colors.error || '#F44336' }]}
              onPress={() => handleCancelTask(task)}
            >
              <X width={14} height={14} color={theme.colors.error || '#F44336'} />
            </TouchableOpacity>
          )}
        </View>
        {task.status === 'running' && task.progress >= 0 && (
          <View style={[styles.progressBar, { backgroundColor: theme.colors.border }]}>
            <View
              style={[
                styles.progressFill,
                { backgroundColor: theme.colors.primary, width: `${task.progress}%` },
              ]}
            />
          </View>
        )}
        {task.status === 'running' && task.progress < 0 && (
          <View style={[styles.progressBar, { backgroundColor: theme.colors.border }]}>
            <View
              style={[styles.progressFillIndeterminate, { backgroundColor: theme.colors.primary }]}
            />
          </View>
        )}
        {task.errorMessage && (
          <Text style={[styles.errorText, { color: theme.colors.error || '#F44336' }]}>
            {task.errorMessage}
          </Text>
        )}
      </View>
    );
  };

  const sortedTasks = [...tasks].sort((a, b) => {
    const statusOrder: Record<string, number> = {
      running: 0,
      pending: 1,
      waitForRetry: 2,
      failed: 3,
      completed: 4,
      cancelled: 5,
    };
    return (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
  });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={[styles.overlay, { backgroundColor: theme.colors.backdrop }]}
        onPress={onClose}
      >
        <Pressable
          style={[styles.modalContainer, { backgroundColor: theme.colors.surface }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
            <Text style={[styles.title, { color: theme.colors.text }]}>传输队列</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <X width={24} height={24} color={theme.colors.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={[styles.statNumber, { color: theme.colors.primary }]}>
                {activeCount}
              </Text>
              <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>传输中</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statNumber, { color: theme.colors.text }]}>{pendingCount}</Text>
              <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>等待中</Text>
            </View>
          </View>

          {tasks.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                暂无传输任务
              </Text>
            </View>
          ) : (
            <FlatList
              data={sortedTasks}
              renderItem={renderTask}
              keyExtractor={(item) => `${item.type}-${item.profileId}`}
              contentContainerStyle={styles.listContent}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContainer: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
    minHeight: '40%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  closeButton: {
    padding: 4,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 40,
  },
  statItem: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 24,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 12,
    marginTop: 4,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  taskItem: {
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
  },
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  taskTypeIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  taskInfo: {
    flex: 1,
  },
  taskText: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  taskStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '500',
  },
  progressText: {
    fontSize: 11,
  },
  cancelButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressBar: {
    height: 3,
    borderRadius: 2,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  progressFillIndeterminate: {
    height: '100%',
    borderRadius: 2,
    width: '30%',
  },
  errorText: {
    fontSize: 11,
    marginTop: 8,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 14,
  },
});
