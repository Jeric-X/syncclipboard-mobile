# AI 上下文信息

> 这个目录专门为 AI 助手提供上下文信息，帮助 AI 快速了解项目状态

---

## 🎯 项目概况

**项目名称**: SyncClipboard Mobile  
**技术栈**: React Native + Expo + TypeScript  
**目标平台**: iOS & Android  
**开发方式**: Vibe Coding (AI 辅助开发)  
**当前阶段**: Phase 1 - 准备阶段

---

## 📚 必读文档

当 AI 开始新会话时，应该按顺序阅读以下文件：

1. **`PROJECT_STATUS.md`** - 了解当前进度和状态
2. **`SESSION_NOTES.md`** - 了解上次对话内容
3. **`TODO.md`** - 了解待办任务
4. **`DEVELOPMENT_PLAN.md`** - 了解整体规划（可选）

---

## 🗂️ 项目结构速查

```
syncclipboard-mobile/           # 移动端项目（当前）
├── PROJECT_STATUS.md           # 📍 项目进度（必读）
├── SESSION_NOTES.md            # 📍 会话笔记（必读）
├── TODO.md                     # 📍 任务清单（必读）
├── DEVELOPMENT_PLAN.md         # 📖 开发规划（详细）
├── .ai/                        # 🤖 AI 上下文目录
│   ├── CONTEXT.md             # 本文件
│   └── QUICK_REFERENCE.md     # 快速参考
└── [项目文件，待创建]

c:\Nextcloud\Code\SyncClipboard/  # 服务器项目（参考）
├── src/
│   └── SyncClipboard.Server.Core/
│       └── Controllers/        # 📍 API 控制器（重要）
├── docs/
│   └── Hash.md                # 📍 Hash 计算文档
└── script/                    # 移动端脚本参考
    └── SyncAutoxJs.js         # Android 实现参考
```

---

## 🔑 关键信息速查

### API 端点
```
GET  /SyncClipboard.json       # 获取剪贴板
PUT  /SyncClipboard.json       # 上传剪贴板
GET  /file/{fileName}          # 获取文件
PUT  /file/{fileName}          # 上传文件
GET  /api/time                 # 获取服务器时间
GET  /api/version              # 获取服务器版本
```

### 数据结构
```typescript
interface ProfileDto {
  type: 'Text' | 'Image' | 'File' | 'Group';
  hash?: string;              // SHA256
  text: string;               // 预览文本
  hasData: boolean;           // 是否有额外数据
  dataName?: string;          // 数据文件名
  size?: number;              // 文件大小
}
```

### 认证方式
```
Authorization: Basic base64(username:password)
```

---

## 🎨 开发规范

### Git Commit 格式
```
feat: 新功能
fix: 修复 Bug
docs: 文档更新
style: 代码格式
refactor: 重构
test: 测试
chore: 构建/工具
```

### 代码规范
- 使用 TypeScript
- 遵循 ESLint 规则
- 使用 Prettier 格式化
- 组件使用 PascalCase
- 函数/变量使用 camelCase
- 常量使用 UPPER_CASE

### 注释规范
```typescript
/**
 * 函数描述
 * @param param1 - 参数1说明
 * @param param2 - 参数2说明
 * @returns 返回值说明
 */
```

---

## 💡 AI 工作流程

### 1️⃣ 开始新会话
```
1. 阅读 PROJECT_STATUS.md
2. 阅读 SESSION_NOTES.md
3. 阅读 TODO.md
4. 向用户总结：
   - 上次完成了什么
   - 当前进度如何
   - 建议下一步做什么
```

### 2️⃣ 执行任务
```
1. 从 TODO.md 选择任务
2. 查看相关文档和代码
3. 实现功能
4. 编写测试
5. 更新文档
```

### 3️⃣ 结束会话
```
1. 更新 PROJECT_STATUS.md
   - 更新"最后更新"日期
   - 更新任务状态
   - 添加开发日志
2. 更新 SESSION_NOTES.md
   - 记录本次会话内容
   - 记录关键决策
   - 记录遗留问题
3. 更新 TODO.md
   - 标记完成的任务
   - 添加新发现的任务
4. 提醒用户提交 Git
```

---

## 🚨 重要提醒

### ⚠️ 每次必须做的事
- [ ] 阅读进度文档
- [ ] 更新任务状态
- [ ] 记录工作日志
- [ ] 保持上下文连续性

### ✅ 代码质量检查
- [ ] 类型定义完整
- [ ] 错误处理完善
- [ ] 性能考虑充分
- [ ] 遵循最佳实践
- [ ] 添加必要注释

### 📝 文档同步
- [ ] 代码变更后更新文档
- [ ] 新功能添加到 TODO
- [ ] 技术决策记录到 SESSION_NOTES
- [ ] Bug 记录到 PROJECT_STATUS

---

## 🔧 常用命令

```bash
# 查看项目状态
cat PROJECT_STATUS.md

# 查看待办任务
cat TODO.md

# 查看会话记录
cat SESSION_NOTES.md

# 搜索代码
grep -r "关键词" src/

# Git 提交
git add .
git commit -m "feat: 描述"
git push
```

---

## 📖 学习资源

- [React Native 文档](https://reactnative.dev/)
- [Expo 文档](https://docs.expo.dev/)
- [TypeScript 手册](https://www.typescriptlang.org/docs/)
- [Zustand 文档](https://docs.pmnd.rs/zustand/)
- [FlashList 文档](https://shopify.github.io/flash-list/)

---

## 🤝 与用户沟通

### 询问决策时
- 提供 2-3 个选项
- 说明每个选项的优缺点
- 推荐一个选项并说明理由

### 报告进度时
- 说明完成了什么
- 说明遇到了什么问题
- 说明下一步计划

### 请求反馈时
- 明确说明需要反馈的内容
- 提供具体的上下文
- 设定合理的期望

---

**AI 提示**: 在每次会话开始时，可以说：

> "我继续开发 SyncClipboard Mobile。让我先查看项目状态..."  
> [读取文档]  
> "根据记录，上次我们完成了 [X]，当前进度是 [Y%]。  
> 建议接下来 [做Z]。你想继续这个任务，还是有其他需求？"

