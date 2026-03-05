# SyncManager 使用文档

## 概述

`SyncManager` 是 SyncClipboard Mobile 的核心同步管理器，负责在本地剪贴板和远程服务器之间同步内容。

## 功能特性

- ✅ **双向同步**: 支持上传、下载和双向同步
- ✅ **多种同步模式**: 手动、自动、实时同步
- ✅ **冲突解决**: 支持多种冲突解决策略
- ✅ **离线队列**: 网络异常时将任务加入队列，恢复后自动重试
- ✅ **智能跳过**: 内容未变化时自动跳过同步
- ✅ **大文件处理**: 支持配置大文件阈值和是否同步
- ✅ **事件监听**: 实时获取同步状态和进度
- ✅ **统计信息**: 记录同步次数、成功率、平均耗时等

## 基础用法

### 1. 初始化

```typescript
import { SyncManager } from '@/services';
import { SyncMode, ConflictResolution } from '@/types';

const syncManager = SyncManager.getInstance();

await syncManager.initialize({
  server: {
    url: 'https://your-server.com',
    type: 'standalone',
    auth: {
      username: 'user',
      password: 'pass',
    },
  },
  mode: SyncMode.Manual,
  conflictResolution: ConflictResolution.UseNewest,
  enableOfflineQueue: true,
  maxOfflineQueueSize: 100,
  syncLargeFiles: true,
  largeFileThreshold: 10 * 1024 * 1024, // 10MB
  maxRetries: 3,
  retryDelay: 2000,
});
```

### 2. 手动同步

```typescript
import { SyncDirection } from '@/types';

// 双向同步（默认）
const result = await syncManager.sync();

// 仅上传
const uploadResult = await syncManager.sync(SyncDirection.Upload);

// 仅下载
const downloadResult = await syncManager.sync(SyncDirection.Download);

// 检查结果
if (result.success) {
  console.log('Sync successful!');
  if (result.skipped) {
    console.log('Content unchanged, skipped');
  }
} else {
  console.error('Sync failed:', result.error);
}
```

### 3. 自动同步

```typescript
// 配置自动同步（每 5 秒同步一次）
await syncManager.updateConfig({
  mode: SyncMode.Auto,
  interval: 5000,
});

// 自动同步会在后台运行
// 可以通过监听事件获取同步状态
```

### 4. 实时同步

```typescript
// 配置实时同步（剪贴板变化时立即上传）
await syncManager.updateConfig({
  mode: SyncMode.Realtime,
});

// 实时同步会监听剪贴板变化
// 当剪贴板内容改变时自动上传到服务器
```

## 高级功能

### 监听同步事件

```typescript
import { SyncEventType } from '@/types';

syncManager.addListener('my-listener', (event) => {
  switch (event.type) {
    case SyncEventType.Started:
      console.log('Sync started');
      break;

    case SyncEventType.Progress:
      console.log('Sync in progress');
      break;

    case SyncEventType.Completed:
      console.log('Sync completed:', event.result);
      break;

    case SyncEventType.Failed:
      console.error('Sync failed:', event.result?.error);
      break;

    case SyncEventType.Conflict:
      console.warn('Conflict detected:', event.data);
      // 处理冲突
      break;

    case SyncEventType.StatusChanged:
      console.log('Status changed:', event.status);
      break;
  }
});

// 移除监听器
syncManager.removeListener('my-listener');
```

### 获取统计信息

```typescript
const stats = syncManager.getStats();

console.log('Total syncs:', stats.totalSyncs);
console.log('Success rate:', (stats.successCount / stats.totalSyncs) * 100);
console.log('Upload count:', stats.uploadCount);
console.log('Download count:', stats.downloadCount);
console.log('Average duration:', stats.averageDuration);
console.log('Last sync:', new Date(stats.lastSyncTime));
```

### 离线队列管理

```typescript
// 获取离线队列大小
const queueSize = syncManager.getOfflineQueueSize();
console.log('Offline queue:', queueSize);

// 清空离线队列
await syncManager.clearOfflineQueue();
```

### 冲突解决

支持 4 种冲突解决策略：

```typescript
import { ConflictResolution } from '@/types';

// 1. 总是使用本地版本
await syncManager.updateConfig({
  conflictResolution: ConflictResolution.UseLocal,
});

// 2. 总是使用远程版本
await syncManager.updateConfig({
  conflictResolution: ConflictResolution.UseRemote,
});

// 3. 使用最新版本（基于时间戳）
await syncManager.updateConfig({
  conflictResolution: ConflictResolution.UseNewest,
});

// 4. 询问用户
await syncManager.updateConfig({
  conflictResolution: ConflictResolution.Ask,
});

// 当策略为 Ask 时，会触发 Conflict 事件
syncManager.addListener('conflict-handler', (event) => {
  if (event.type === SyncEventType.Conflict) {
    // 显示 UI 让用户选择
    // event.data 包含 localContent 和 remoteProfile
  }
});
```

## React Native 集成示例

### 创建 Context

```typescript
// src/contexts/SyncContext.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import { SyncManager } from '@/services';
import { SyncStatus, SyncStats } from '@/types';

interface SyncContextValue {
  manager: SyncManager;
  status: SyncStatus;
  stats: SyncStats;
  sync: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [manager] = useState(() => SyncManager.getInstance());
  const [status, setStatus] = useState(SyncStatus.Idle);
  const [stats, setStats] = useState<SyncStats>(manager.getStats());

  useEffect(() => {
    // 初始化
    manager.initialize({
      // ... config
    });

    // 监听事件
    manager.addListener('context', (event) => {
      if (event.status) {
        setStatus(event.status);
      }
      setStats(manager.getStats());
    });

    return () => {
      manager.removeListener('context');
      manager.destroy();
    };
  }, [manager]);

  const sync = async () => {
    await manager.sync();
  };

  return (
    <SyncContext.Provider value={{ manager, status, stats, sync }}>{children}</SyncContext.Provider>
  );
}

export function useSync() {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error('useSync must be used within SyncProvider');
  }
  return context;
}
```

### 在组件中使用

```typescript
import { useSync } from '@/contexts/SyncContext';
import { SyncStatus } from '@/types';

function SyncButton() {
  const { status, sync, stats } = useSync();

  return (
    <View>
      <Button
        title={status === SyncStatus.Syncing ? 'Syncing...' : 'Sync'}
        onPress={sync}
        disabled={status === SyncStatus.Syncing}
      />
      <Text>Last sync: {new Date(stats.lastSyncTime).toLocaleString()}</Text>
      <Text>Success rate: {(stats.successCount / stats.totalSyncs) * 100}%</Text>
    </View>
  );
}
```

## 配置选项

### SyncConfig

| 字段                  | 类型                 | 默认值      | 描述                 |
| --------------------- | -------------------- | ----------- | -------------------- |
| `server`              | `ServerConfig`       | -           | 服务器配置（必填）   |
| `mode`                | `SyncMode`           | `Manual`    | 同步模式             |
| `interval`            | `number`             | `5000`      | 自动同步间隔（毫秒） |
| `conflictResolution`  | `ConflictResolution` | `UseNewest` | 冲突解决策略         |
| `enableOfflineQueue`  | `boolean`            | `true`      | 是否启用离线队列     |
| `maxOfflineQueueSize` | `number`             | `100`       | 最大离线队列大小     |
| `syncLargeFiles`      | `boolean`            | `true`      | 是否同步大文件       |
| `largeFileThreshold`  | `number`             | `10485760`  | 大文件阈值（10MB）   |
| `maxRetries`          | `number`             | `3`         | 最大重试次数         |
| `retryDelay`          | `number`             | `2000`      | 重试延迟（毫秒）     |

## 最佳实践

### 1. 错误处理

```typescript
try {
  const result = await syncManager.sync();
  if (!result.success) {
    // 处理同步失败
    Alert.alert('Sync Failed', result.error);
  }
} catch (error) {
  // 处理异常
  Alert.alert('Error', error.message);
}
```

### 2. 性能优化

```typescript
// 避免频繁同步
const SYNC_DEBOUNCE = 3000; // 3 秒防抖
let syncTimeout: NodeJS.Timeout | null = null;

function debouncedSync() {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    syncManager.sync();
  }, SYNC_DEBOUNCE);
}
```

### 3. 网络状态监听

```typescript
import NetInfo from '@react-native-community/netinfo';

NetInfo.addEventListener((state) => {
  if (state.isConnected && state.isInternetReachable) {
    // 网络恢复，处理离线队列
    const queueSize = syncManager.getOfflineQueueSize();
    if (queueSize > 0) {
      Alert.alert('Network Restored', `Processing ${queueSize} pending tasks`);
    }
  }
});
```

### 4. 清理资源

```typescript
// 在组件卸载或应用退出时清理
useEffect(() => {
  return () => {
    syncManager.destroy();
  };
}, []);
```

## 故障排查

### 同步失败

1. 检查网络连接
2. 验证服务器配置（URL、认证信息）
3. 查看错误日志
4. 检查离线队列是否有待处理任务

### 冲突频繁

1. 调整冲突解决策略
2. 增加同步间隔（减少并发修改）
3. 考虑使用实时同步模式

### 性能问题

1. 检查大文件配置
2. 减少自动同步频率
3. 限制离线队列大小
4. 使用防抖/节流

## API 参考

完整的 API 文档请参考类型定义：

- `src/types/sync.ts` - 同步相关类型
- `src/services/SyncManager.ts` - SyncManager 实现
