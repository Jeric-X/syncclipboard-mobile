# SyncClipboard Mobile

SyncClipboard 的移动客户端，暂时仅支持 Android

## 功能特性

### 剪贴板同步

- 支持前台模式下文本、图片、文件同步
- 通过通知栏快捷方式、桌面快捷方式、分享菜单手动调用
- 支持本地历史记录，历史记录同步将在后续版本支持

### 服务器支持

- **SyncClipboard 服务器**
- **WebDAV 服务器**

## 快速开始

### 安装依赖

```bash
npm install
```

### 生成原生项目

```bash
npm run prebuild
```

### 在特定平台运行

```bash
# Android
npm run android

# iOS（需要 macOS）
npm run ios
```

## 构建

### 本地构建 APK

```bash
npm run build:apk
```

## 项目结构

```
syncclipboard-mobile/
├── src/
│   ├── components/      # 可复用 UI 组件
│   ├── constants/       # 常量定义
│   ├── contexts/        # React Context（主题等）
│   ├── hooks/           # 自定义 Hooks
│   ├── nativeModules/   # 原生模块封装
│   ├── navigation/      # 导航配置
│   ├── screens/         # 页面组件
│   │   ├── HomeScreen             # 主页（本地/远程剪贴板）
│   │   ├── HistoryScreen          # 历史记录
│   │   ├── SettingsScreen         # 设置
│   │   ├── QuickTileLoadingScreen # 快捷磁贴触发页
│   │   └── ShareReceiveScreen     # 接收其他 App 的分享
│   ├── services/        # API 客户端与业务逻辑
│   ├── stores/          # Zustand 状态管理
│   ├── theme/           # 主题颜色定义
│   ├── types/           # TypeScript 类型定义
│   └── utils/           # 工具函数
├── plugins/             # Expo 原生配置插件
├── App.tsx              # 应用入口
├── app.json             # Expo 配置
└── package.json
```

## 技术栈

- **框架**: React Native + Expo
- **语言**: TypeScript
- **状态管理**: Zustand
- **导航**: React Navigation
- **列表渲染**: FlashList (@shopify/flash-list)
- **动画**: React Native Reanimated
- **HTTP 客户端**: Axios
- **实时通信**: SignalR (@microsoft/signalr)
- **本地存储**: AsyncStorage
- **代码质量**: ESLint + Prettier

## 开发命令

```bash
# 类型检查
npm run type-check

# 代码检查
npm run lint

# 自动修复代码问题
npm run lint:fix

# 格式化文档（JSON/Markdown）
npm run format-docs

# 检查文档格式
npm run format-docs:check

# 构建 Expo 原生插件
npm run plugin:build
```
