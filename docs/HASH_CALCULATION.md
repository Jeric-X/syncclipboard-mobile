# Hash 计算说明

本文档说明移动应用中使用的不同 hash 及其用途。

## Hash 类型

### 1. localHash (本地变化检测 Hash)

**计算方式**：
```typescript
localHash = SHA256(base64String)
```

**用途**：
- 快速检测剪贴板内容是否发生变化
- 用于生成临时文件名
- 本地缓存判断

**特点**：
- 计算速度快（直接对 base64 字符串计算）
- 不需要解码 base64
- 仅用于本地比较，不发送到服务器

**示例**：
```typescript
const localHash = await calculateBase64Hash(base64String);
// 结果: "a3f5d8c9e7b4..."
```

---

### 2. contentHash (文件内容 Hash)

**计算方式**：
```typescript
// 1. 将 base64 解码为二进制字节数组
const bytes = decodeBase64(base64String);

// 2. 计算二进制内容的 SHA256
contentHash = SHA256(bytes)
```

**用途**：
- 表示文件的真实二进制内容
- 用于生成最终文件名
- 服务器验证文件完整性的基础

**特点**：
- 与服务器端计算的文件内容 hash 一致
- 相同文件内容总是产生相同的 hash
- 使用 `js-sha256` 库计算以确保跨平台一致性

**示例**：
```typescript
const contentHash = await calculateBase64ContentHash(base64String);
const fileName = `${contentHash.substring(0, 16)}.png`;
// 结果: "b7e9d4a8f2c1....png"
```

---

### 3. profileHash (Profile Hash / 上传 Hash)

**计算方式**（遵循服务器规范）：
```typescript
// 1. 计算文件内容 hash
contentHash = SHA256(fileContent)

// 2. 构造组合字符串
combinedString = fileName + "|" + contentHash.toUpperCase()

// 3. 计算最终的 profile hash
profileHash = SHA256(combinedString)
```

**用途**：
- 上传到服务器的 `ProfileDto.hash` 字段
- 服务器验证文件和配置的一致性
- 确保文件名和内容的关联关系

**特点**：
- 必须严格遵循服务器规范
- contentHash 必须大写
- 包含文件名信息

**示例**：
```typescript
const contentHash = "b7e9d4a8f2c1a5d3e6f8b4c7a9d2e5f1";
const fileName = "b7e9d4a8f2c1a5d3.png";
const combinedString = `${fileName}|${contentHash.toUpperCase()}`;
const profileHash = await calculateTextHash(combinedString);
// 结果: "c4f7a9d2e5b8..."
```

---

## 完整流程示例

### 图片上传流程中的 Hash 计算

```typescript
// 1. 从剪贴板获取图片（base64 格式）
const imageData = await Clipboard.getImageAsync({ format: 'png' });
const base64String = imageData.data;

// 2. 计算本地 hash（快速比较）
const localHash = await calculateBase64Hash(base64String);
console.log('Local Hash:', localHash.substring(0, 16));
// 用于生成临时文件名和变化检测

// 3. 保存文件
const tempFileName = `${localHash.substring(0, 16)}.png`;
const tempFile = new File(TEMP_DIR, tempFileName);
tempFile.write(binaryData);

// 4. 读回文件并计算 content hash（服务器需要）
const savedBase64 = await tempFile.base64();
const contentHash = await calculateBase64ContentHash(savedBase64);
console.log('Content Hash:', contentHash);

// 5. 生成最终文件名
const finalFileName = `${contentHash.substring(0, 16)}.png`;
console.log('File Name:', finalFileName);

// 6. 计算 profile hash（上传到服务器）
const combinedString = `${finalFileName}|${contentHash.toUpperCase()}`;
const profileHash = await calculateTextHash(combinedString);
console.log('Profile Hash:', profileHash);

// 7. 构造上传数据
const profileDto = {
  type: 'Image',
  text: '[图片]',
  hash: profileHash,        // 用于服务器验证
  hasData: true,
  dataName: finalFileName,  // 文件名
  size: fileSize,
};

// 8. 上传文件和配置
await apiClient.putFile(finalFileName, fileBlob);
await apiClient.putClipboard(profileDto);
```

---

## ClipboardContent 类型中的 Hash 字段

```typescript
interface ClipboardContent {
  // ... 其他字段
  
  /** Profile Hash - 用于服务器上传 */
  hash?: string;
  
  /** Content Hash - 用于本地变化检测 */
  contentHash?: string;
}
```

### 字段说明

#### `hash` (Profile Hash)
- **格式**: `SHA256(fileName + "|" + ContentHash.toUpperCase())`
- **用途**: 上传到服务器的 `ProfileDto.hash` 字段
- **示例**: `"c4f7a9d2e5b8a3d1f6c9e4b7a2d5f8e1b4c7a9d2e5f8b1c4a7d9e2b5f8a1c4d7"`

#### `contentHash` (Local Hash)
- **格式**: `SHA256(base64String)` （快速比较）
- **用途**: 本地变化检测，判断剪贴板内容是否改变
- **示例**: `"a3f5d8c9e7b4c2a1d6f9e3b8c5a2d7f4e9b6c3a8d5f2e7b4c9a6d3f8e5b2c7a4"`

---

## 服务器 Hash 验证规范

根据服务器文档 (`docs/Hash.md`)：

### ImageProfile / FileProfile

```
ContentHash = SHA256(FileContent)
CombinedString = "FileName|" + ToUpperCase(ContentHash)
Hash = SHA256(UTF8(CombinedString))
```

**重要规则**：
1. ContentHash 必须计算文件的**二进制内容**，不是 base64 字符串
2. ContentHash 必须转换为**大写**
3. 文件名和 ContentHash 之间用 `|` 分隔
4. 最终 hash 是对组合字符串的 UTF-8 编码计算 SHA256

---

## 常见问题

### Q: 为什么需要两种 hash（localHash 和 contentHash）？

**A**: 
- `localHash` 用于快速本地比较，无需解码 base64，性能优先
- `contentHash` 用于服务器上传，必须与服务器计算方式一致，准确性优先

### Q: 为什么不能直接对 base64 字符串计算 hash 给服务器？

**A**: 
服务器会自己读取文件并计算二进制内容的 hash 来验证。如果我们上传的是 base64 字符串的 hash，服务器验证会失败，因为：
- 同一文件的 base64 表示可能不同（例如不同的换行方式）
- 服务器直接读取文件二进制，不会先转 base64
- 必须计算实际文件内容的 hash 才能与服务器匹配

### Q: 使用什么库计算 hash？

**A**:
- **文本 hash**: `expo-crypto` 的 `digestStringAsync()`
- **二进制内容 hash**: `js-sha256` 库
  - 原因：`expo-crypto` 在 Android 上不支持 ArrayBuffer
  - `js-sha256` 可以直接处理 Uint8Array，跨平台一致

---

## 相关代码

### Hash 工具函数

位置: `src/utils/hash.ts`

```typescript
// 快速本地 hash
export async function calculateBase64Hash(base64Data: string): Promise<string>

// 文件内容 hash（用于服务器）
export async function calculateBase64ContentHash(base64Data: string): Promise<string>

// 文本 hash（用于 profile hash）
export async function calculateTextHash(text: string): Promise<string>
```

### 使用示例

位置: `src/services/ClipboardManager.ts`

查看 `getImageContent()` 方法了解完整的 hash 计算流程。

---

## 总结

| Hash 类型 | 计算方式 | 用途 | 发送到服务器 |
|----------|---------|------|------------|
| localHash | SHA256(base64) | 本地变化检测 | ❌ 否 |
| contentHash | SHA256(binary) | 文件内容标识 | ⚠️ 间接（作为文件名） |
| profileHash | SHA256(fileName\|ContentHash) | 配置验证 | ✅ 是 |

**关键要点**：
- 三种 hash 服务于不同目的
- 只有 profileHash 直接上传到服务器
- contentHash 必须准确计算二进制内容才能通过服务器验证
- localHash 只用于本地优化，不影响上传
