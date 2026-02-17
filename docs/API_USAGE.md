# API Client 使用示例

本文档展示如何使用 SyncClipboard API 客户端。

## 目录

- [基础用法](#基础用法)
- [SyncClipboard API](#syncclipboard-api)
- [WebDAV 客户端](#webdav-客户端)
- [错误处理](#错误处理)
- [认证管理](#认证管理)

> **相关文档**: 关于图片上传时的 Hash 计算，请参阅 [HASH_CALCULATION.md](HASH_CALCULATION.md)

## 基础用法

### 1. 创建 API 客户端

使用工厂函数创建客户端：

```typescript
import { createAPIClient } from '@/services';
import { ServerConfig } from '@/types/api';

// 配置服务器
const config: ServerConfig = {
  type: 'standalone',
  url: 'https://your-server.com',
  username: 'your-username',
  password: 'your-password',
};

// 创建客户端
const apiClient = createAPIClient(config);
```

### 2. 测试连接

```typescript
const isConnected = await apiClient.testConnection();
if (isConnected) {
  console.log('连接成功！');
} else {
  console.log('连接失败！');
}
```

## SyncClipboard API

### 创建独立服务器客户端

```typescript
import { SyncClipboardAPI, AuthService } from '@/services';

// 创建认证服务
const authService = new AuthService('username', 'password');

// 创建 API 客户端
const api = new SyncClipboardAPI({
  baseURL: 'https://your-server.com',
  authService,
  timeout: 30000, // 30 秒超时
});
```

### 获取剪贴板

```typescript
try {
  const profile = await api.getClipboard();

  console.log('剪贴板类型:', profile.type);
  console.log('文本内容:', profile.text);
  console.log('哈希值:', profile.hash);

  if (profile.hasData) {
    console.log('数据文件:', profile.dataName);
    console.log('文件大小:', profile.size);
  }
} catch (error) {
  console.error('获取剪贴板失败:', error);
}
```

### 上传剪贴板

```typescript
import { ProfileDto } from '@/types/api';

// 文本剪贴板
const textProfile: ProfileDto = {
  type: 'Text',
  text: 'Hello, World!',
  hash: 'abc123...', // SHA256 hash
  hasData: false,
};

try {
  await api.putClipboard(textProfile);
  console.log('上传成功！');
} catch (error) {
  console.error('上传失败:', error);
}
```

### 上传图片剪贴板

```typescript
// 图片剪贴板
const imageProfile: ProfileDto = {
  type: 'Image',
  text: '[图片]',
  hash: 'def456...',
  hasData: true,
  dataName: 'image.png',
  size: 102400, // 100KB
};

try {
  // 1. 上传配置
  await api.putClipboard(imageProfile);

  // 2. 上传图片文件
  const imageBlob = await fetchImageBlob(); // 获取图片数据
  await api.putFile('image.png', imageBlob);

  console.log('图片上传成功！');
} catch (error) {
  console.error('图片上传失败:', error);
}
```

### 下载文件

```typescript
try {
  const profile = await api.getClipboard();

  if (profile.hasData && profile.dataName) {
    // 下载文件数据
    const fileBlob = await api.getFile(profile.dataName);

    // 保存到本地
    await saveToLocal(fileBlob, profile.dataName);
    console.log('文件下载成功！');
  }
} catch (error) {
  console.error('文件下载失败:', error);
}
```

### 获取服务器信息

```typescript
try {
  const serverInfo = await api.getServerInfo();

  console.log('服务器版本:', serverInfo.version);
  console.log('服务器时间:', serverInfo.serverTime);
  console.log('在线状态:', serverInfo.online);
} catch (error) {
  console.error('获取服务器信息失败:', error);
}
```

## WebDAV 客户端

### 创建 WebDAV 客户端

```typescript
import { WebDAVClient } from '@/services';

const webdavClient = new WebDAVClient({
  baseURL: 'https://your-webdav-server.com',
  username: 'your-username',
  password: 'your-password',
  timeout: 30000,
});
```

### 使用 WebDAV 客户端

```typescript
// WebDAV 客户端实现了相同的 ISyncClipboardAPI 接口
// 使用方法与 SyncClipboardAPI 完全相同

// 获取剪贴板
const profile = await webdavClient.getClipboard();

// 上传剪贴板
await webdavClient.putClipboard(profile);

// 获取文件
const fileBlob = await webdavClient.getFile('image.png');

// 上传文件
await webdavClient.putFile('image.png', fileBlob);
```

### WebDAV 特有功能

```typescript
// 删除文件
await webdavClient.deleteFile('old-image.png');

// 列出目录（待实现）
const files = await webdavClient.listDirectory('/');
```

## 错误处理

### 错误类型

```typescript
import {
  APIError,
  AuthenticationError,
  NetworkError,
  ServerError,
  TimeoutError,
  ConfigurationError,
  ValidationError,
} from '@/services';

try {
  await api.getClipboard();
} catch (error) {
  if (error instanceof AuthenticationError) {
    console.error('认证失败，请检查用户名和密码');
  } else if (error instanceof NetworkError) {
    console.error('网络错误，请检查网络连接');
  } else if (error instanceof TimeoutError) {
    console.error('请求超时，请稍后重试');
  } else if (error instanceof ServerError) {
    console.error('服务器错误:', error.statusCode, error.response);
  } else if (error instanceof ValidationError) {
    console.error('数据验证失败:', error.message);
  } else if (error instanceof ConfigurationError) {
    console.error('配置错误:', error.message);
  } else {
    console.error('未知错误:', error);
  }
}
```

### 统一错误处理

```typescript
function handleAPIError(error: unknown): string {
  if (error instanceof AuthenticationError) {
    return '认证失败，请检查用户名和密码';
  }

  if (error instanceof NetworkError) {
    return '网络连接失败，请检查网络';
  }

  if (error instanceof TimeoutError) {
    return '请求超时，请稍后重试';
  }

  if (error instanceof ServerError) {
    return `服务器错误 (${error.statusCode})`;
  }

  if (error instanceof ValidationError) {
    return `数据验证失败: ${error.message}`;
  }

  if (error instanceof APIError) {
    return error.message;
  }

  return '未知错误';
}

// 使用
try {
  await api.getClipboard();
} catch (error) {
  const errorMessage = handleAPIError(error);
  Alert.alert('错误', errorMessage);
}
```

## 认证管理

### 保存认证信息

```typescript
import { AuthService } from '@/services';

const authService = new AuthService('username', 'password');

// 保存到 AsyncStorage
await authService.saveToStorage();
```

### 加载认证信息

```typescript
const authService = new AuthService();

// 从 AsyncStorage 加载
const loaded = await authService.loadFromStorage();

if (loaded) {
  console.log('认证信息加载成功');

  // 使用加载的认证信息
  const api = new SyncClipboardAPI({
    baseURL: 'https://your-server.com',
    authService,
  });
}
```

### 清除认证信息

```typescript
// 从内存清除
authService.clearCredentials();

// 从存储删除
await authService.deleteFromStorage();
```

### 更新认证信息

```typescript
// 更新凭证
authService.setCredentials('new-username', 'new-password');

// 保存到存储
await authService.saveToStorage();
```

## 完整示例

### React Native 组件中使用

```typescript
import React, { useState, useEffect } from 'react';
import { View, Text, Button, Alert } from 'react-native';
import { createAPIClient, AuthenticationError, NetworkError } from '@/services';
import { ProfileDto } from '@/types/api';

function ClipboardSync() {
  const [profile, setProfile] = useState<ProfileDto | null>(null);
  const [loading, setLoading] = useState(false);

  // 创建 API 客户端
  const api = createAPIClient({
    type: 'standalone',
    url: 'https://your-server.com',
    username: 'username',
    password: 'password',
  });

  // 获取剪贴板
  const fetchClipboard = async () => {
    setLoading(true);
    try {
      const data = await api.getClipboard();
      setProfile(data);
      Alert.alert('成功', '剪贴板获取成功');
    } catch (error) {
      if (error instanceof AuthenticationError) {
        Alert.alert('错误', '认证失败');
      } else if (error instanceof NetworkError) {
        Alert.alert('错误', '网络连接失败');
      } else {
        Alert.alert('错误', '获取剪贴板失败');
      }
    } finally {
      setLoading(false);
    }
  };

  // 上传剪贴板
  const uploadClipboard = async (text: string) => {
    setLoading(true);
    try {
      const profile: ProfileDto = {
        type: 'Text',
        text,
        hash: calculateHash(text),
        hasData: false,
      };

      await api.putClipboard(profile);
      Alert.alert('成功', '剪贴板上传成功');
    } catch (error) {
      Alert.alert('错误', '上传剪贴板失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View>
      <Button
        title="获取剪贴板"
        onPress={fetchClipboard}
        disabled={loading}
      />

      {profile && (
        <View>
          <Text>类型: {profile.type}</Text>
          <Text>内容: {profile.text}</Text>
        </View>
      )}
    </View>
  );
}

function calculateHash(text: string): string {
  // TODO: 实现 SHA256 hash
  return 'hash';
}
```

## 注意事项

1. **认证信息安全**：密码应该加密存储，考虑使用 `expo-secure-store`
2. **网络状态检查**：在执行网络请求前检查网络状态
3. **错误重试**：实现错误重试机制（指数退避）
4. **超时设置**：根据网络环境调整超时时间
5. **日志记录**：在生产环境中关闭详细日志
6. **类型验证**：始终验证 API 响应数据的类型和格式

## 下一步

- 实现 Hash 计算函数（SHA256）
- 实现同步管理器使用 API 客户端
- 实现离线队列和错误重试
- 添加单元测试
