# SyncClipboard Mobile

SyncClipboard 的官方 React Native 移动应用，支持 iOS 和 Android。

## 🚀 快速开始

### 安装依赖

```bash
npm install
```

### 运行开发服务器

```bash
npm start
```

### 在特定平台运行

```bash
# Android
npm run android

# iOS (需要 macOS)
npm run ios

# Web
npm run web
```

## 📁 项目结构

```
syncclipboard-mobile/
├── src/
│   ├── assets/          # 静态资源（图片、字体等）
│   ├── components/      # 可复用组件
│   ├── constants/       # 常量定义
│   ├── hooks/           # 自定义 Hooks
│   ├── navigation/      # 导航配置
│   ├── screens/         # 页面组件
│   ├── services/        # API 和业务逻辑
│   ├── stores/          # Zustand 状态管理
│   ├── types/           # TypeScript 类型定义
│   └── utils/           # 工具函数
├── App.tsx              # 应用入口
├── app.json             # Expo 配置
└── package.json
```

## 🛠️ 技术栈

- **框架**: React Native + Expo
- **语言**: TypeScript
- **状态管理**: Zustand
- **导航**: React Navigation
- **HTTP 客户端**: Axios
- **实时通信**: SignalR (@microsoft/signalr)
- **本地存储**: AsyncStorage
- **代码质量**: ESLint + Prettier

## 📝 开发命令

```bash
# 类型检查
npm run type-check

# 代码检查
npm run lint

# 自动修复代码问题
npm run lint:fix

# 格式化代码
npm run format

# 检查代码格式
npm run format:check
```

## 🎯 当前开发阶段

Phase 1 - Week 1: 项目初始化与基础架构 ✅

- [x] 初始化 Expo 项目
- [x] 配置 TypeScript、ESLint、Prettier
- [x] 搭建基础目录结构
- [x] 配置导航结构
- [x] 安装核心依赖

## ✨ 核心功能

### 剪贴板监听

- ✅ 本地剪贴板自动监听（1秒轮询）
- ✅ App 前后台切换时自动刷新

### 服务器支持

- ✅ **SyncClipboard 服务器**：基于 SignalR 的实时推送（零延迟）
- ✅ **WebDAV 服务器**：轮询模式（3秒间隔）

### 同步策略

- ✅ 智能通信模式选择
  - SyncClipboard：SignalR 实时通信 + 自动重连
  - WebDAV：定时轮询
- ✅ 后台节能：App 在后台时自动暂停轮询
- ✅ 前台恢复：切回前台时自动恢复同步

## 📚 相关文档

- [开发规划](../DEVELOPMENT_PLAN.md)
- [项目进度](../PROJECT_STATUS.md)
- [待办清单](../TODO.md)

## 📄 许可证

与主项目保持一致
