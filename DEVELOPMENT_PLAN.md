# SyncClipboard Mobile - React Native 开发规划文档

> **项目版本**: v1.0.0  
> **文档日期**: 2026年2月12日  
> **技术栈**: React Native + Expo

---

## 📋 目录

- [1. 项目概述](#1-项目概述)
- [2. 核心功能分析](#2-核心功能分析)
- [3. 技术栈选择](#3-技术栈选择)
- [4. 架构设计](#4-架构设计)
- [5. 功能模块详细规划](#5-功能模块详细规划)
- [6. API 集成方案](#6-api-集成方案)
- [7. UI/UX 设计要点](#7-uiux-设计要点)
- [8. 安全性设计](#8-安全性设计)
- [9. 性能优化策略](#9-性能优化策略)
- [10. 开发路线图](#10-开发路线图)
- [11. 测试策略](#11-测试策略)
- [12. 发布与部署](#12-发布与部署)

---

## 1. 项目概述

### 1.1 项目背景

SyncClipboard 是一个跨平台的剪贴板同步工具，目前已支持 Windows、macOS、Linux 桌面平台。为了提供原生的移动端体验，需要开发官方的 React Native 移动应用，替代现有的第三方工具集成方案。

### 1.2 项目目标

- 为 iOS 和 Android 用户提供原生移动应用体验
- 实现与桌面端功能对等的核心剪贴板同步功能
- 提供比第三方方案更好的用户体验和性能
- 支持后台自动同步和手动触发同步
- 提供剪贴板历史记录管理功能

### 1.3 目标用户

- 现有 SyncClipboard 桌面用户
- 需要跨设备剪贴板同步的移动用户
- 追求高效工作流的专业人士

### 1.4 核心价值

- **无缝同步**: 实时或近实时的剪贴板内容同步
- **原生体验**: 比脚本或快捷指令更流畅的交互体验
- **历史管理**: 方便的剪贴板历史查看和管理
- **多服务器支持**: 支持独立服务器、内置服务器和 WebDAV

---

## 2. 核心功能分析

### 2.1 现有桌面端功能

基于对 SyncClipboard 项目的分析，桌面端主要功能包括：

1. **剪贴板同步**
   - 实时监听本地剪贴板变化
   - 自动上传到服务器
   - 自动从服务器下载并更新本地剪贴板

2. **剪贴板类型支持**
   - Text (文本)
   - Image (图片)
   - File (文件)
   - Group (多文件/文件夹)

3. **剪贴板历史记录**
   - 历史记录存储
   - 历史记录查看
   - 历史记录搜索
   - 从历史记录恢复

4. **图片优化**
   - 从浏览器下载原图
   - 图片格式转换 (webp/heic → gif/jpg)
   - 图片文件与剪贴板互转

5. **服务器支持**
   - 独立服务器 (ASP.NET Core)
   - 客户端内置服务器
   - WebDAV 服务器

### 2.2 移动端适配需求

#### 2.2.1 iOS 平台限制

- **后台限制**: iOS 不允许应用在后台持续访问剪贴板
- **剪贴板权限**: iOS 14+ 访问剪贴板时会显示提示
- **解决方案**:
  - 使用 App Clips 或 Widget 触发
  - 用户主动触发同步
  - 使用共享扩展 (Share Extension)

#### 2.2.2 Android 平台限制

- **后台限制**: Android 10+ 限制后台应用访问剪贴板
- **前台服务**: 需要前台服务才能持续监听
- **解决方案**:
  - 使用前台服务 + 通知
  - ClipboardManager.OnPrimaryClipChangedListener
  - 辅助功能服务 (需要用户授权)

#### 2.2.3 功能优先级调整

**P0 (必须有)**

- 文本剪贴板同步 (上传/下载)
- 手动触发同步
- 服务器配置管理
- 基础身份认证

**P1 (高优先级)**

- 剪贴板历史记录查看
- 自动同步 (在权限允许的情况下)
- 图片剪贴板支持
- 通知提醒

**P2 (中优先级)**

- 文件剪贴板支持
- 剪贴板历史搜索
- Widget 支持
- 多服务器配置

**P3 (低优先级)**

- 文件夹/多文件支持
- OCR 文字识别
- 剪贴板编辑
- 高级过滤规则

---

## 3. 技术栈选择

### 3.1 核心框架

**React Native + Expo**

选择理由：

- ✅ 跨平台开发，代码复用率高
- ✅ Expo 提供完善的开发工具链
- ✅ 丰富的社区生态和第三方库
- ✅ 支持 OTA 更新
- ✅ 团队已有相关技能（根据已安装的 vercel-react-native-skills）

### 3.2 主要技术栈

| 类别         | 技术选型                                   | 说明                         |
| ------------ | ------------------------------------------ | ---------------------------- |
| **框架**     | React Native 0.75+ / Expo SDK 52+          | 最新稳定版本                 |
| **语言**     | TypeScript                                 | 类型安全                     |
| **状态管理** | Zustand                                    | 轻量级，易于使用             |
| **导航**     | React Navigation 7                         | 官方推荐                     |
| **UI 组件**  | React Native Paper / NativeBase            | Material Design / 跨平台组件 |
| **网络请求** | Axios                                      | HTTP 客户端                  |
| **本地存储** | AsyncStorage / MMKV                        | 配置和缓存                   |
| **后台任务** | react-native-background-actions            | Android 后台服务             |
| **剪贴板**   | @react-native-clipboard/clipboard          | 原生剪贴板访问               |
| **文件系统** | expo-file-system                           | 文件操作                     |
| **图片处理** | expo-image-picker / expo-image-manipulator | 图片选择和处理               |
| **加密**     | expo-crypto / react-native-aes-crypto      | 数据加密                     |
| **推送通知** | expo-notifications                         | 本地通知                     |

### 3.3 开发工具

- **IDE**: VS Code + React Native Tools
- **调试**: React Native Debugger / Flipper
- **测试**: Jest + React Native Testing Library
- **代码质量**: ESLint + Prettier
- **版本控制**: Git
- **CI/CD**: GitHub Actions / EAS Build

---

## 4. 架构设计

### 4.1 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                     Presentation Layer                   │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐        │
│  │   Home     │  │  History   │  │  Settings  │        │
│  │   Screen   │  │   Screen   │  │   Screen   │        │
│  └────────────┘  └────────────┘  └────────────┘        │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                     Business Logic Layer                 │
│  ┌──────────────────┐  ┌──────────────────┐            │
│  │  Sync Manager    │  │  History Manager │            │
│  └──────────────────┘  └──────────────────┘            │
│  ┌──────────────────┐  ┌──────────────────┐            │
│  │  Clipboard       │  │  Notification    │            │
│  │  Monitor         │  │  Manager         │            │
│  └──────────────────┘  └──────────────────┘            │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                      Data Access Layer                   │
│  ┌──────────────────┐  ┌──────────────────┐            │
│  │  API Client      │  │  Local Storage   │            │
│  └──────────────────┘  └──────────────────┘            │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                      External Services                   │
│  ┌──────────────────┐  ┌──────────────────┐            │
│  │  SyncClipboard   │  │  WebDAV Server   │            │
│  │  Server          │  │                  │            │
│  └──────────────────┘  └──────────────────┘            │
└─────────────────────────────────────────────────────────┘
```

### 4.2 目录结构

```
syncclipboard-mobile/
├── app/                          # 应用入口 (Expo Router)
│   ├── (tabs)/                   # 标签导航
│   │   ├── index.tsx            # 首页
│   │   ├── history.tsx          # 历史记录
│   │   └── settings.tsx         # 设置
│   ├── _layout.tsx              # 根布局
│   └── +not-found.tsx           # 404 页面
├── src/
│   ├── components/              # 可复用组件
│   │   ├── common/              # 通用组件
│   │   ├── clipboard/           # 剪贴板相关组件
│   │   └── history/             # 历史记录组件
│   ├── services/                # 业务逻辑服务
│   │   ├── api/                 # API 客户端
│   │   │   ├── client.ts        # HTTP 客户端
│   │   │   ├── auth.ts          # 认证
│   │   │   └── sync.ts          # 同步 API
│   │   ├── clipboard/           # 剪贴板服务
│   │   │   ├── monitor.ts       # 剪贴板监听
│   │   │   ├── manager.ts       # 剪贴板管理
│   │   │   └── hash.ts          # Hash 计算
│   │   ├── sync/                # 同步服务
│   │   │   ├── manager.ts       # 同步管理器
│   │   │   ├── uploader.ts      # 上传器
│   │   │   └── downloader.ts    # 下载器
│   │   ├── storage/             # 本地存储
│   │   │   ├── config.ts        # 配置存储
│   │   │   ├── cache.ts         # 缓存管理
│   │   │   └── history.ts       # 历史记录存储
│   │   ├── notification/        # 通知服务
│   │   └── background/          # 后台任务
│   ├── stores/                  # 状态管理 (Zustand)
│   │   ├── clipboardStore.ts    # 剪贴板状态
│   │   ├── syncStore.ts         # 同步状态
│   │   ├── historyStore.ts      # 历史记录状态
│   │   └── settingsStore.ts     # 设置状态
│   ├── types/                   # TypeScript 类型定义
│   │   ├── api.ts               # API 类型
│   │   ├── clipboard.ts         # 剪贴板类型
│   │   └── config.ts            # 配置类型
│   ├── utils/                   # 工具函数
│   │   ├── crypto.ts            # 加密工具
│   │   ├── validation.ts        # 验证工具
│   │   └── helpers.ts           # 辅助函数
│   └── constants/               # 常量定义
│       ├── api.ts               # API 常量
│       └── app.ts               # 应用常量
├── assets/                      # 静态资源
│   ├── images/
│   └── fonts/
├── __tests__/                   # 测试文件
├── app.json                     # Expo 配置
├── package.json
├── tsconfig.json
└── README.md
```

### 4.3 数据流设计

```
┌──────────────┐
│  用户操作     │
└──────┬───────┘
       │
       ↓
┌──────────────┐      ┌──────────────┐
│  UI 组件     │ ←──→ │  Zustand     │
│              │      │  Store       │
└──────┬───────┘      └──────────────┘
       │
       ↓
┌──────────────┐
│  Services    │
└──────┬───────┘
       │
       ├─→ API Client ──→ Server
       ├─→ Local Storage ──→ AsyncStorage/MMKV
       └─→ Native Modules ──→ Clipboard/File System
```

---

## 5. 功能模块详细规划

### 5.1 首页 (Home Screen)

#### 5.1.1 功能需求

- 显示当前剪贴板内容预览
- 显示最近同步状态
- 快速同步操作按钮（上传/下载/双向）
- 同步历史简要显示

#### 5.1.2 UI 组件

```typescript
// 主要组件
-CurrentClipboardCard - // 当前剪贴板卡片
  QuickActionsBar - // 快速操作栏
  SyncStatusIndicator - // 同步状态指示器
  RecentHistoryList; // 最近历史列表
```

#### 5.1.3 交互逻辑

1. 页面加载时获取本地剪贴板内容
2. 检查服务器连接状态
3. 用户点击同步按钮触发相应操作
4. 显示同步进度和结果反馈

### 5.2 历史记录 (History Screen)

#### 5.2.1 功能需求

- 分页加载历史记录
- 按类型筛选（文本/图片/文件）
- 搜索历史记录
- 预览历史记录内容
- 复制历史记录到剪贴板
- 删除历史记录

#### 5.2.2 数据结构

```typescript
interface HistoryItem {
  id: string;
  type: 'Text' | 'Image' | 'File' | 'Group';
  text: string; // 预览文本
  hash: string;
  hasData: boolean;
  dataName?: string;
  size?: number;
  timestamp: number;
  synced: boolean;
}
```

#### 5.2.3 性能优化

- 使用 FlashList 进行列表虚拟化
- 实现懒加载和无限滚动
- 图片缩略图缓存
- 搜索防抖

### 5.3 设置 (Settings Screen)

#### 5.3.1 服务器配置

```typescript
interface ServerConfig {
  type: 'standalone' | 'webdav';
  url: string;
  username: string;
  password: string; // 加密存储
  autoSync: boolean;
  syncInterval: number; // 秒
  notificationEnabled: boolean;
}
```

#### 5.3.2 设置项

- **服务器设置**
  - 服务器类型选择
  - URL 配置
  - 用户名/密码
  - 连接测试

- **同步设置**
  - 自动同步开关
  - 同步间隔
  - 仅 WiFi 同步
  - 后台同步（Android）

- **通知设置**
  - 同步成功通知
  - 同步失败通知
  - 新内容提醒

- **历史记录设置**
  - 历史记录保留天数
  - 自动清理
  - 最大存储数量

- **高级设置**
  - 数据加密
  - 日志记录
  - 诊断模式

### 5.4 同步管理器 (Sync Manager)

#### 5.4.1 核心功能

```typescript
class SyncManager {
  // 上传剪贴板
  async uploadClipboard(): Promise<void>;

  // 下载剪贴板
  async downloadClipboard(): Promise<void>;

  // 双向同步
  async syncBidirectional(): Promise<void>;

  // 启动自动同步
  startAutoSync(): void;

  // 停止自动同步
  stopAutoSync(): void;
}
```

#### 5.4.2 同步策略

**冲突处理**

1. 比较本地和远程的 hash 值
2. 比较时间戳（如果可用）
3. 默认策略：服务器端优先（可配置）

**去重逻辑**

- 使用 hash 值判断内容是否相同
- 避免重复上传相同内容
- 缓存最近同步的 hash

**错误重试**

- 指数退避算法
- 最大重试次数限制
- 网络恢复后自动重试

### 5.5 剪贴板监听器 (Clipboard Monitor)

#### 5.5.1 实现方案

**iOS**

```typescript
// 使用定时轮询 + App 状态监听
class iOSClipboardMonitor {
  private intervalId?: NodeJS.Timeout;

  start() {
    // App 进入前台时启动轮询
    AppState.addEventListener('change', this.handleAppStateChange);
  }

  private async checkClipboard() {
    const content = await Clipboard.getString();
    if (content !== this.lastContent) {
      this.onClipboardChanged(content);
      this.lastContent = content;
    }
  }
}
```

**Android**

```typescript
// 使用原生模块 + 前台服务
class AndroidClipboardMonitor {
  async start() {
    // 请求前台服务权限
    await this.requestForegroundPermission();

    // 启动前台服务
    await NativeModules.ClipboardService.start();

    // 监听原生事件
    DeviceEventEmitter.addListener('onClipboardChanged', this.handleClipboardChanged);
  }
}
```

#### 5.5.2 性能考虑

- iOS: 轮询间隔不小于 1 秒
- Android: 使用原生监听器，避免轮询
- 防止频繁触发同步（防抖）
- 电池优化考虑

---

## 6. API 集成方案

### 6.1 API 接口定义

基于 SyncClipboard 服务器 API：

#### 6.1.1 核心 API

```typescript
// API 客户端接口
interface SyncClipboardAPI {
  // 获取剪贴板
  getClipboard(): Promise<ProfileDto>;

  // 上传剪贴板
  putClipboard(profile: ProfileDto): Promise<void>;

  // 获取文件
  getFile(fileName: string): Promise<Blob>;

  // 上传文件
  putFile(fileName: string, data: Blob): Promise<void>;

  // 获取服务器时间
  getServerTime(): Promise<Date>;

  // 获取服务器版本
  getVersion(): Promise<string>;
}
```

#### 6.1.2 数据类型

```typescript
// 剪贴板配置 DTO
interface ProfileDto {
  type: 'Text' | 'Image' | 'File' | 'Group';
  hash?: string; // SHA256 hash
  text: string; // 预览文本或完整文本
  hasData: boolean; // 是否有额外数据文件
  dataName?: string; // 数据文件名
  size?: number; // 文件大小（字节）
}
```

### 6.2 认证机制

```typescript
// Basic Authentication
class AuthService {
  private credentials: {
    username: string;
    password: string;
  };

  getAuthHeader(): string {
    const encoded = btoa(`${this.username}:${this.password}`);
    return `Basic ${encoded}`;
  }
}
```

### 6.3 HTTP 客户端封装

```typescript
import axios, { AxiosInstance } from 'axios';

class APIClient {
  private client: AxiosInstance;

  constructor(baseURL: string, authService: AuthService) {
    this.client = axios.create({
      baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // 请求拦截器 - 添加认证
    this.client.interceptors.request.use((config) => {
      config.headers.Authorization = authService.getAuthHeader();
      return config;
    });

    // 响应拦截器 - 错误处理
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          // 认证失败
          throw new AuthenticationError('Invalid credentials');
        }
        throw error;
      }
    );
  }

  async getClipboard(): Promise<ProfileDto> {
    const response = await this.client.get('/SyncClipboard.json');
    return response.data;
  }

  async putClipboard(profile: ProfileDto): Promise<void> {
    await this.client.put('/SyncClipboard.json', profile);
  }
}
```

### 6.4 WebDAV 支持

```typescript
class WebDAVClient implements SyncClipboardAPI {
  private client: AxiosInstance;

  constructor(baseURL: string, username: string, password: string) {
    // WebDAV 特定配置
    this.client = axios.create({
      baseURL,
      auth: { username, password },
    });
  }

  async getClipboard(): Promise<ProfileDto> {
    // WebDAV GET 请求
    const response = await this.client.get('/SyncClipboard.json');
    return response.data;
  }

  async putClipboard(profile: ProfileDto): Promise<void> {
    // WebDAV PUT 请求
    await this.client.put('/SyncClipboard.json', profile);
  }
}
```

### 6.5 离线支持

```typescript
class OfflineQueueManager {
  private queue: SyncOperation[] = [];

  async enqueue(operation: SyncOperation): Promise<void> {
    this.queue.push(operation);
    await this.persistQueue();
  }

  async processQueue(): Promise<void> {
    while (this.queue.length > 0) {
      const operation = this.queue[0];
      try {
        await operation.execute();
        this.queue.shift();
        await this.persistQueue();
      } catch (error) {
        // 网络错误，停止处理
        break;
      }
    }
  }
}
```

---

## 7. UI/UX 设计要点

### 7.1 设计原则

1. **简洁优先**: 核心功能直达，避免复杂操作
2. **即时反馈**: 所有操作都有明确的视觉反馈
3. **容错设计**: 友好的错误提示和恢复机制
4. **平台一致**: 遵循各平台的设计规范

### 7.2 主题设计

```typescript
const theme = {
  colors: {
    primary: '#0066CC', // 主色调
    secondary: '#5856D6', // 次要色
    success: '#34C759', // 成功
    warning: '#FF9500', // 警告
    error: '#FF3B30', // 错误
    background: '#FFFFFF', // 背景
    surface: '#F2F2F7', // 表面
    text: '#000000', // 文本
    textSecondary: '#8E8E93', // 次要文本
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
  borderRadius: {
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
  },
};
```

### 7.3 关键界面设计

#### 7.3.1 首页设计要点

- 大卡片展示当前剪贴板内容
- 醒目的同步按钮（底部 FAB）
- 状态指示器（已同步/未同步/同步中）
- 下拉刷新支持

#### 7.3.2 历史记录设计要点

- 列表项差异化展示不同类型
- 快速操作菜单（长按）
- 搜索框置顶
- 空状态提示

#### 7.3.3 设置页面设计要点

- 分组折叠设计
- 重要设置醒目标识
- 危险操作二次确认
- 内联帮助文本

### 7.4 动画与过渡

遵循 React Native 最佳实践：

- 使用 Reanimated 3 实现流畅动画
- 避免在 JS 线程执行复杂动画
- 合理使用手势交互
- 过渡动画不超过 300ms

---

## 8. 安全性设计

### 8.1 数据加密

#### 8.1.1 敏感信息存储

```typescript
// 使用 Expo SecureStore 存储密码
import * as SecureStore from 'expo-secure-store';

class SecureConfigStorage {
  async savePassword(password: string): Promise<void> {
    await SecureStore.setItemAsync('server_password', password);
  }

  async getPassword(): Promise<string | null> {
    return await SecureStore.getItemAsync('server_password');
  }
}
```

#### 8.1.2 传输安全

- 强制使用 HTTPS（生产环境）
- 证书验证
- 支持自签名证书（可选）

### 8.2 认证安全

- 密码本地加密存储
- 支持 Token 认证（未来）
- 会话管理
- 自动登出（可选）

### 8.3 权限管理

```typescript
// 权限请求管理
class PermissionManager {
  async requestClipboardPermission(): Promise<boolean> {
    // iOS 自动请求，Android 无需特殊权限
    return true;
  }

  async requestNotificationPermission(): Promise<boolean> {
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  }

  async requestStoragePermission(): Promise<boolean> {
    // Android 文件访问权限
    const { status } = await MediaLibrary.requestPermissionsAsync();
    return status === 'granted';
  }
}
```

### 8.4 数据隐私

- 剪贴板数据不发送到第三方
- 本地历史记录加密选项
- 隐私模式（敏感数据不记录历史）
- 应用锁（生物识别）

---

## 9. 性能优化策略

### 9.1 启动性能

- **Lazy Loading**: 按需加载组件和模块
- **代码分割**: 使用 dynamic import
- **Snapshot**: 使用 Hermes 引擎
- **减少依赖**: 避免引入大型库

```typescript
// 示例：懒加载历史记录屏幕
import { lazy } from 'react';

const HistoryScreen = lazy(() => import('./screens/HistoryScreen'));
```

### 9.2 列表性能

遵循 vercel-react-native-skills：

```typescript
// 使用 FlashList 替代 FlatList
import { FlashList } from '@shopify/flash-list';

// 优化列表项渲染
const HistoryItem = memo(({ item }: { item: HistoryItem }) => {
  // 使用 memo 避免不必要的重渲染
  return <HistoryItemCard item={item} />;
}, (prevProps, nextProps) => {
  // 自定义比较函数
  return prevProps.item.id === nextProps.item.id;
});

// 稳定的 callback 引用
const handleItemPress = useCallback((item: HistoryItem) => {
  // 处理点击
}, []);
```

### 9.3 图片性能

```typescript
// 使用 expo-image 优化图片加载
import { Image } from 'expo-image';

<Image
  source={{ uri: imageUrl }}
  contentFit="cover"
  transition={200}
  cachePolicy="memory-disk"
/>
```

### 9.4 网络性能

- 请求去重
- 响应缓存
- 请求合并
- 超时控制

```typescript
class RequestCache {
  private cache = new Map<string, CachedResponse>();

  async fetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && !cached.isExpired()) {
      return cached.data as T;
    }

    const data = await fetcher();
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: 60000, // 1 分钟
    });

    return data;
  }
}
```

### 9.5 内存管理

- 及时清理大对象
- 图片缓存限制
- 避免内存泄漏

```typescript
useEffect(() => {
  const subscription = eventEmitter.on('clipboardChanged', handler);

  return () => {
    // 清理订阅
    subscription.remove();
  };
}, []);
```

---

## 10. 开发路线图

### 10.1 Phase 1: MVP 开发 (4-6 周)

**Week 1-2: 项目初始化与基础架构**

- [ ] 初始化 Expo 项目
- [ ] 配置 TypeScript 和 ESLint
- [ ] 搭建基础目录结构
- [ ] 配置导航结构
- [ ] 搭建 UI 组件库
- [ ] 实现主题系统

**Week 3-4: 核心功能开发**

- [ ] 实现 API 客户端
- [ ] 实现剪贴板服务
- [ ] 实现同步管理器
- [ ] 实现本地存储
- [ ] 实现 Zustand stores

**Week 5-6: UI 开发与集成**

- [ ] 开发首页界面
- [ ] 开发设置界面
- [ ] 开发基础历史记录界面
- [ ] 集成同步功能
- [ ] 基础测试

**交付物**

- 可运行的 MVP 应用
- 支持文本剪贴板同步
- 基础设置功能
- iOS 和 Android 测试版本

### 10.2 Phase 2: 功能完善 (3-4 周)

**Week 7-8: 高级功能**

- [ ] 实现完整历史记录功能
- [ ] 实现搜索功能
- [ ] 实现图片剪贴板支持
- [ ] 实现通知系统
- [ ] 优化同步逻辑

**Week 9-10: 平台特性**

- [ ] iOS Share Extension
- [ ] Android 前台服务
- [ ] Widget 支持（可选）
- [ ] 后台同步优化

**交付物**

- 功能完整的应用
- 平台特定优化
- Beta 测试版本

### 10.3 Phase 3: 优化与发布 (2-3 周)

**Week 11-12: 性能优化**

- [ ] 性能分析与优化
- [ ] 启动速度优化
- [ ] 内存优化
- [ ] 网络优化
- [ ] 电池优化

**Week 13: 测试与修复**

- [ ] 完整功能测试
- [ ] 兼容性测试
- [ ] Bug 修复
- [ ] 文档编写

**Week 14: 发布准备**

- [ ] App Store 素材准备
- [ ] Google Play 素材准备
- [ ] 提交审核
- [ ] 发布计划

**交付物**

- 生产就绪的应用
- App Store / Google Play 上架

### 10.4 Phase 4: 持续迭代 (持续)

- 用户反馈收集
- Bug 修复
- 性能优化
- 新功能开发
- 平台适配更新

---

## 11. 测试策略

### 11.1 测试金字塔

```
        ╱────────╲
       ╱  E2E 测试 ╲        10%  - 关键用户场景
      ╱ ──────────╲
     ╱  集成测试    ╲       20%  - 模块间交互
    ╱──────────────╲
   ╱   单元测试     ╲      70%  - 业务逻辑
  ╱─────────────────╲
```

### 11.2 单元测试

#### 11.2.1 测试框架配置

```bash
# 安装测试依赖
npm install --save-dev jest @testing-library/react-native @testing-library/jest-native
npm install --save-dev @testing-library/react-hooks
npm install --save-dev jest-expo
```

```javascript
// jest.config.js
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['@testing-library/jest-native/extend-expect'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.stories.tsx',
    '!src/**/index.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
};
```

#### 11.2.2 API 客户端测试

```typescript
// src/services/__tests__/APIClient.test.ts
import { APIClient } from '../APIClient';
import MockAdapter from 'axios-mock-adapter';

describe('APIClient', () => {
  let client: APIClient;
  let mock: MockAdapter;

  beforeEach(() => {
    client = new APIClient({ baseUrl: 'https://test.com' });
    mock = new MockAdapter(client.axiosInstance);
  });

  afterEach(() => {
    mock.restore();
  });

  describe('请求拦截器', () => {
    it('应该添加 Authorization header', async () => {
      client.setToken('test-token');
      mock.onGet('/test').reply((config) => {
        expect(config.headers?.Authorization).toBe('Bearer test-token');
        return [200, { data: 'ok' }];
      });

      await client.get('/test');
    });

    it('应该正确处理无 token 情况', async () => {
      mock.onGet('/test').reply((config) => {
        expect(config.headers?.Authorization).toBeUndefined();
        return [200, { data: 'ok' }];
      });

      await client.get('/test');
    });
  });

  describe('响应拦截器', () => {
    it('应该正确解析成功响应', async () => {
      mock.onGet('/test').reply(200, { message: 'success' });
      const response = await client.get('/test');
      expect(response.data.message).toBe('success');
    });

    it('应该正确处理 401 错误', async () => {
      mock.onGet('/test').reply(401);
      await expect(client.get('/test')).rejects.toThrow();
    });

    it('应该正确处理网络错误', async () => {
      mock.onGet('/test').networkError();
      await expect(client.get('/test')).rejects.toThrow();
    });
  });

  describe('重试机制', () => {
    it('应该在失败时重试', async () => {
      let attempts = 0;
      mock.onGet('/test').reply(() => {
        attempts++;
        return attempts < 3 ? [500] : [200, { data: 'ok' }];
      });

      await client.get('/test');
      expect(attempts).toBe(3);
    });
  });
});

// src/services/__tests__/SyncClipboardAPI.test.ts
describe('SyncClipboardAPI', () => {
  it('应该成功上传文本剪贴板', async () => {
    // 测试文本上传
  });

  it('应该成功下载剪贴板', async () => {
    // 测试下载
  });

  it('应该正确处理冲突', async () => {
    // 测试冲突处理
  });
});
```

#### 11.2.3 剪贴板服务测试

```typescript
// src/services/__tests__/ClipboardManager.test.ts
import { ClipboardManager } from '../ClipboardManager';
import Clipboard from '@react-native-clipboard/clipboard';

jest.mock('@react-native-clipboard/clipboard');

describe('ClipboardManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getText', () => {
    it('应该正确读取文本', async () => {
      (Clipboard.getString as jest.Mock).mockResolvedValue('test text');
      const text = await ClipboardManager.getText();
      expect(text).toBe('test text');
    });

    it('应该处理读取失败', async () => {
      (Clipboard.getString as jest.Mock).mockRejectedValue(new Error('fail'));
      await expect(ClipboardManager.getText()).rejects.toThrow();
    });
  });

  describe('setText', () => {
    it('应该正确写入文本', async () => {
      await ClipboardManager.setText('test');
      expect(Clipboard.setString).toHaveBeenCalledWith('test');
    });
  });

  describe('hashContent', () => {
    it('应该生成正确的 hash', async () => {
      const hash = await ClipboardManager.hashContent('test');
      expect(hash).toHaveLength(64); // SHA256 长度
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('相同内容应生成相同 hash', async () => {
      const hash1 = await ClipboardManager.hashContent('test');
      const hash2 = await ClipboardManager.hashContent('test');
      expect(hash1).toBe(hash2);
    });
  });
});

// src/services/__tests__/ClipboardMonitor.test.ts
describe('ClipboardMonitor', () => {
  it('应该检测剪贴板变化', async () => {
    // 测试监听
  });

  it('应该正确计算 hash', async () => {
    // 测试 hash 比对
  });
});
```

#### 11.2.4 同步管理器测试

```typescript
// src/services/__tests__/SyncManager.test.ts
describe('SyncManager', () => {
  describe('上传同步', () => {
    it('应该成功上传文本', async () => {
      // 测试上传
    });

    it('应该处理上传失败', async () => {
      // 测试错误处理
    });

    it('应该添加到离线队列', async () => {
      // 测试离线队列
    });
  });

  describe('下载同步', () => {
    it('应该成功下载并更新本地', async () => {
      // 测试下载
    });

    it('应该处理冲突', async () => {
      // 测试冲突处理
    });
  });

  describe('自动同步', () => {
    it('应该按间隔自动同步', async () => {
      // 测试自动同步
    });

    it('应该能启动和停止', async () => {
      // 测试生命周期
    });
  });
});
```

#### 11.2.5 状态管理测试

```typescript
// src/stores/__tests__/clipboardStore.test.ts
import { renderHook, act } from '@testing-library/react-hooks';
import { useClipboardStore } from '../clipboardStore';

describe('clipboardStore', () => {
  it('应该正确初始化状态', () => {
    const { result } = renderHook(() => useClipboardStore());
    expect(result.current.localClipboard).toBeNull();
    expect(result.current.remoteClipboard).toBeNull();
  });

  it('应该正确设置本地剪贴板', () => {
    const { result } = renderHook(() => useClipboardStore());
    
    act(() => {
      result.current.setLocalClipboard({
        type: 'text',
        content: 'test',
        hash: 'abc123',
        timestamp: Date.now(),
      });
    });

    expect(result.current.localClipboard?.content).toBe('test');
  });

  it('应该正确执行操作', async () => {
    const { result } = renderHook(() => useClipboardStore());
    
    await act(async () => {
      await result.current.copyToClipboard('test');
    });

    expect(result.current.localClipboard?.content).toBe('test');
  });
});

// 类似的测试 syncStore, historyStore, settingsStore
```

#### 11.2.6 UI 组件测试

```typescript
// src/components/__tests__/CurrentClipboardCard.test.tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { CurrentClipboardCard } from '../CurrentClipboardCard';

describe('CurrentClipboardCard', () => {
  it('应该渲染文本类型', () => {
    const { getByText } = render(
      <CurrentClipboardCard
        clipboard={{
          type: 'text',
          content: 'Test content',
          hash: 'abc',
          timestamp: Date.now(),
        }}
        title="本地剪贴板"
      />
    );

    expect(getByText('Test content')).toBeTruthy();
  });

  it('应该渲染空状态', () => {
    const { getByText } = render(
      <CurrentClipboardCard clipboard={null} title="本地剪贴板" />
    );

    expect(getByText('暂无内容')).toBeTruthy();
  });

  it('应该触发复制操作', () => {
    const onCopy = jest.fn();
    const { getByTestId } = render(
      <CurrentClipboardCard
        clipboard={{ type: 'text', content: 'test', hash: 'abc', timestamp: 0 }}
        title="本地"
        onCopy={onCopy}
      />
    );

    fireEvent.press(getByTestId('copy-button'));
    expect(onCopy).toHaveBeenCalled();
  });
});
```

### 11.3 集成测试

#### 11.3.1 端到端流程测试

```typescript
// src/__tests__/integration/sync-flow.test.ts
describe('剪贴板同步流程', () => {
  it('应该完成完整的上传同步流程', async () => {
    // 1. 设置剪贴板内容
    await ClipboardManager.setText('test content');
    
    // 2. 触发上传
    const result = await SyncManager.upload();
    
    // 3. 验证结果
    expect(result.success).toBe(true);
    expect(result.remoteHash).toBeDefined();
    
    // 4. 验证历史记录
    const history = await HistoryStorage.getHistory();
    expect(history[0].content).toBe('test content');
  });

  it('应该完成完整的下载同步流程', async () => {
    // 1. 模拟远程有新内容
    // 2. 触发下载
    // 3. 验证本地剪贴板已更新
    // 4. 验证历史记录已添加
  });

  it('应该正确处理冲突', async () => {
    // 测试冲突场景
  });
});
```

#### 11.3.2 服务器连接测试

```typescript
describe('服务器连接集成测试', () => {
  it('应该成功连接 SyncClipboard 服务器', async () => {
    const config = {
      serverType: 'syncclipboard',
      url: 'http://localhost:5033',
      username: 'test',
      password: 'test123',
    };

    const result = await ConfigStorage.testConnection(config);
    expect(result.success).toBe(true);
  });

  it('应该成功连接 WebDAV 服务器', async () => {
    // 测试 WebDAV 连接
  });
});
```

### 11.4 E2E 测试

#### 11.4.1 Detox 配置

```javascript
// .detoxrc.js
module.exports = {
  testRunner: 'jest',
  runnerConfig: 'e2e/config.json',
  apps: {
    'ios.release': {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Release-iphonesimulator/SyncClipboard.app',
      build: 'xcodebuild -workspace ios/SyncClipboard.xcworkspace -scheme SyncClipboard -configuration Release -sdk iphonesimulator -derivedDataPath ios/build',
    },
    'android.release': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/release/app-release.apk',
      build: 'cd android && ./gradlew assembleRelease assembleAndroidTest -DtestBuildType=release',
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: { type: 'iPhone 15' },
    },
    emulator: {
      type: 'android.emulator',
      device: { avdName: 'Pixel_5_API_31' },
    },
  },
  configurations: {
    'ios.sim.release': {
      device: 'simulator',
      app: 'ios.release',
    },
    'android.emu.release': {
      device: 'emulator',
      app: 'android.release',
    },
  },
};
```

#### 11.4.2 用户场景测试

```typescript
// e2e/sync.e2e.ts
describe('同步功能', () => {
  beforeAll(async () => {
    await device.launchApp();
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  it('应该完成首次配置流程', async () => {
    // 1. 打开设置
    await element(by.id('settings-tab')).tap();
    
    // 2. 点击添加服务器
    await element(by.id('add-server-button')).tap();
    
    // 3. 填写服务器信息
    await element(by.id('server-url-input')).typeText('http://test.com');
    await element(by.id('username-input')).typeText('test');
    await element(by.id('password-input')).typeText('test123');
    
    // 4. 测试连接
    await element(by.id('test-connection-button')).tap();
    await waitFor(element(by.text('连接成功')))
      .toBeVisible()
      .withTimeout(5000);
    
    // 5. 保存配置
    await element(by.id('save-button')).tap();
  });

  it('应该完成手动同步流程', async () => {
    // 1. 进入首页
    await element(by.id('home-tab')).tap();
    
    // 2. 点击同步按钮
    await element(by.id('sync-button')).tap();
    
    // 3. 等待同步完成
    await waitFor(element(by.id('sync-status-success')))
      .toBeVisible()
      .withTimeout(10000);
    
    // 4. 验证剪贴板内容已更新
    await expect(element(by.id('local-clipboard-content'))).toBeVisible();
  });

  it('应该能查看历史记录', async () => {
    // 1. 进入历史页面
    await element(by.id('history-tab')).tap();
    
    // 2. 等待列表加载
    await waitFor(element(by.id('history-list')))
      .toBeVisible()
      .withTimeout(3000);
    
    // 3. 点击第一条记录
    await element(by.id('history-item-0')).tap();
    
    // 4. 验证已复制到剪贴板
    await expect(element(by.text('已复制'))).toBeVisible();
  });

  it('应该能搜索历史记录', async () => {
    await element(by.id('history-tab')).tap();
    await element(by.id('search-input')).typeText('test');
    await waitFor(element(by.id('history-item-0')))
      .toBeVisible()
      .withTimeout(2000);
  });
});
```

### 11.5 性能测试

#### 11.5.1 启动性能

```typescript
// e2e/performance.e2e.ts
describe('性能测试', () => {
  it('冷启动时间应小于 3 秒', async () => {
    const startTime = Date.now();
    await device.launchApp({ newInstance: true });
    await waitFor(element(by.id('home-screen')))
      .toBeVisible()
      .withTimeout(3000);
    const launchTime = Date.now() - startTime;
    
    expect(launchTime).toBeLessThan(3000);
  });

  it('列表滚动应该流畅', async () => {
    await element(by.id('history-tab')).tap();
    await element(by.id('history-list')).scroll(500, 'down');
    // 验证没有卡顿
  });
});
```

#### 11.5.2 内存测试

```typescript
// 使用 React Native Performance 监控
import { PerformanceObserver } from 'react-native-performance';

describe('内存测试', () => {
  it('应该没有内存泄漏', async () => {
    const memoryBefore = await getMemoryUsage();
    
    // 执行操作
    for (let i = 0; i < 100; i++) {
      await SyncManager.upload();
    }
    
    const memoryAfter = await getMemoryUsage();
    const increase = memoryAfter - memoryBefore;
    
    expect(increase).toBeLessThan(50 * 1024 * 1024); // 50MB
  });
});
```

### 11.6 兼容性测试矩阵

| 平台    | 版本                  | 设备                    | 优先级 |
| ------- | --------------------- | ----------------------- | ------ |
| iOS     | 15.0+                 | iPhone SE (3rd)         | P0     |
| iOS     | 16.0+                 | iPhone 14               | P0     |
| iOS     | 17.0+                 | iPhone 15               | P0     |
| iOS     | 18.0+                 | iPhone 16 Pro           | P1     |
| Android | 10 (API 29)           | Pixel 4                 | P0     |
| Android | 11 (API 30)           | Pixel 5                 | P0     |
| Android | 12 (API 31)           | Pixel 6                 | P0     |
| Android | 13 (API 33)           | Pixel 7                 | P1     |
| Android | 14 (API 34)           | Pixel 8                 | P1     |
| Android | 小米 MIUI 13/14       | Xiaomi 13               | P1     |
| Android | 华为 HarmonyOS 3/4    | Mate 50 (如适用)        | P2     |
| Android | 三星 One UI 5/6       | Galaxy S23              | P2     |

### 11.7 测试报告

#### 11.7.1 生成覆盖率报告

```bash
# 运行测试并生成覆盖率报告
npm test -- --coverage --coverageReporters=html lcov text

# 查看报告
open coverage/index.html
```

#### 11.7.2 CI 集成

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run linter
        run: npm run lint
      
      - name: Run unit tests
        run: npm test -- --coverage
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          file: ./coverage/coverage-final.json
      
      - name: Run E2E tests (iOS)
        run: |
          npm run detox:build:ios
          npm run detox:test:ios
      
      - name: Run E2E tests (Android)
        run: |
          npm run detox:build:android
          npm run detox:test:android
```

### 11.8 测试覆盖率目标

| 测试类型 | 覆盖率目标 | 说明                     |
| -------- | ---------- | ------------------------ |
| 单元测试 | 80%+       | 核心业务逻辑必须覆盖     |
| 集成测试 | 100%       | 关键流程必须完全覆盖     |
| E2E 测试 | 主要场景   | 用户核心使用路径必须覆盖 |
| UI 测试  | 60%+       | 重要组件必须测试         |

### 11.9 测试最佳实践

1. **遵循 AAA 模式**: Arrange (准备) → Act (执行) → Assert (断言)
2. **使用有意义的测试名称**: 描述测试的目的和预期结果
3. **保持测试独立**: 每个测试应该能够独立运行
4. **Mock 外部依赖**: 使用 Mock 隔离外部服务
5. **测试边界条件**: 测试正常、异常和边界情况
6. **定期运行测试**: 在 CI/CD 中自动运行测试
7. **维护测试代码**: 测试代码也需要重构和维护

### 11.10 手动功能测试清单

> **重要提示**: 所有手动测试应在真实设备上进行，而非仅限于模拟器/模拟器。建议准备测试检查表并记录测试结果。

#### 11.10.1 测试准备

**测试环境准备**
- [ ] 准备至少一台 iOS 真机（iOS 15+）
- [ ] 准备至少一台 Android 真机（Android 10+）
- [ ] 准备测试用服务器（SyncClipboard 服务器或 WebDAV）
- [ ] 准备测试账号和密码
- [ ] 清空应用数据（首次测试）
- [ ] 检查网络连接正常

**测试数据准备**
- [ ] 准备多种类型的测试内容：
  - 短文本（< 100 字符）
  - 长文本（> 1000 字符）
  - 包含特殊字符的文本（Emoji、中文、代码）
  - 小图片（< 1MB）
  - 大图片（> 5MB）
  - 各种格式图片（JPG、PNG、GIF、WebP）
  - 文件（PDF、DOC、ZIP 等）

#### 11.10.2 首次启动与配置流程

**场景 1: 首次启动**
- [ ] 冷启动应用
- [ ] 验证启动屏幕正常显示
- [ ] 验证首页正确加载（显示空状态）
- [ ] 验证底部导航栏显示正常（三个 Tab）
- [ ] 记录启动时间（应 < 3 秒）
- [ ] 检查是否有任何崩溃或错误

**场景 2: 添加第一个服务器**
- [ ] 点击设置 Tab
- [ ] 点击"添加服务器"按钮
- [ ] 验证配置模态框正确弹出
- [ ] 测试服务器类型选择（SyncClipboard / WebDAV）
- [ ] 测试表单验证：
  - [ ] URL 必填，空值时显示错误
  - [ ] 用户名必填（SyncClipboard）
  - [ ] 密码必填（SyncClipboard）
  - [ ] URL 格式验证（必须是有效 URL）
- [ ] 填写正确的服务器信息
- [ ] 点击"测试连接"按钮
- [ ] 验证连接成功提示
- [ ] 点击"保存"按钮
- [ ] 验证服务器已添加到列表
- [ ] 验证该服务器被标记为默认服务器（绿色勾选）

**场景 3: 连接失败处理**
- [ ] 添加服务器时填写错误的 URL
- [ ] 点击"测试连接"
- [ ] 验证显示连接失败错误信息
- [ ] 验证错误信息清晰易懂
- [ ] 修复 URL 后再次测试连接成功

#### 11.10.3 剪贴板同步功能

**场景 4: 文本上传同步**
- [ ] 在设备上复制一段文本
- [ ] 打开应用首页
- [ ] 验证"本地剪贴板"卡片显示刚复制的内容
- [ ] 点击"上传"按钮（向上箭头）
- [ ] 验证显示上传中状态（加载指示器）
- [ ] 验证上传成功后状态指示器显示"同步成功"
- [ ] 验证显示最后同步时间
- [ ] 验证"远程剪贴板"卡片内容已更新
- [ ] 在桌面端检查剪贴板是否已同步

**场景 5: 文本下载同步**
- [ ] 在桌面端复制新的文本并上传
- [ ] 在手机应用点击"下载"按钮（向下箭头）
- [ ] 验证显示下载中状态
- [ ] 验证下载成功后"远程剪贴板"卡片更新
- [ ] 点击"复制"按钮
- [ ] 验证显示"已复制"提示
- [ ] 在其他应用粘贴，验证内容正确

**场景 6: 全量同步**
- [ ] 点击"同步"按钮（刷新图标）
- [ ] 验证同时下载并比对远程内容
- [ ] 如果本地和远程不同，验证冲突处理逻辑
- [ ] 验证同步完成后两个卡片状态

**场景 7: 图片同步**
- [ ] 复制一张图片到剪贴板（从相册或浏览器）
- [ ] 打开应用，验证"本地剪贴板"显示图片预览
- [ ] 点击上传，验证图片上传成功
- [ ] 下载图片，验证图片显示正确
- [ ] 点击复制，验证图片已复制到系统剪贴板
- [ ] 在其他应用粘贴，验证图片正确

**场景 8: 大文件处理**
- [ ] 复制一个大图片（> 5MB）
- [ ] 上传，验证显示上传进度
- [ ] 验证上传不会卡顿或崩溃
- [ ] 验证上传时间合理
- [ ] 下载大文件，验证下载进度
- [ ] 验证下载后内存占用正常

**场景 9: 网络异常处理**
- [ ] 关闭 WiFi 和移动数据
- [ ] 尝试上传剪贴板
- [ ] 验证显示网络错误提示
- [ ] 验证内容添加到离线队列
- [ ] 打开网络
- [ ] 验证离线队列自动重试
- [ ] 验证重试成功后清除队列

#### 11.10.4 历史记录功能

**场景 10: 历史记录查看**
- [ ] 切换到历史记录 Tab
- [ ] 验证历史列表正确加载
- [ ] 验证列表项显示正确信息：
  - [ ] 类型图标（📝 文本 / 🖼️ 图片 / 📄 文件）
  - [ ] 内容预览（文本前50字符）
  - [ ] 时间显示（刚刚 / X分钟前 / X小时前 / X天前）
  - [ ] 同步状态（已同步 / 未同步）
- [ ] 滚动列表，验证性能流畅（使用 FlashList）

**场景 11: 历史记录搜索**
- [ ] 在搜索框输入关键词
- [ ] 验证 300ms 防抖生效（不会每次输入都搜索）
- [ ] 验证搜索结果正确过滤
- [ ] 验证高亮显示搜索关键词（如果实现）
- [ ] 清空搜索，验证显示完整列表
- [ ] 搜索不存在的内容，验证显示空状态

**场景 12: 类型筛选**
- [ ] 点击"全部"筛选器
- [ ] 点击"文本"筛选器，验证只显示文本类型
- [ ] 点击"图片"筛选器，验证只显示图片类型
- [ ] 点击"文件"筛选器，验证只显示文件类型
- [ ] 验证筛选后的计数正确
- [ ] 验证筛选和搜索可以同时使用

**场景 13: 历史记录操作**
- [ ] 点击一条历史记录
- [ ] 验证快速复制到剪贴板
- [ ] 验证显示"已复制"提示
- [ ] 在其他应用粘贴，验证内容正确
- [ ] 长按一条历史记录
- [ ] iOS: 验证显示 ActionSheet
- [ ] Android: 验证显示 Modal 菜单
- [ ] 验证菜单包含选项：复制、分享、删除
- [ ] 测试"分享"功能，验证系统分享面板打开
- [ ] 测试"删除"功能，验证确认对话框
- [ ] 确认删除，验证记录被删除

**场景 14: 分页加载**
- [ ] 确保有 50+ 条历史记录
- [ ] 滚动到列表底部
- [ ] 验证显示"加载更多"指示器
- [ ] 验证自动加载下一页
- [ ] 验证新数据追加到列表
- [ ] 继续滚动，验证连续分页正常

**场景 15: 清空历史**
- [ ] 点击"清空历史"按钮
- [ ] 验证显示确认对话框
- [ ] 点击"取消"，验证不清空
- [ ] 再次点击"清空历史"
- [ ] 点击"确认"
- [ ] 验证所有历史记录被清空
- [ ] 验证显示空状态提示

#### 11.10.5 多服务器管理

**场景 16: 添加多个服务器**
- [ ] 添加第二个服务器（不同 URL）
- [ ] 验证服务器列表显示两个服务器
- [ ] 验证第一个服务器仍为默认（绿色勾选）
- [ ] 添加第三个服务器（WebDAV 类型）
- [ ] 验证列表显示三个服务器

**场景 17: 切换服务器**
- [ ] 点击第二个服务器的切换按钮
- [ ] 验证第二个服务器变为默认（绿色勾选）
- [ ] 验证第一个服务器勾选消失
- [ ] 返回首页
- [ ] 验证同步状态指示器显示新服务器信息
- [ ] 测试上传下载使用新服务器

**场景 18: 编辑服务器**
- [ ] 长按服务器列表项（或点击编辑按钮）
- [ ] 验证配置模态框打开并预填信息
- [ ] 修改服务器 URL
- [ ] 保存修改
- [ ] 验证列表更新
- [ ] 测试连接验证修改成功

**场景 19: 删除服务器**
- [ ] 删除非默认服务器
- [ ] 验证确认对话框
- [ ] 确认删除
- [ ] 验证服务器从列表移除
- [ ] 尝试删除默认服务器
- [ ] 验证提示"需要先切换到其他服务器"或自动切换到其他服务器
- [ ] 删除所有服务器
- [ ] 验证应用提示"请添加服务器"

#### 11.10.6 设置功能

**场景 20: 主题切换**
- [ ] 打开设置页面
- [ ] 验证当前主题选项被高亮
- [ ] 切换到"亮色"主题
- [ ] 验证整个应用立即切换到亮色
- [ ] 验证所有页面（首页、历史、设置）都应用新主题
- [ ] 切换到"暗色"主题
- [ ] 验证整个应用切换到暗色
- [ ] 切换到"自动"模式
- [ ] 手动切换系统主题，验证应用跟随系统
- [ ] 重启应用，验证主题设置被保存

**场景 21: 自动同步设置**（待实现）
- [ ] 开启自动同步
- [ ] 设置同步间隔（如 5 分钟）
- [ ] 验证在后台自动同步
- [ ] 关闭自动同步
- [ ] 验证不再自动同步

**场景 22: 通知设置**（待实现）
- [ ] 开启同步成功通知
- [ ] 上传剪贴板，验证显示通知
- [ ] 关闭通知
- [ ] 验证不再显示通知

#### 11.10.7 权限处理

**场景 23: iOS 剪贴板权限**
- [ ] 首次启动应用后复制内容
- [ ] 打开应用首页
- [ ] 验证 iOS 14+ 显示"已粘贴自..."横幅
- [ ] 多次访问剪贴板，验证提示正常
- [ ] 验证应用能正常读取剪贴板

**场景 24: Android 权限处理**
- [ ] 首次启动请求必要权限
- [ ] 验证权限请求对话框
- [ ] 拒绝权限，验证应用提示影响
- [ ] 重新请求权限并授权
- [ ] 验证应用正常工作

#### 11.10.8 界面交互与用户体验

**场景 25: 下拉刷新**
- [ ] 在首页下拉
- [ ] 验证显示刷新指示器
- [ ] 验证触发同步操作
- [ ] 验证刷新完成后指示器消失
- [ ] 在历史页下拉
- [ ] 验证刷新历史列表

**场景 26: 按钮状态**
- [ ] 验证上传按钮在无本地内容时禁用
- [ ] 验证下载按钮在无远程内容时禁用
- [ ] 验证同步时所有按钮显示加载状态
- [ ] 验证同步完成后按钮恢复正常

**场景 27: 消息提示**
- [ ] 触发各种操作，验证提示信息：
  - [ ] 复制成功："已复制"
  - [ ] 上传成功："上传成功"
  - [ ] 下载成功："下载成功"
  - [ ] 同步成功："同步完成"
  - [ ] 各种错误的友好提示
- [ ] 验证提示显示位置合理（底部按钮上方）
- [ ] 验证提示自动消失（3 秒后）
- [ ] 验证提示有淡入淡出动画

**场景 28: 加载状态**
- [ ] 验证首次加载显示骨架屏或加载指示器
- [ ] 验证网络请求时显示加载状态
- [ ] 验证加载状态不会无限持续
- [ ] 验证加载失败显示重试按钮

#### 11.10.9 边界情况与异常处理

**场景 29: 空内容处理**
- [ ] 清空剪贴板
- [ ] 打开应用
- [ ] 验证"本地剪贴板"显示"暂无内容"
- [ ] 验证操作按钮禁用或隐藏
- [ ] 尝试上传空内容
- [ ] 验证提示"剪贴板为空"

**场景 30: 特殊字符处理**
- [ ] 复制包含 Emoji 的文本 🎉🚀💯
- [ ] 验证正确显示和同步
- [ ] 复制包含换行的长文本
- [ ] 验证预览显示正确（最多显示 50 字符）
- [ ] 复制包含代码片段的文本
- [ ] 验证格式保留

**场景 31: 超长内容处理**
- [ ] 复制非常长的文本（> 10000 字符）
- [ ] 验证应用不崩溃
- [ ] 验证上传成功
- [ ] 验证预览截断显示
- [ ] 验证完整内容可以复制

**场景 32: 服务器错误处理**
- [ ] 停止服务器
- [ ] 尝试同步
- [ ] 验证显示连接失败错误
- [ ] 验证错误信息清晰
- [ ] 启动服务器
- [ ] 重试，验证恢复正常

**场景 33: Token 过期处理**
- [ ] 等待 Token 过期（或手动使 Token 失效）
- [ ] 尝试操作
- [ ] 验证自动重新认证
- [ ] 或验证提示需要重新登录

#### 11.10.10 性能与稳定性

**场景 34: 应用稳定性**
- [ ] 连续使用应用 30 分钟
- [ ] 验证无崩溃
- [ ] 验证无内存泄漏（通过系统监控）
- [ ] 验证无明显卡顿

**场景 35: 后台恢复**
- [ ] 打开应用
- [ ] 切换到后台（按 Home 键）
- [ ] 等待 5 分钟
- [ ] 切回应用
- [ ] 验证应用状态保持
- [ ] 验证数据未丢失

**场景 36: 应用重启**
- [ ] 强制关闭应用
- [ ] 重新打开
- [ ] 验证所有设置保持
- [ ] 验证服务器配置保持
- [ ] 验证历史记录保持
- [ ] 验证主题设置保持

**场景 37: 内存压力测试**
- [ ] 添加 100+ 条历史记录
- [ ] 滚动历史列表
- [ ] 验证性能流畅
- [ ] 验证内存占用合理
- [ ] 上传下载 20 次连续操作
- [ ] 验证无内存泄漏

#### 11.10.11 多设备协作

**场景 38: 多设备同步**
- [ ] 准备两台手机和一台电脑
- [ ] 配置相同的服务器账号
- [ ] 在设备 A 复制并上传内容
- [ ] 在设备 B 下载
- [ ] 验证内容一致
- [ ] 在设备 B 修改并上传
- [ ] 在设备 A 和电脑下载
- [ ] 验证所有设备内容一致

**场景 39: 冲突解决**
- [ ] 在两台设备离线状态下分别复制不同内容
- [ ] 设备 A 先上线并上传
- [ ] 设备 B 上线并尝试上传
- [ ] 验证冲突检测
- [ ] 验证冲突解决策略（远程优先/本地优先/提示用户）
- [ ] 选择解决方案
- [ ] 验证最终状态正确

#### 11.10.12 平台特定测试

**iOS 特定场景**
- [ ] 测试深色模式切换
- [ ] 测试动态字体大小调整
- [ ] 测试 Safe Area 适配（刘海屏）
- [ ] 测试横屏模式（如果支持）
- [ ] 测试系统分享面板集成
- [ ] 测试 3D Touch / Haptic Feedback
- [ ] 测试 iPad 适配（如果支持）

**Android 特定场景**
- [ ] 测试返回键行为
- [ ] 测试系统导航栏适配
- [ ] 测试通知渠道设置
- [ ] 测试前台服务通知
- [ ] 测试电池优化白名单
- [ ] 测试不同厂商 ROM（小米、华为、三星）
- [ ] 测试分屏模式

#### 11.10.13 测试报告模板

每次测试后填写测试报告：

**测试信息**
- 测试日期：
- 测试人员：
- 应用版本：
- 测试设备：
- 系统版本：

**测试结果统计**
- 测试场景总数：
- 通过数量：
- 失败数量：
- 阻塞问题数量：

**发现的问题**
| 编号 | 严重程度 | 场景 | 问题描述 | 复现步骤 | 截图 | 状态 |
|------|---------|------|---------|---------|------|------|
| 1    | 高      |      |         |         |      | 待修复 |

**性能指标**
- 冷启动时间：
- 热启动时间：
- 首屏渲染时间：
- 平均内存占用：
- 上传速度（1MB 文件）：
- 下载速度（1MB 文件）：

**测试结论**
- [ ] 通过，可以发布
- [ ] 有轻微问题，可以发布
- [ ] 有严重问题，需要修复后重新测试

#### 11.10.14 回归测试清单

每次版本更新后的快速回归测试（核心功能）：

- [ ] 应用正常启动
- [ ] 服务器连接正常
- [ ] 文本上传同步正常
- [ ] 文本下载同步正常
- [ ] 历史记录查看正常
- [ ] 搜索功能正常
- [ ] 多服务器切换正常
- [ ] 主题切换正常
- [ ] 无明显 UI 错位或样式问题
- [ ] 无崩溃或闪退

---

## 12. 发布与部署

### 12.1 版本管理

采用语义化版本号：`MAJOR.MINOR.PATCH`

- **MAJOR**: 不兼容的 API 变更
- **MINOR**: 向下兼容的新功能
- **PATCH**: 向下兼容的 Bug 修复

### 12.2 构建配置

#### 12.2.1 iOS 配置

```json
// app.json
{
  "expo": {
    "ios": {
      "bundleIdentifier": "com.syncclipboard.mobile",
      "buildNumber": "1",
      "supportsTablet": true,
      "infoPlist": {
        "NSUserTrackingUsageDescription": "We don't track you.",
        "UIBackgroundModes": ["fetch", "remote-notification"]
      }
    }
  }
}
```

#### 12.2.2 Android 配置

```json
{
  "expo": {
    "android": {
      "package": "com.syncclipboard.mobile",
      "versionCode": 1,
      "permissions": ["FOREGROUND_SERVICE", "RECEIVE_BOOT_COMPLETED"],
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#FFFFFF"
      }
    }
  }
}
```

### 12.3 CI/CD 流程

```yaml
# .github/workflows/build.yml
name: Build and Test

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run lint
      - run: npm test

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: expo/expo-github-action@v8
        with:
          eas-version: latest
          token: ${{ secrets.EXPO_TOKEN }}
      - run: eas build --platform all --non-interactive
```

### 12.4 发布检查清单

#### 发布前

- [ ] 所有测试通过
- [ ] 性能指标达标
- [ ] 安全审计完成
- [ ] 文档更新
- [ ] 变更日志编写

#### App Store 提交

- [ ] 应用图标和截图
- [ ] 应用描述和关键词
- [ ] 隐私政策 URL
- [ ] 支持 URL
- [ ] 测试账号

#### Google Play 提交

- [ ] 应用图标和特色图片
- [ ] 应用描述
- [ ] 隐私政策
- [ ] 内容分级
- [ ] 测试轨道发布

### 12.5 OTA 更新策略

```typescript
// 使用 Expo Updates
import * as Updates from 'expo-updates';

async function checkForUpdates() {
  try {
    const update = await Updates.checkForUpdateAsync();
    if (update.isAvailable) {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    }
  } catch (error) {
    // 处理错误
  }
}
```

**更新策略**

- 小版本更新使用 OTA
- 大版本更新引导用户去商店更新
- 强制更新用于关键安全修复

---

## 附录

### A. 技术债务管理

- 使用 GitHub Issues 跟踪技术债务
- 每个 Sprint 预留 20% 时间处理技术债务
- 定期代码审查和重构

### B. 文档维护

- API 文档使用 TSDoc
- 组件文档使用 Storybook
- 架构决策记录 (ADR)

### C. 团队协作

- 代码审查必须通过
- 分支策略: Git Flow
- Commit 规范: Conventional Commits

### D. 参考资源

- [React Native 官方文档](https://reactnative.dev/)
- [Expo 文档](https://docs.expo.dev/)
- [React Navigation 文档](https://reactnavigation.org/)
- [SyncClipboard 服务器 API](https://github.com/Jeric-X/SyncClipboard)

---

## 版本历史

| 版本  | 日期       | 变更内容                                     | 作者 |
| ----- | ---------- | -------------------------------------------- | ---- |
| 1.0.0 | 2026-02-12 | 初始版本                                     | -    |
| 1.1.0 | 2026-02-13 | 完善测试策略章节，添加详细的测试模块清单     | -    |

---

**文档状态**: ✅ 已完善测试策略  
**下一步行动**: 开始 Phase 1 测试工作
