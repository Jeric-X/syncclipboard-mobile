package expo.modules.nativeutil

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import android.provider.MediaStore
import androidx.documentfile.provider.DocumentFile
import java.io.File
import java.io.IOException
import java.io.OutputStream

/**
 * 可写入文件系统位置的统一句柄。
 *
 * 内部封装 SAF (DocumentFile) 和 MediaStore 两种写入路径，对调用方完全透明。
 * 当目标为 Downloads 根目录且 SAF 写入文件失败时，自动回退到 MediaStore API。
 *
 * 使用示例:
 * ```
 * val root = WritableLocation.fromUri(context, destUri)
 * val subdir = root?.createDirectory("subdir")
 * val stream = subdir?.createFile("hello.txt", "text/plain")
 * stream?.use { it.write(data) }
 * ```
 */
class WritableLocation internal constructor(
    private val context: Context,
    private val strategy: WriteStrategy
) {
    /** 当前是否为目录 */
    val isDirectory: Boolean get() = strategy.isDirectory
    /** 当前文件/目录名称 */
    val name: String? get() = strategy.name

    /** 检查此位置是否存在 */
    fun exists(): Boolean = strategy.exists()

    /**
     * 在此位置下创建子目录。如果目录已存在则返回已存在的目录句柄。
     * @return 子目录的 [WritableLocation]，失败返回 null
     */
    fun createDirectory(name: String, overwrite: Boolean = false): WritableLocation? {
        // 存在性检查和可写 DocumentFile 获取均在 strategy 层完成
        val child = strategy.createDirectory(context, name, overwrite) ?: return null
        return WritableLocation(context, child)
    }

    /**
     * 在此位置下查找已存在的文件或目录。
     * @return 找到的 [WritableLocation]，未找到返回 null
     */
    fun findFile(name: String): WritableLocation? {
        val child = strategy.findFile(context, name) ?: return null
        return WritableLocation(context, child)
    }

    /**
     * 在此位置下创建文件并打开输出流。
     *
     * 内部策略：
     * - 优先通过 SAF (DocumentFile) 创建文件并打开流
     * - 如果 SAF 失败且当前位置在 Downloads 目录树内，自动回退到 MediaStore API
     *
     * @param name      文件名
     * @param mimeType  MIME 类型，默认 "application/octet-stream"
     * @param overwrite 是否覆盖已存在的同名文件；false 时若存在则抛出 [IOException]
     * @return 可写入的 [OutputStream]；调用方负责 close()
     * @throws IOException 创建失败或同名文件已存在且 overwrite=false
     */
    @Throws(IOException::class)
    fun createFile(name: String, mimeType: String = "application/octet-stream", overwrite: Boolean = false): OutputStream {
        // 存在性检查和覆盖逻辑已下沉至 strategy.createFile 内部
        return strategy.createFile(context, name, mimeType, overwrite)
            ?: throw IOException("Failed to create file: $name")
    }

    /** 删除此位置对应的文件或目录 */
    fun delete(): Boolean = strategy.delete()

    companion object {
        /**
         * 根据目标 URI 创建 [WritableLocation]。
         *
         * 支持两种 URI 格式：
         * - `content://` — SAF tree URI（通过 [DocumentFile.fromTreeUri] 打开）
         * - `file://` 或纯路径 — 本地文件系统路径（通过 [DocumentFile.fromFile] 打开）
         *
         * 自动检测目标是否为 Downloads 根目录，以启用 MediaStore 回退。
         *
         * @param context Android Context
         * @param uri     目标目录 URI
         * @return 创建成功返回 [WritableLocation]，失败返回 null
         */
        fun fromUri(context: Context, uri: Uri): WritableLocation? {
            return when (uri.scheme) {
                "content" -> fromContentUri(context, uri)
                else -> fromFilePath(context, uri)
            }
        }

        private fun fromContentUri(context: Context, uri: Uri): WritableLocation? {
            val doc = DocumentFile.fromTreeUri(context, uri) ?: return null
            if (!doc.exists()) return null
            val rootDocId = DocumentsContract.getTreeDocumentId(uri)
            val strategy = SafTreeStrategy(doc, relativePath = "", treeUri = uri, rootDocId = rootDocId)
            return WritableLocation(context, strategy)
        }

        private fun fromFilePath(context: Context, uri: Uri): WritableLocation? {
            val path = uri.path ?: uri.toString().removePrefix("file://")
            val file = File(path)
            if (!file.exists() || !file.isDirectory) return null
            val doc = DocumentFile.fromFile(file)
            val strategy = FileStrategy(doc, relativePath = "", baseDir = file)
            return WritableLocation(context, strategy)
        }

    }
}

// ═══════════════════════════════════════════════════════════════════════
// 内部策略
// ═══════════════════════════════════════════════════════════════════════

/**
 * 文件写入策略接口：将底层文件系统差异（SAF vs MediaStore）封装在策略实现中。
 */
internal interface WriteStrategy {
    val isDirectory: Boolean
    val name: String?
    fun exists(): Boolean
    fun createDirectory(context: Context, name: String, overwrite: Boolean = false): WriteStrategy?
    fun findFile(context: Context, name: String): WriteStrategy?
    /**
     * 创建文件并打开输出流。内部自行处理存在性检查和覆盖逻辑。
     * @param overwrite true 时若文件已存在则直接覆盖写入；false 时若存在则抛出 [IOException]
     * @return 可写入的 [OutputStream]，创建失败返回 null
     * @throws IOException 文件已存在且 overwrite=false
     */
    @Throws(IOException::class)
    fun createFile(context: Context, name: String, mimeType: String, overwrite: Boolean): OutputStream?
    fun delete(): Boolean
}

/**
 * SAF 树 URI（content://）写入策略。
 *
 * 通过构造子文档 URI 实现零查询的文件存在性判断和覆盖写入。
 * SAF 创建失败时若位于 Downloads 目录树内则回退 MediaStore。
 */
internal class SafTreeStrategy(
    private val doc: DocumentFile,
    private val relativePath: String,
    private val treeUri: Uri,
    private val rootDocId: String
) : WriteStrategy {

    /** 当前路径是否位于 Downloads 目录树内，决定 SAF 创建失败时是否回退 MediaStore */
    private val underDownloadRoot: Boolean = run {
        val full = "$rootDocId/$relativePath".trimEnd('/')
        full.equals("primary:Download", ignoreCase = true) ||
            full.startsWith("primary:Download/", ignoreCase = true) ||
            full.equals("downloads", ignoreCase = true) ||
            full.startsWith("downloads/", ignoreCase = true)
    }

    override val isDirectory: Boolean get() = doc.isDirectory
    override val name: String? get() = doc.name
    override fun exists(): Boolean = doc.exists()

    override fun createDirectory(context: Context, name: String, overwrite: Boolean): WriteStrategy? {
        val existing = findFile(context, name)
        if (existing != null) {
            if (existing.isDirectory) {
                val writable = doc.findFile(name)
                if (writable != null && writable.isDirectory) {
                    return SafTreeStrategy(writable, "$relativePath$name/", treeUri, rootDocId)
                }
            } else if (overwrite) {
                existing.delete()
            } else {
                return null
            }
        }
        val newDir = doc.createDirectory(name) ?: return null
        return SafTreeStrategy(newDir, "$relativePath$name/", treeUri, rootDocId)
    }

    override fun findFile(context: Context, name: String): WriteStrategy? {
        val childDocId = "$rootDocId/$relativePath$name"
        val childUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, childDocId)
        val childDoc = DocumentFile.fromSingleUri(context, childUri) ?: return null
        if (!childDoc.exists()) return null
        val childPath = if (childDoc.isDirectory) "$relativePath$name/" else "$relativePath$name"
        return SafTreeStrategy(childDoc, childPath, treeUri, rootDocId)
    }

    @Throws(IOException::class)
    override fun createFile(context: Context, name: String, mimeType: String, overwrite: Boolean): OutputStream? {
        val childDocId = "$rootDocId/$relativePath$name"
        val childUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, childDocId)
        val childDoc = DocumentFile.fromSingleUri(context, childUri)
        if (childDoc != null && childDoc.exists()) {
            if (!overwrite) throw IOException("File already exists: $name")
            return try {
                context.contentResolver.openOutputStream(childUri, "wt")
            } catch (e: Exception) {
                NativeLogger.e("FileOperations", "Failed to open existing file for overwrite: '$name' at '$relativePath'", e)
                throw e
            }
        }
        try {
            val newFile = doc.createFile(mimeType, name)
            if (newFile != null) {
                val stream = context.contentResolver.openOutputStream(newFile.uri)
                if (stream != null) return stream
            }
        } catch (_: Exception) {
            NativeLogger.w("FileOperations", "SAF createFile failed for '$name' at '$relativePath'")
        }
        if (underDownloadRoot && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            NativeLogger.d("FileOperations", "Falling back to MediaStore for '$name' at '$relativePath'")
            return createFileViaMediaStore(context, name, mimeType, relativePath, overwrite)
        }
        return null
    }

    override fun delete(): Boolean = doc.delete()
}

/**
 * file:// 路径写入策略。
 *
 * 直接使用 [File] API，零 ContentResolver 查询。
 * 不需要 MediaStore 回退——app 已拥有完整文件系统权限。
 */
internal class FileStrategy(
    private val doc: DocumentFile,
    private val relativePath: String,
    private val baseDir: File
) : WriteStrategy {

    override val isDirectory: Boolean get() = doc.isDirectory
    override val name: String? get() = doc.name
    override fun exists(): Boolean = doc.exists()

    override fun createDirectory(context: Context, name: String, overwrite: Boolean): WriteStrategy? {
        val existing = findFile(context, name)
        if (existing != null) {
            if (existing.isDirectory) {
                val file = File(baseDir, "$relativePath$name")
                if (file.exists() && file.isDirectory) {
                    return FileStrategy(DocumentFile.fromFile(file), "$relativePath$name/", baseDir)
                }
            } else if (overwrite) {
                existing.delete()
            } else {
                return null
            }
        }
        val newDir = doc.createDirectory(name) ?: return null
        return FileStrategy(newDir, "$relativePath$name/", baseDir)
    }

    override fun findFile(context: Context, name: String): WriteStrategy? {
        val file = File(baseDir, "$relativePath$name")
        if (!file.exists()) return null
        val childPath = if (file.isDirectory) "$relativePath$name/" else "$relativePath$name"
        return FileStrategy(DocumentFile.fromFile(file), childPath, baseDir)
    }

    @Throws(IOException::class)
    override fun createFile(context: Context, name: String, mimeType: String, overwrite: Boolean): OutputStream? {
        val file = File(baseDir, "$relativePath$name")
        if (file.exists()) {
            if (!overwrite) throw IOException("File already exists: $name")
            file.delete()
        }
        val newFile = doc.createFile(mimeType, name) ?: return null
        return context.contentResolver.openOutputStream(newFile.uri)
    }

    override fun delete(): Boolean = doc.delete()
}

// ═══════════════════════════════════════════════════════════════════════
// MediaStore 工具函数
// ═══════════════════════════════════════════════════════════════════════

/**
 * 通过 [MediaStore.Downloads] 创建文件并返回可写入的 [OutputStream]。
 *
 * 返回的 OutputStream 在 close() 时会自动将 IS_PENDING 置为 0；
 * 若写入过程中发生异常则删除已创建的条目。
 *
 * @param relativePath 相对于 Downloads 的路径（不含 "Download/" 前缀），
 *                     末尾带 "/"，例如 "" 表示 Download/ 根目录，"subdir/" 表示 Download/subdir/
 */
internal fun createFileViaMediaStore(
    context: Context,
    fileName: String,
    mimeType: String,
    relativePath: String,
    overwrite: Boolean
): OutputStream? {
    val resolver = context.contentResolver
    val fullPath = "Download/$relativePath"

    // 检查是否已存在同名文件
    val existingUri = findMediaStoreFileByPath(resolver, fileName, fullPath)
    if (existingUri != null) {
        if (!overwrite) throw IOException("File already exists: $fileName")
        // 删除已存在的同名文件，避免重复条目
        resolver.delete(existingUri, null, null)
    }

    val values = ContentValues().apply {
        put(MediaStore.Downloads.DISPLAY_NAME, fileName)
        put(MediaStore.Downloads.MIME_TYPE, mimeType)
        put(MediaStore.Downloads.RELATIVE_PATH, fullPath)
        put(MediaStore.Downloads.IS_PENDING, 1)
    }

    val collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    val item = resolver.insert(collection, values) ?: return null

    val delegate = resolver.openOutputStream(item) ?: run {
        resolver.delete(item, null, null)
        return null
    }

    return object : OutputStream() {
        private var closed = false

        override fun write(b: Int) {
            if (closed) throw IOException("stream closed")
            delegate.write(b)
        }

        override fun write(b: ByteArray) {
            if (closed) throw IOException("stream closed")
            delegate.write(b)
        }

        override fun write(b: ByteArray, off: Int, len: Int) {
            if (closed) throw IOException("stream closed")
            delegate.write(b, off, len)
        }

        override fun flush() = delegate.flush()

        override fun close() {
            if (closed) return
            closed = true
            try {
                delegate.close()
                val updateValues = ContentValues().apply {
                    put(MediaStore.Downloads.IS_PENDING, 0)
                }
                resolver.update(item, updateValues, null, null)
            } catch (e: Exception) {
                // 写入失败时清理残留条目
                try { resolver.delete(item, null, null) } catch (_: Exception) {}
                throw e
            }
        }
    }
}

/**
 * 通过 DISPLAY_NAME + RELATIVE_PATH 查找 MediaStore.Downloads 中已存在的文件，
 * 返回其 content URI，未找到返回 null。
 */
private fun findMediaStoreFileByPath(
    resolver: android.content.ContentResolver,
    fileName: String,
    relativePath: String
): Uri? {
    val collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    val selection = "${MediaStore.Downloads.DISPLAY_NAME} = ? AND ${MediaStore.Downloads.RELATIVE_PATH} = ?"
    val selectionArgs = arrayOf(fileName, relativePath)

    resolver.query(collection, arrayOf(MediaStore.Downloads._ID), selection, selectionArgs, null)
        ?.use { cursor ->
            if (cursor.moveToFirst()) {
                val id = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Downloads._ID))
                return ContentUris.withAppendedId(collection, id)
            }
        }
    return null
}

/**
 * 通过 DISPLAY_NAME + RELATIVE_PATH 删除 MediaStore.Downloads 中已存在的文件。
 */
private fun deleteMediaStoreFileByPath(
    resolver: android.content.ContentResolver,
    fileName: String,
    relativePath: String
) {
    val existingUri = findMediaStoreFileByPath(resolver, fileName, relativePath)
    if (existingUri != null) {
        resolver.delete(existingUri, null, null)
    }
}
