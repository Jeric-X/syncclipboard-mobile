# 快速参考 - Quick Reference

> AI 和开发者的速查手册

---

## 🎯 用户偏好

- **语言**: 中文
- **开发方式**: Vibe Coding (AI 对话式开发)
- **代码风格**: TypeScript + 函数式优先
- **注释**: 关键逻辑必须注释
- **测试**: 核心功能需要单元测试

---

## 📂 文件路径速查

### 进度管理
```
PROJECT_STATUS.md              # 项目整体进度
SESSION_NOTES.md               # 会话记录
TODO.md                        # 任务清单
```

### 规划文档
```
DEVELOPMENT_PLAN.md            # 完整开发规划
.ai/CONTEXT.md                 # AI 上下文
.ai/QUICK_REFERENCE.md         # 本文件
```

### 服务器参考
```
c:\Nextcloud\Code\SyncClipboard\src\
  SyncClipboard.Server.Core\
    Controllers\
      SyncClipboardController.cs    # API 控制器
c:\Nextcloud\Code\SyncClipboard\docs\
  Hash.md                           # Hash 计算
c:\Nextcloud\Code\SyncClipboard\script\
  SyncAutoxJs.js                    # Android 参考
```

---

## 🔧 技术栈速查

### 核心依赖
```json
{
  "react-native": "latest",
  "expo": "~52.0.0",
  "typescript": "^5.0.0",
  "zustand": "^4.5.0",
  "@react-navigation/native": "^7.0.0",
  "axios": "^1.6.0",
  "@shopify/flash-list": "^1.6.0"
}
```

### 开发依赖
```json
{
  "@types/react": "^18.0.0",
  "eslint": "^8.0.0",
  "prettier": "^3.0.0",
  "jest": "^29.0.0",
  "@testing-library/react-native": "^12.0.0"
}
```

---

## 🌐 API 速查

### 基础配置
```typescript
const baseURL = "http://192.168.1.1:5033";
const auth = {
  username: "admin",
  password: "password"  // Basic Auth
};
```

### 主要端点
```typescript
// 获取剪贴板
GET /SyncClipboard.json
Response: ProfileDto

// 上传剪贴板
PUT /SyncClipboard.json
Body: ProfileDto

// 获取文件
GET /file/{fileName}
Response: Binary

// 上传文件
PUT /file/{fileName}
Body: Binary
```

### ProfileDto
```typescript
interface ProfileDto {
  type: "Text" | "Image" | "File" | "Group";
  hash?: string;              // SHA256 hex string
  text: string;               // 预览或完整文本
  hasData: boolean;           // 是否有额外文件
  dataName?: string;          // 文件名
  size?: number;              // 字节大小
}
```

---

## 🎨 代码模板

### React 组件
```typescript
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  title: string;
}

export const MyComponent: React.FC<Props> = ({ title }) => {
  return (
    <View style={styles.container}>
      <Text>{title}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
```

### Zustand Store
```typescript
import { create } from 'zustand';

interface State {
  count: number;
  increment: () => void;
}

export const useStore = create<State>((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
}));
```

### API Service
```typescript
import axios, { AxiosInstance } from 'axios';

export class APIService {
  private client: AxiosInstance;

  constructor(baseURL: string, username: string, password: string) {
    this.client = axios.create({
      baseURL,
      timeout: 30000,
      headers: {
        'Authorization': `Basic ${btoa(`${username}:${password}`)}`,
      },
    });
  }

  async get<T>(url: string): Promise<T> {
    const response = await this.client.get<T>(url);
    return response.data;
  }
}
```

---

## 🎯 常见任务

### 创建新页面
```typescript
// 1. 创建文件: src/screens/MyScreen.tsx
// 2. 添加到导航: app/(tabs)/_layout.tsx
// 3. 更新类型: src/types/navigation.ts
```

### 创建新 Store
```typescript
// 1. 创建文件: src/stores/myStore.ts
// 2. 定义接口
// 3. 实现 Store
// 4. 导出 hooks
```

### 创建新 Service
```typescript
// 1. 创建文件: src/services/myService.ts
// 2. 实现接口
// 3. 添加错误处理
// 4. 编写单元测试: __tests__/services/myService.test.ts
```

---

## 🐛 调试技巧

### 日志输出
```typescript
console.log('[DEBUG]', data);           // 开发
console.warn('[WARN]', warning);        // 警告
console.error('[ERROR]', error);        // 错误
```

### React Native Debugger
```bash
# 启动 Debugger
open "rndebugger://set-debugger-loc?host=localhost&port=8081"
```

### 网络调试
```typescript
// 在 API Client 中添加拦截器
this.client.interceptors.request.use(config => {
  console.log('[API Request]', config.method, config.url);
  return config;
});
```

---

## ⚡ 性能优化清单

### 列表优化
- [ ] 使用 FlashList
- [ ] memo 列表项
- [ ] 稳定的 keyExtractor
- [ ] 避免匿名函数

### 图片优化
- [ ] 使用 expo-image
- [ ] 设置缓存策略
- [ ] 压缩大图
- [ ] 懒加载

### 状态优化
- [ ] 合理拆分 Store
- [ ] 避免不必要的 re-render
- [ ] 使用 selector

---

## 📝 Git 工作流

### 提交规范
```bash
# 新功能
git commit -m "feat: 实现剪贴板上传功能"

# Bug 修复
git commit -m "fix: 修复 Android 后台同步问题"

# 文档
git commit -m "docs: 更新 API 文档"

# 重构
git commit -m "refactor: 优化同步逻辑"
```

### 分支策略
```
main          # 生产分支
develop       # 开发主分支
feature/*     # 功能分支
bugfix/*      # Bug 修复
hotfix/*      # 紧急修复
```

---

## 🧪 测试命令

```bash
# 单元测试
npm test

# 监听模式
npm test -- --watch

# 覆盖率
npm test -- --coverage

# 特定文件
npm test -- myService.test.ts
```

---

## 🚀 构建发布

```bash
# 开发构建
npx expo start

# iOS 构建
npx eas build --platform ios --profile preview

# Android 构建
npx eas build --platform android --profile preview

# 生产构建
npx eas build --platform all --profile production
```

---

## 💬 与 AI 的约定

### AI 应该：
✅ 先阅读进度文档  
✅ 主动总结当前状态  
✅ 建议下一步行动  
✅ 更新相关文档  
✅ 记录关键决策  
✅ 保持代码质量  
✅ 提供清晰的解释  

### AI 不应该：
❌ 跳过文档阅读  
❌ 忘记更新进度  
❌ 重复造轮子  
❌ 忽略错误处理  
❌ 写没有注释的复杂代码  
❌ 忽略性能问题  

---

## 📞 获取帮助

当卡住时，可以：
1. 查看 `DEVELOPMENT_PLAN.md`
2. 搜索相关代码: `grep -r "关键词"`
3. 查看服务器参考实现
4. 查阅技术文档
5. 问 AI 具体问题

---

## 🎓 提示词示例

### 继续开发
```
我继续开发 SyncClipboard Mobile 项目。
请先查看进度文档，然后告诉我当前状态和建议。
```

### 实现功能
```
请实现 [功能名称]。
要求：
1. 遵循现有架构
2. 添加错误处理
3. 编写类型定义
4. 更新相关文档
```

### 修复问题
```
[描述问题]
请帮我：
1. 诊断问题原因
2. 提供解决方案
3. 实现修复
4. 更新文档
```

### 代码审查
```
请审查 [文件路径] 的代码。
关注点：
1. 代码质量
2. 性能问题
3. 潜在 Bug
4. 最佳实践
```

---

**最后更新**: 2026-02-12
