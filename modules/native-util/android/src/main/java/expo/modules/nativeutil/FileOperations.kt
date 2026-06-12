package expo.modules.nativeutil

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
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
    fun createDirectory(name: String): WritableLocation? {
        // 先查找是否已存在
        val existing = findFile(name)
        if (existing != null && existing.isDirectory) return existing
        val child = strategy.createDirectory(context, name) ?: return null
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
        val existing = findFile(name)
        if (existing != null && !existing.isDirectory) {
            if (!overwrite) throw IOException("File already exists: $name")
            existing.delete()
        }
        return strategy.createFile(context, name, mimeType)
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
            val underDownload = isUriUnderDownloadRoot(uri)
            val strategy = SafStrategy(doc, underDownload, relativePath = "")
            return WritableLocation(context, strategy)
        }

        private fun fromFilePath(context: Context, uri: Uri): WritableLocation? {
            val path = uri.path ?: uri.toString().removePrefix("file://")
            val file = File(path)
            if (!file.exists() || !file.isDirectory) return null
            val doc = DocumentFile.fromFile(file)
            val underDownload = isPathUnderDownloadRoot(file)
            val strategy = SafStrategy(doc, underDownload, relativePath = "")
            return WritableLocation(context, strategy)
        }

        // ── Downloads 根目录检测 ───────────────────────────────────────

        /**
         * 检测 content:// URI 是否指向 Downloads 根目录或其子目录。
         *
         * Downloads 根目录可能有两种 URI 形式：
         * - Downloads provider: `.../tree/downloads`
         * - External storage provider: `.../tree/primary%3ADownload`（URL decode → `primary:Download`）
         */
        private fun isUriUnderDownloadRoot(uri: Uri): Boolean {
            val path = uri.path ?: return false
            val treeMatch = Regex("/tree/([^/?#]+)", RegexOption.IGNORE_CASE).find(path)
                ?: return false
            val treeDocId = Uri.decode(treeMatch.groupValues[1])
            return treeDocId.equals("downloads", ignoreCase = true) ||
                treeDocId.equals("primary:Download", ignoreCase = true)
        }

        /**
         * 检测本地文件路径是否位于 Downloads 目录树内。
         */
        @Suppress("DEPRECATION")
        private fun isPathUnderDownloadRoot(file: File): Boolean {
            val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            return try {
                val canonical = file.canonicalPath
                val downloadsCanonical = downloadsDir.canonicalPath
                canonical == downloadsCanonical || canonical.startsWith("$downloadsCanonical/")
            } catch (_: Exception) {
                false
            }
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
    fun createDirectory(context: Context, name: String): WriteStrategy?
    fun findFile(context: Context, name: String): WriteStrategy?
    fun createFile(context: Context, name: String, mimeType: String): OutputStream?
    fun delete(): Boolean
}

/**
 * 基于 SAF (DocumentFile) 的写入策略。
 *
 * 当 [underDownloadRoot] 为 true 时，记录从 Downloads 根目录到当前位置的
 * [relativePath]，以便在 SAF 文件创建失败时通过 MediaStore API 回退。
 *
 * @property doc               当前目录的 DocumentFile
 * @property underDownloadRoot 当前位置是否位于 Downloads 目录树内
 * @property relativePath      从 Downloads 根目录到当前位置的相对路径，
 *                             不含 "Download/" 前缀，末尾带 "/"
 *                             例如: ""（根）, "subdir/", "a/b/"
 */
internal class SafStrategy(
    private val doc: DocumentFile,
    private val underDownloadRoot: Boolean,
    private val relativePath: String
) : WriteStrategy {

    override val isDirectory: Boolean get() = doc.isDirectory
    override val name: String? get() = doc.name
    override fun exists(): Boolean = doc.exists()

    override fun createDirectory(context: Context, name: String): WriteStrategy? {
        val existing = doc.findFile(name)
        if (existing != null && existing.isDirectory) {
            return SafStrategy(existing, underDownloadRoot, "$relativePath$name/")
        }
        val newDir = doc.createDirectory(name) ?: return null
        return SafStrategy(newDir, underDownloadRoot, "$relativePath$name/")
    }

    override fun findFile(context: Context, name: String): WriteStrategy? {
        val found = doc.findFile(name) ?: return null
        // 找到的文件/目录不再传递 underDownloadRoot 和 relativePath，
        // 因为 findFile 通常用于检查存在性或删除，不需要创建文件的回退路径。
        return SafStrategy(found, underDownloadRoot = false, relativePath = "")
    }

    override fun createFile(context: Context, name: String, mimeType: String): OutputStream? {
        // 1. 优先尝试 SAF (DocumentFile) 创建文件
        try {
            val newFile = doc.createFile(mimeType, name)
            if (newFile != null) {
                val stream = context.contentResolver.openOutputStream(newFile.uri)
                if (stream != null) return stream
            }
        } catch (_: Exception) {
            NativeLogger.w("FileOperations", "SAF createFile failed for '$name' at '$relativePath'")
        }

        // 2. SAF 失败：如果在 Downloads 目录树内，回退到 MediaStore
        if (underDownloadRoot && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            NativeLogger.d("FileOperations", "Falling back to MediaStore for '$name' at '$relativePath'")
            return createFileViaMediaStore(context, name, mimeType, relativePath)
        }

        return null
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
    relativePath: String
): OutputStream? {
    val resolver = context.contentResolver
    val fullPath = "Download/$relativePath"

    // 先删除已存在的同名文件，避免重复条目
    deleteMediaStoreFileByPath(resolver, fileName, fullPath)

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
 * 从 MediaStore.Downloads 中删除指定路径和文件名的文件。
 */
private fun deleteMediaStoreFileByPath(
    resolver: android.content.ContentResolver,
    fileName: String,
    relativePath: String
) {
    val collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    val selection = "${MediaStore.Downloads.DISPLAY_NAME} = ? AND ${MediaStore.Downloads.RELATIVE_PATH} = ?"
    val selectionArgs = arrayOf(fileName, relativePath)

    resolver.query(collection, arrayOf(MediaStore.Downloads._ID), selection, selectionArgs, null)
        ?.use { cursor ->
            if (cursor.moveToFirst()) {
                val id = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Downloads._ID))
                resolver.delete(collection, "${MediaStore.Downloads._ID} = ?", arrayOf(id.toString()))
            }
        }
}
