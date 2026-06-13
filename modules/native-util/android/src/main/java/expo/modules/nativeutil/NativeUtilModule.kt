package expo.modules.nativeutil

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.webkit.MimeTypeMap
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.OutputStream
import androidx.core.content.FileProvider
import java.net.HttpURLConnection
import java.net.URL
import java.nio.channels.Channels
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class NativeUtilModule : Module() {
    companion object {
        private const val CHUNK_SIZE = 4 * 1024 * 1024
        private const val UPLOAD_BUFFER_SIZE = 8 * 1024
        private const val EVENT_HASH_PROGRESS = "onHashProgress"
        private const val EVENT_UPLOAD_PROGRESS = "onUploadProgress"
        private const val EVENT_DOWNLOAD_PROGRESS = "onDownloadProgress"
        private const val EVENT_ZIP_PROGRESS = "onZipProgress"
        private const val EVENT_COPY_PROGRESS = "onCopyProgress"

        private fun guessMimeType(fileName: String): String {
            val extension = fileName.substringAfterLast('.', "").lowercase()
            return if (extension.isNotEmpty()) {
                MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
                    ?: "application/octet-stream"
            } else {
                "application/octet-stream"
            }
        }

        /**
         * Zip Slip 防护：检查 zip 条目名是否安全。
         * 拒绝包含 `..` 路径段、反斜杠、或以 `/` 开头的条目名，
         * 防止恶意 zip 文件通过路径遍历将文件写入目标目录之外。
         */
        private fun isSafeZipEntry(entryName: String): Boolean {
            // 拒绝空名称
            if (entryName.isEmpty()) return false
            // 拒绝绝对路径
            if (entryName.startsWith("/")) return false
            // 拒绝包含反斜杠的路径（zip 规范使用正斜杠）
            if (entryName.contains("\\")) return false
            // 拒绝包含 ".." 路径段的条目，防止路径遍历 (Zip Slip)
            val parts = entryName.split("/")
            for (part in parts) {
                if (part == "..") return false
            }
            return true
        }
    }

    private val executor = Executors.newCachedThreadPool()
    private val cancelFlags = ConcurrentHashMap<String, AtomicBoolean>()
    private val pendingJobs = ConcurrentHashMap<String, CompletableFuture<Any>>()

    override fun definition() = ModuleDefinition {
        Name("NativeUtilModule")

        Events(EVENT_HASH_PROGRESS, EVENT_UPLOAD_PROGRESS, EVENT_DOWNLOAD_PROGRESS, EVENT_ZIP_PROGRESS, EVENT_COPY_PROGRESS)

        Function("moveTaskToBack") {
            appContext.currentActivity?.moveTaskToBack(true) ?: false
            true
        }

        Function("calculateStringMD5Base64") { data: String ->
            val digest = MessageDigest.getInstance("MD5")
            val hashBytes = digest.digest(data.toByteArray(Charsets.UTF_8))
            Base64.getEncoder().encodeToString(hashBytes)
        }

        Function("startCalculateFileMD5Base64") { fileUri: String ->
            val jobId = UUID.randomUUID().toString()
            val cancelFlag = AtomicBoolean(false)
            cancelFlags[jobId] = cancelFlag
            val future = CompletableFuture<Any>()
            pendingJobs[jobId] = future

            executor.submit {
                try {
                    val path = resolveFilePath(fileUri)
                    val file = File(path)

                    if (!file.exists()) {
                        cancelFlags.remove(jobId)
                        future.complete(FileNotFoundException(path))
                        return@submit
                    }

                    val digest = MessageDigest.getInstance("MD5")
                    val buffer = ByteArray(CHUNK_SIZE)

                    FileInputStream(file).use { stream ->
                        var read: Int
                        while (stream.read(buffer).also { read = it } != -1) {
                            if (cancelFlag.get()) {
                                cancelFlags.remove(jobId)
                                future.complete(CancelledException())
                                return@submit
                            }
                            digest.update(buffer, 0, read)
                        }
                    }

                    cancelFlags.remove(jobId)

                    if (cancelFlag.get()) {
                        future.complete(CancelledException())
                        return@submit
                    }

                    val hashBytes = digest.digest()
                    val base64 = Base64.getEncoder().encodeToString(hashBytes)
                    future.complete(base64)
                } catch (e: Exception) {
                    cancelFlags.remove(jobId)
                    future.complete(HashErrorException(e.message ?: "Unknown error", e))
                }
            }

            return@Function jobId
        }

        Function("startCalculateFileHash") { fileUri: String ->
            val jobId = UUID.randomUUID().toString()
            val cancelFlag = AtomicBoolean(false)
            cancelFlags[jobId] = cancelFlag
            val future = CompletableFuture<Any>()
            pendingJobs[jobId] = future

            executor.submit {
                try {
                    val path = resolveFilePath(fileUri)
                    val file = File(path)

                    if (!file.exists()) {
                        cancelFlags.remove(jobId)
                        future.complete(FileNotFoundException(path))
                        return@submit
                    }

                    val totalBytes = file.length()
                    val digest = MessageDigest.getInstance("SHA-256")
                    val buffer = ByteArray(CHUNK_SIZE)
                    var bytesRead = 0L

                    FileInputStream(file).use { stream ->
                        var read: Int
                        while (stream.read(buffer).also { read = it } != -1) {
                            if (cancelFlag.get()) {
                                cancelFlags.remove(jobId)
                                future.complete(CancelledException())
                                return@submit
                            }

                            digest.update(buffer, 0, read)
                            bytesRead += read

                            if (totalBytes > 0) {
                                val progress = bytesRead.toDouble() / totalBytes.toDouble()
                                sendEvent(EVENT_HASH_PROGRESS, mapOf(
                                    "progress" to progress,
                                    "bytesRead" to bytesRead.toDouble(),
                                    "totalBytes" to totalBytes.toDouble()
                                ))
                            }
                        }
                    }

                    cancelFlags.remove(jobId)

                    if (cancelFlag.get()) {
                        future.complete(CancelledException())
                        return@submit
                    }

                    val hashBytes = digest.digest()
                    val hashHex = hashBytes.joinToString("") { "%02x".format(it) }.uppercase()
                    future.complete(hashHex)
                } catch (e: Exception) {
                    cancelFlags.remove(jobId)
                    future.complete(HashErrorException(e.message ?: "Unknown error", e))
                }
            }

            return@Function jobId
        }

        AsyncFunction("waitForJob") { jobId: String, promise: Promise ->
            val future = pendingJobs.remove(jobId)
            if (future == null) {
                promise.reject(JobNotFoundException(jobId))
                return@AsyncFunction
            }

            executor.submit {
                try {
                    val result = future.get()
                    when (result) {
                        is String -> promise.resolve(result)
                        is CodedException -> promise.reject(result)
                        else -> promise.reject(UnexpectedResultException(result?.javaClass?.simpleName ?: "null"))
                    }
                } catch (e: Exception) {
                    promise.reject(WaitForJobException(e.message ?: "Unknown error", e))
                }
            }
        }

        AsyncFunction("cancelJob") { jobId: String ->
            cancelFlags[jobId]?.set(true)
        }

        Function("startCopyFileToDirectory") { srcUri: String, directoryUri: String, fileName: String, overwrite: Boolean ->
            val jobId = UUID.randomUUID().toString()
            val cancelFlag = AtomicBoolean(false)
            cancelFlags[jobId] = cancelFlag
            val future = CompletableFuture<Any>()
            pendingJobs[jobId] = future

            executor.submit {
                try {
                    val srcPath = resolveFilePath(srcUri)
                    val src = File(srcPath)
                    if (!src.exists()) {
                        cancelFlags.remove(jobId)
                        future.complete(FileNotFoundException(srcPath))
                        return@submit
                    }

                    val resolvedName = fileName.ifEmpty { src.name }

                    val context = appContext.reactContext ?: run {
                        cancelFlags.remove(jobId)
                        future.complete(CodedException("Context not available"))
                        return@submit
                    }

                    val destUri = Uri.parse(directoryUri)
                    val root = WritableLocation.fromUri(context, destUri)
                        ?: run {
                            cancelFlags.remove(jobId)
                            future.complete(CodedException("Destination directory does not exist: $directoryUri"))
                            return@submit
                        }

                    // createFile 内部自动处理 SAF → MediaStore 回退
                    // overwrite=false 且同名文件存在时抛出 IOException
                    val output = root.createFile(resolvedName, guessMimeType(resolvedName), overwrite)

                    output.use { out ->
                        FileInputStream(src).channel.use { srcChannel ->
                            val destChannel = Channels.newChannel(out)
                            val size = srcChannel.size()
                            var bytesCopied = 0L
                            var lastReportTime = 0L

                            while (bytesCopied < size) {
                                if (cancelFlag.get()) {
                                    cancelFlags.remove(jobId)
                                    future.complete(CancelledException())
                                    return@submit
                                }

                                val chunkSize = minOf(size - bytesCopied, CHUNK_SIZE.toLong())
                                val transferred = srcChannel.transferTo(bytesCopied, chunkSize, destChannel)
                                bytesCopied += transferred

                                val currentTime = System.currentTimeMillis()
                                if (currentTime - lastReportTime >= 500) {
                                    lastReportTime = currentTime
                                    val progress = if (size > 0) {
                                        minOf(1.0, bytesCopied.toDouble() / size.toDouble())
                                    } else {
                                        1.0
                                    }
                                    sendEvent(EVENT_COPY_PROGRESS, mapOf(
                                        "jobId" to jobId,
                                        "progress" to progress,
                                        "bytesCopied" to bytesCopied.toDouble(),
                                        "totalBytes" to size.toDouble()
                                    ))
                                }
                            }
                        }
                    }

                    cancelFlags.remove(jobId)
                    sendEvent(EVENT_COPY_PROGRESS, mapOf(
                        "jobId" to jobId,
                        "progress" to 1.0,
                        "bytesCopied" to src.length().toDouble(),
                        "totalBytes" to src.length().toDouble()
                    ))
                    future.complete("success")
                } catch (e: Exception) {
                    NativeLogger.e("NativeCopyFileToDirectory", "Copy file failed", e)
                    cancelFlags.remove(jobId)
                    future.complete(CodedException(e.message ?: "Unknown error"))
                }
            }

            return@Function jobId
        }

        AsyncFunction("copyFile") { srcUri: String, destUri: String, promise: Promise ->
            executor.submit {
                try {
                    val srcPath = resolveFilePath(srcUri)
                    val src = File(srcPath)
                    if (!src.exists()) {
                        promise.reject(FileNotFoundException(srcPath))
                        return@submit
                    }

                    val dest = Uri.parse(destUri)
                    val outputStream = appContext.reactContext?.contentResolver?.openOutputStream(dest)
                        ?: run {
                            promise.reject(OpenFailedException(destUri))
                            return@submit
                        }

                    FileInputStream(src).channel.use { srcChannel ->
                        outputStream.use { output ->
                            val destChannel = Channels.newChannel(output)
                            var position = 0L
                            val size = srcChannel.size()
                            while (position < size) {
                                position += srcChannel.transferTo(position, size - position, destChannel)
                            }
                        }
                    }

                    promise.resolve(null)
                } catch (e: Exception) {
                    promise.reject(CopyErrorException(e.message ?: "Unknown error", e))
                }
            }
        }

        Function("startZipFiles") { fileUris: List<String>, destUri: String ->
            val jobId = UUID.randomUUID().toString()
            val cancelFlag = AtomicBoolean(false)
            cancelFlags[jobId] = cancelFlag
            val future = CompletableFuture<Any>()
            pendingJobs[jobId] = future

            executor.submit {
                try {
                    val files = fileUris.map { File(resolveFilePath(it)) }
                    val nonExistent = files.firstOrNull { !it.exists() }
                    if (nonExistent != null) {
                        cancelFlags.remove(jobId)
                        future.complete(FileNotFoundException(nonExistent.absolutePath))
                        return@submit
                    }

                    val totalBytes = files.sumOf { it.length() }
                    var bytesWritten = 0L
                    var lastReportTime = 0L
                    val buffer = ByteArray(UPLOAD_BUFFER_SIZE)

                    val dest = Uri.parse(destUri)
                    val outputStream = if (dest.scheme == "file") {
                        val path = dest.path ?: destUri.removePrefix("file://")
                        FileOutputStream(path)
                    } else {
                        appContext.reactContext?.contentResolver?.openOutputStream(dest)
                            ?: run {
                                cancelFlags.remove(jobId)
                                future.complete(OpenFailedException(destUri))
                                return@submit
                            }
                    }

                    ZipOutputStream(outputStream).use { zipOut ->
                        for (file in files) {
                            if (cancelFlag.get()) {
                                cancelFlags.remove(jobId)
                                future.complete(CancelledException())
                                return@submit
                            }

                            val entry = ZipEntry(file.name)
                            zipOut.putNextEntry(entry)

                            FileInputStream(file).use { input ->
                                var read: Int
                                while (input.read(buffer).also { read = it } != -1) {
                                    if (cancelFlag.get()) {
                                        cancelFlags.remove(jobId)
                                        future.complete(CancelledException())
                                        return@submit
                                    }
                                    zipOut.write(buffer, 0, read)
                                    bytesWritten += read

                                    val currentTime = System.currentTimeMillis()
                                    if (currentTime - lastReportTime >= 500) {
                                        lastReportTime = currentTime
                                        val progress = if (totalBytes > 0) {
                                            bytesWritten.toDouble() / totalBytes.toDouble()
                                        } else {
                                            -1.0
                                        }
                                        sendEvent(EVENT_ZIP_PROGRESS, mapOf(
                                            "jobId" to jobId,
                                            "progress" to progress,
                                            "bytesWritten" to bytesWritten.toDouble(),
                                            "totalBytes" to totalBytes.toDouble()
                                        ))
                                    }
                                }
                            }
                            zipOut.closeEntry()
                        }
                    }

                    cancelFlags.remove(jobId)
                    val progress = if (totalBytes > 0) 1.0 else -1.0
                    sendEvent(EVENT_ZIP_PROGRESS, mapOf(
                        "jobId" to jobId,
                        "progress" to progress,
                        "bytesWritten" to bytesWritten.toDouble(),
                        "totalBytes" to totalBytes.toDouble()
                    ))
                    future.complete("success")
                } catch (e: Exception) {
                    cancelFlags.remove(jobId)
                    future.complete(ZipErrorException(e.message ?: "Unknown error", e))
                }
            }

            return@Function jobId
        }

        Function("startUnzipFile") { zipUri: String, destDirUri: String ->
            val jobId = UUID.randomUUID().toString()
            val cancelFlag = AtomicBoolean(false)
            cancelFlags[jobId] = cancelFlag
            val future = CompletableFuture<Any>()
            pendingJobs[jobId] = future

            executor.submit {
                try {
                    val context = appContext.reactContext
                    if (context == null) {
                        cancelFlags.remove(jobId)
                        future.complete(ZipErrorException("No context available"))
                        return@submit
                    }

                    val zipFile = File(resolveFilePath(zipUri))
                    if (!zipFile.exists()) {
                        cancelFlags.remove(jobId)
                        future.complete(FileNotFoundException(zipFile.absolutePath))
                        return@submit
                    }

                    // 预计算解压后总大小（未压缩），用于准确进度展示
                    // ZipEntry.size 在未知时可能为 -1，需过滤并回退
                    val totalBytes = try {
                        java.util.zip.ZipFile(zipFile).use { zf ->
                            zf.entries().asSequence().sumOf { if (it.size > 0) it.size else 0L }
                        }.takeIf { it > 0 } ?: zipFile.length()
                    } catch (e: Exception) {
                        zipFile.length() // 回退到压缩文件大小
                    }
                    var bytesRead = 0L
                    var lastReportTime = 0L
                    val buffer = ByteArray(CHUNK_SIZE)

                    // 使用 WritableLocation 统一处理 SAF 和 MediaStore 写入路径
                    // 内部自动检测 Downloads 根目录并在 SAF 失败时回退到 MediaStore
                    val destUri = Uri.parse(destDirUri)
                    val root = WritableLocation.fromUri(context, destUri)

                    if (root == null || !root.exists()) {
                        cancelFlags.remove(jobId)
                        future.complete(ZipErrorException("Destination directory does not exist"))
                        return@submit
                    }

                    // 已创建目录的缓存，key 为相对于 root 的路径（如 "a/b/c"），避免重复 SAF findFile 调用
                    val createdDirs = HashMap<String, WritableLocation>()

                    java.util.zip.ZipInputStream(FileInputStream(zipFile)).use { zipIn ->
                        var entry: java.util.zip.ZipEntry?
                        while (zipIn.nextEntry.also { entry = it } != null) {
                            if (cancelFlag.get()) {
                                cancelFlags.remove(jobId)
                                future.complete(CancelledException())
                                return@submit
                            }

                            val entryName = entry!!.name
                            val isDirectory = entry!!.isDirectory
                            if (BuildConfig.DEBUG) {
                                android.util.Log.d("NativeUnzip", "Processing entry: $entryName, isDir: $isDirectory")
                            }

                            // Zip Slip 防护：拒绝包含 ..、反斜杠、或以 / 开头的条目名，
                            // 防止恶意 zip 文件将内容写入目标目录之外的位置。
                            if (!isSafeZipEntry(entryName)) {
                                android.util.Log.w("NativeUnzip", "Skipping unsafe zip entry: $entryName")
                                zipIn.closeEntry()
                                continue
                            }

                            // 解析路径并导航/创建父目录层级（利用缓存避免重复 SAF 调用）
                            val pathParts = entryName.split("/")
                            var current: WritableLocation = root
                            val dirPath = StringBuilder()

                            for (i in 0 until pathParts.size - 1) {
                                val dirName = pathParts[i]
                                if (dirName.isEmpty()) continue

                                if (dirPath.isNotEmpty()) dirPath.append("/")
                                dirPath.append(dirName)
                                val dirPathStr = dirPath.toString()

                                // 先从缓存获取，命中则直接使用，避免 SAF findFile
                                var subDir = createdDirs[dirPathStr]
                                if (subDir == null) {
                                    subDir = current.createDirectory(dirName, overwrite = true)
                                    if (subDir == null) {
                                        if (BuildConfig.DEBUG) {
                                            android.util.Log.e("NativeUnzip", "Failed to create dir: $dirName")
                                        }
                                        cancelFlags.remove(jobId)
                                        future.complete(ZipErrorException("Failed to create directory: $dirName"))
                                        return@submit
                                    }
                                    createdDirs[dirPathStr] = subDir
                                }
                                current = subDir
                            }

                            if (isDirectory) {
                                // 纯目录条目：确保目录被创建
                                val dirName = pathParts.last()
                                if (dirName.isNotEmpty()) {
                                    if (dirPath.isNotEmpty()) dirPath.append("/")
                                    dirPath.append(dirName)
                                    val dirPathStr = dirPath.toString()
                                    if (!createdDirs.containsKey(dirPathStr)) {
                                        val created = current.createDirectory(dirName, overwrite = true)
                                        if (created != null) {
                                            createdDirs[dirPathStr] = created
                                        }
                                    }
                                }
                            } else {
                                // 文件条目
                                val fileName = pathParts.last()
                                if (BuildConfig.DEBUG) {
                                    android.util.Log.d("NativeUnzip", "Creating file: $fileName")
                                }

                                // createFile 内部已通过 URI 构造 + getType 判断存在性，跳过 findFile 遍历
                                val output = current.createFile(fileName, guessMimeType(fileName), overwrite = true)

                                output.use { out ->
                                    var read: Int
                                    while (zipIn.read(buffer).also { read = it } != -1) {
                                        if (cancelFlag.get()) {
                                            cancelFlags.remove(jobId)
                                            future.complete(CancelledException())
                                            return@submit
                                        }
                                        out.write(buffer, 0, read)
                                        bytesRead += read

                                        val currentTime = System.currentTimeMillis()
                                        if (currentTime - lastReportTime >= 500) {
                                            lastReportTime = currentTime
                                            val progress = if (totalBytes > 0) {
                                                minOf(1.0, bytesRead.toDouble() / totalBytes.toDouble())
                                            } else {
                                                -1.0
                                            }
                                            sendEvent(EVENT_ZIP_PROGRESS, mapOf(
                                                "jobId" to jobId,
                                                "progress" to progress,
                                                "bytesWritten" to bytesRead.toDouble(),
                                                "totalBytes" to totalBytes.toDouble()
                                            ))
                                        }
                                    }
                                }
                            }
                            zipIn.closeEntry()
                        }
                    }

                    cancelFlags.remove(jobId)
                    val progress = if (totalBytes > 0) 1.0 else -1.0
                    sendEvent(EVENT_ZIP_PROGRESS, mapOf(
                        "jobId" to jobId,
                        "progress" to progress,
                        "bytesWritten" to bytesRead.toDouble(),
                        "totalBytes" to totalBytes.toDouble()
                    ))
                    future.complete("success")
                } catch (e: Exception) {
                    NativeLogger.e("NativeUnzip", "Unzip failed", e)
                    cancelFlags.remove(jobId)
                    future.complete(ZipErrorException(e.message ?: "Unknown error", e))
                }
            }

            return@Function jobId
        }

        Function("startUploadFile") { url: String, headers: Map<String, String>, fileUri: String ->
            val jobId = UUID.randomUUID().toString()
            val cancelFlag = AtomicBoolean(false)
            cancelFlags[jobId] = cancelFlag
            val future = CompletableFuture<Any>()
            pendingJobs[jobId] = future

            executor.submit {
                var connection: HttpURLConnection? = null
                try {
                    val path = resolveFilePath(fileUri)
                    val file = File(path)

                    if (!file.exists()) {
                        cancelFlags.remove(jobId)
                        future.complete(FileNotFoundException(path))
                        return@submit
                    }

                    connection = (URL(url).openConnection() as HttpURLConnection).apply {
                        requestMethod = "PUT"
                        doOutput = true
                        connectTimeout = 30_000
                        readTimeout = 0

                        setFixedLengthStreamingMode(file.length())

                        headers.forEach { (key, value) ->
                            setRequestProperty(key, value)
                        }
                    }

                    connection.outputStream.use { output ->
                        FileInputStream(file).use { input ->
                            val buffer = ByteArray(UPLOAD_BUFFER_SIZE)
                            var read: Int
                            var bytesWritten = 0L
                            val totalBytes = file.length()
                            var lastReportTime = 0L
                            while (input.read(buffer).also { read = it } != -1) {
                                if (cancelFlag.get()) {
                                    cancelFlags.remove(jobId)
                                    future.complete(CancelledException())
                                    return@submit
                                }
                                output.write(buffer, 0, read)
                                bytesWritten += read

                                val currentTime = System.currentTimeMillis()
                                if (currentTime - lastReportTime >= 1000) {
                                    lastReportTime = currentTime
                                    val progress = if (totalBytes > 0) {
                                        bytesWritten.toDouble() / totalBytes.toDouble()
                                    } else {
                                        -1.0
                                    }
                                    sendEvent(EVENT_UPLOAD_PROGRESS, mapOf(
                                        "jobId" to jobId,
                                        "progress" to progress,
                                        "bytesWritten" to bytesWritten.toDouble(),
                                        "totalBytes" to totalBytes.toDouble()
                                    ))
                                }
                            }
                            output.flush()

                            val progress = if (totalBytes > 0) 1.0 else -1.0
                            sendEvent(EVENT_UPLOAD_PROGRESS, mapOf(
                                "jobId" to jobId,
                                "progress" to progress,
                                "bytesWritten" to bytesWritten.toDouble(),
                                "totalBytes" to totalBytes.toDouble()
                            ))
                        }
                    }

                    val responseCode = connection.responseCode
                    cancelFlags.remove(jobId)

                    if (responseCode in 200..299) {
                        future.complete("success")
                    } else {
                        val body = try {
                            connection.errorStream?.bufferedReader()?.readText() ?: ""
                        } catch (_: Exception) { "" }
                        future.complete(HttpErrorException(responseCode, body))
                    }
                } catch (e: Exception) {
                    cancelFlags.remove(jobId)
                    future.complete(UploadErrorException(e.message ?: "Unknown error", e))
                } finally {
                    connection?.disconnect()
                }
            }

            return@Function jobId
        }

        Function("startDownloadFile") { url: String, headers: Map<String, String>, fileUri: String ->
            val jobId = UUID.randomUUID().toString()
            val cancelFlag = AtomicBoolean(false)
            cancelFlags[jobId] = cancelFlag
            val future = CompletableFuture<Any>()
            pendingJobs[jobId] = future

            executor.submit {
                var connection: HttpURLConnection? = null
                try {
                    val path = resolveFilePath(fileUri)
                    val file = File(path)
                    val parentDir = file.parentFile

                    if (parentDir != null && !parentDir.exists()) {
                        parentDir.mkdirs()
                    }

                    connection = (URL(url).openConnection() as HttpURLConnection).apply {
                        requestMethod = "GET"
                        connectTimeout = 30_000
                        readTimeout = 0

                        headers.forEach { (key, value) ->
                            setRequestProperty(key, value)
                        }
                    }

                    val responseCode = connection.responseCode

                    if (responseCode !in 200..299) {
                        cancelFlags.remove(jobId)
                        val body = try {
                            connection.errorStream?.bufferedReader()?.readText() ?: ""
                        } catch (_: Exception) { "" }
                        future.complete(HttpErrorException(responseCode, body))
                        return@submit
                    }

                    connection.inputStream.use { input ->
                        file.outputStream().use { output ->
                            val buffer = ByteArray(UPLOAD_BUFFER_SIZE)
                            var read: Int
                            var bytesRead = 0L
                            val totalBytes = connection.contentLengthLong
                            var lastReportTime = 0L
                            while (input.read(buffer).also { read = it } != -1) {
                                if (cancelFlag.get()) {
                                    cancelFlags.remove(jobId)
                                    file.delete()
                                    future.complete(CancelledException())
                                    return@submit
                                }
                                output.write(buffer, 0, read)
                                bytesRead += read

                                val currentTime = System.currentTimeMillis()
                                if (currentTime - lastReportTime >= 1000) {
                                    lastReportTime = currentTime
                                    val progress = if (totalBytes > 0) {
                                        bytesRead.toDouble() / totalBytes.toDouble()
                                    } else {
                                        -1.0
                                    }
                                    sendEvent(EVENT_DOWNLOAD_PROGRESS, mapOf(
                                        "jobId" to jobId,
                                        "progress" to progress,
                                        "bytesRead" to bytesRead.toDouble(),
                                        "totalBytes" to totalBytes.toDouble()
                                    ))
                                }
                            }
                            output.flush()

                            val progress = if (totalBytes > 0) 1.0 else -1.0
                            sendEvent(EVENT_DOWNLOAD_PROGRESS, mapOf(
                                "jobId" to jobId,
                                "progress" to progress,
                                "bytesRead" to bytesRead.toDouble(),
                                "totalBytes" to totalBytes.toDouble()
                            ))
                        }
                    }

                    cancelFlags.remove(jobId)
                    future.complete("success")
                } catch (e: Exception) {
                    cancelFlags.remove(jobId)
                    future.complete(DownloadErrorException(e.message ?: "Unknown error", e))
                } finally {
                    connection?.disconnect()
                }
            }

            return@Function jobId
        }

        Function("startUploadMultipart") { url: String, headers: Map<String, String>, formFields: Map<String, String>, fileUri: String? ->
            val jobId = UUID.randomUUID().toString()
            val cancelFlag = AtomicBoolean(false)
            cancelFlags[jobId] = cancelFlag
            val future = CompletableFuture<Any>()
            pendingJobs[jobId] = future

            executor.submit {
                var connection: HttpURLConnection? = null
                try {
                    val boundary = "----NativeUtilFormBoundary${System.currentTimeMillis()}"
                    val CRLF = "\r\n"
                    val boundaryBytes = "--$boundary".toByteArray(Charsets.UTF_8)
                    val endBoundary = "--$boundary--$CRLF".toByteArray(Charsets.UTF_8)

                    // 计算总内容长度
                    var contentLength = 0L
                    for ((name, value) in formFields) {
                        val partHeader = "Content-Disposition: form-data; name=\"$name\"$CRLF$CRLF$value$CRLF"
                        contentLength += boundaryBytes.size + CRLF.length + partHeader.toByteArray(Charsets.UTF_8).size
                    }

                    var file: File? = null
                    var filePartHeader: String? = null

                    if (fileUri != null) {
                        val path = resolveFilePath(fileUri)
                        file = File(path)

                        if (!file.exists()) {
                            cancelFlags.remove(jobId)
                            future.complete(FileNotFoundException(path))
                            return@submit
                        }

                        val fileName = file.name
                        filePartHeader = "Content-Disposition: form-data; name=\"data\"; filename=\"$fileName\"${CRLF}Content-Type: application/octet-stream${CRLF}${CRLF}"
                        contentLength += boundaryBytes.size + CRLF.length + filePartHeader.toByteArray(Charsets.UTF_8).size
                        contentLength += file.length()
                        contentLength += CRLF.length + endBoundary.size
                    } else {
                        contentLength += endBoundary.size
                    }

                    var totalBytesWritten = 0L
                    var lastReportTime = 0L

                    connection = (URL(url).openConnection() as HttpURLConnection).apply {
                        requestMethod = "POST"
                        doOutput = true
                        connectTimeout = 30_000
                        readTimeout = 0
                        setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
                        headers.forEach { (key, value) ->
                            setRequestProperty(key, value)
                        }
                        // 使用固定长度流模式，避免缓冲整个请求体
                        setFixedLengthStreamingMode(contentLength)
                    }

                    connection.outputStream.use { output ->
                        fun writePart(name: String, value: String) {
                            val partHeader = "Content-Disposition: form-data; name=\"$name\"$CRLF$CRLF$value$CRLF"
                            output.write(boundaryBytes)
                            output.write(CRLF.toByteArray(Charsets.UTF_8))
                            output.write(partHeader.toByteArray(Charsets.UTF_8))
                            totalBytesWritten += boundaryBytes.size + CRLF.length + partHeader.toByteArray(Charsets.UTF_8).size
                        }

                        for ((name, value) in formFields) {
                            writePart(name, value)
                        }

                        if (file != null && filePartHeader != null) {
                            output.write(boundaryBytes)
                            output.write(CRLF.toByteArray(Charsets.UTF_8))
                            output.write(filePartHeader.toByteArray(Charsets.UTF_8))
                            totalBytesWritten += boundaryBytes.size + CRLF.length + filePartHeader.toByteArray(Charsets.UTF_8).size

                            FileInputStream(file).use { input ->
                                val buffer = ByteArray(UPLOAD_BUFFER_SIZE)
                                var read: Int
                                while (input.read(buffer).also { read = it } != -1) {
                                    if (cancelFlag.get()) {
                                        cancelFlags.remove(jobId)
                                        future.complete(CancelledException())
                                        return@submit
                                    }
                                    output.write(buffer, 0, read)
                                    totalBytesWritten += read

                                    val currentTime = System.currentTimeMillis()
                                    if (currentTime - lastReportTime >= 1000) {
                                        lastReportTime = currentTime
                                        val progress = if (contentLength > 0) {
                                            totalBytesWritten.toDouble() / contentLength.toDouble()
                                        } else {
                                            -1.0
                                        }
                                        sendEvent(EVENT_UPLOAD_PROGRESS, mapOf(
                                            "jobId" to jobId,
                                            "progress" to progress,
                                            "bytesWritten" to totalBytesWritten.toDouble(),
                                            "totalBytes" to contentLength.toDouble()
                                        ))
                                    }
                                }
                            }

                            output.write(CRLF.toByteArray(Charsets.UTF_8))
                            totalBytesWritten += CRLF.length
                        }

                        output.write(endBoundary)
                        output.flush()
                        totalBytesWritten += endBoundary.size

                        sendEvent(EVENT_UPLOAD_PROGRESS, mapOf(
                            "jobId" to jobId,
                            "progress" to 1.0,
                            "bytesWritten" to contentLength.toDouble(),
                            "totalBytes" to contentLength.toDouble()
                        ))
                    }

                    val responseCode = connection.responseCode
                    cancelFlags.remove(jobId)

                    if (responseCode in 200..299) {
                        future.complete("success")
                    } else {
                        val body = try {
                            connection.errorStream?.bufferedReader()?.readText() ?: ""
                        } catch (_: Exception) { "" }
                        future.complete(HttpErrorException(responseCode, body))
                    }
                } catch (e: Exception) {
                    cancelFlags.remove(jobId)
                    future.complete(UploadErrorException(e.message ?: "Unknown error", e))
                } finally {
                    connection?.disconnect()
                }
            }

            return@Function jobId
        }

        Function("isIgnoringBatteryOptimizations") {
            val context = appContext.reactContext ?: return@Function false
            val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
                ?: return@Function false
            pm.isIgnoringBatteryOptimizations(context.packageName)
        }

        Function("requestIgnoreBatteryOptimizations") {
            val context = appContext.reactContext ?: return@Function false
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:${context.packageName}")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            try {
                context.startActivity(intent)
                true
            } catch (_: Exception) {
                false
            }
        }

        Function("setExcludeFromRecents") { exclude: Boolean ->
            val activity = appContext.currentActivity ?: return@Function false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                val am = activity.getSystemService(Context.ACTIVITY_SERVICE) as? android.app.ActivityManager
                    ?: return@Function false
                am.appTasks.firstOrNull()?.setExcludeFromRecents(exclude)
                true
            } else {
                false
            }
        }

        Function("getSupportedAbis") {
            Build.SUPPORTED_ABIS.toList()
        }

        AsyncFunction("saveClipboardImageToFile") { destDirPath: String, promise: Promise ->
            executor.submit {
                try {
                    val context = appContext.reactContext
                    if (context == null) {
                        promise.resolve(null)
                        return@submit
                    }
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                    if (clipboard == null) {
                        promise.resolve(null)
                        return@submit
                    }
                    val clip = clipboard.primaryClip
                    if (clip == null || clip.itemCount == 0) {
                        promise.resolve(null)
                        return@submit
                    }
                    val item = clip.getItemAt(0)
                    val uri = item.uri
                    if (uri == null) {
                        promise.resolve(null)
                        return@submit
                    }
                    val mimeType = context.contentResolver.getType(uri)
                    if (mimeType == null || !mimeType.startsWith("image/")) {
                        promise.resolve(null)
                        return@submit
                    }
                    val inputStream = context.contentResolver.openInputStream(uri)
                    if (inputStream == null) {
                        promise.resolve(null)
                        return@submit
                    }
                    // 根据 mimeType 确定扩展名
                    val ext = when {
                        mimeType.contains("png") -> "png"
                        mimeType.contains("jpeg") || mimeType.contains("jpg") -> "jpg"
                        mimeType.contains("gif") -> "gif"
                        mimeType.contains("webp") -> "webp"
                        mimeType.contains("bmp") -> "bmp"
                        else -> "png"
                    }
                    val dirPath = resolveFilePath(destDirPath)
                    val dir = File(dirPath)
                    dir.mkdirs()
                    val fileName = "tmp_${System.currentTimeMillis()}_${(Math.random() * 100000).toInt()}.$ext"
                    val file = File(dir, fileName)
                    FileOutputStream(file).use { fos ->
                        inputStream.copyTo(fos, bufferSize = 8192)
                    }
                    inputStream.close()
                    // 仅读取尺寸（不分配像素内存）
                    val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeFile(file.absolutePath, opts)
                    promise.resolve(mapOf(
                        "width" to (opts.outWidth),
                        "height" to (opts.outHeight),
                        "filePath" to "file://" + file.absolutePath,
                        "mimeType" to mimeType
                    ))
                } catch (e: Exception) {
                    NativeLogger.e("NativeUtilModule", "saveClipboardImageToFile failed", e)
                    promise.resolve(null)
                }
            }
        }

        AsyncFunction("setClipboardImageFromFile") { fileUri: String, promise: Promise ->
            executor.submit {
                try {
                    val context = appContext.reactContext
                    if (context == null) {
                        NativeLogger.e("NativeUtilModule", "setClipboardImageFromFile: context is null")
                        promise.resolve(false)
                        return@submit
                    }
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                    if (clipboard == null) {
                        NativeLogger.e("NativeUtilModule", "setClipboardImageFromFile: clipboard is null")
                        promise.resolve(false)
                        return@submit
                    }
                    val srcPath = resolveFilePath(fileUri)
                    val srcFile = File(srcPath)
                    NativeLogger.d("NativeUtilModule", "setClipboardImageFromFile: srcPath=$srcPath exists=${srcFile.exists()} size=${srcFile.length()}")
                    if (!srcFile.exists()) {
                        NativeLogger.e("NativeUtilModule", "setClipboardImageFromFile: src file not found: $srcPath")
                        promise.resolve(false)
                        return@submit
                    }
                    // 推断 mimeType
                    val ext = srcFile.extension.lowercase()
                    val mimeType = when (ext) {
                        "png" -> "image/png"
                        "jpg", "jpeg" -> "image/jpeg"
                        "gif" -> "image/gif"
                        "webp" -> "image/webp"
                        "bmp" -> "image/bmp"
                        else -> "image/png"
                    }
                    // 复制文件到 NativeUtilFileProvider 缓存目录
                    val cacheDir = File(context.cacheDir, ".native_util_clipboard")
                    cacheDir.mkdirs()
                    // 清除旧缓存
                    cacheDir.listFiles()?.forEach { it.delete() }
                    val destFile = File(cacheDir, srcFile.name)
                    srcFile.copyTo(destFile, overwrite = true)
                    NativeLogger.d("NativeUtilModule", "setClipboardImageFromFile: copied to ${destFile.absolutePath} size=${destFile.length()}")
                    // 通过 NativeUtilFileProvider 获取 content:// URI
                    val authority = context.applicationInfo.packageName + ".NativeUtilFileProvider"
                    NativeLogger.d("NativeUtilModule", "setClipboardImageFromFile: authority=$authority")
                    val contentUri = FileProvider.getUriForFile(context, authority, destFile)
                    NativeLogger.d("NativeUtilModule", "setClipboardImageFromFile: contentUri=$contentUri")
                    val clip = ClipData.newUri(context.contentResolver, "image", contentUri)
                    clip.description.extras = android.os.PersistableBundle().apply {
                        putStringArray("android.content.extra.MIME_TYPES", arrayOf(mimeType))
                    }
                    clipboard.setPrimaryClip(clip)
                    promise.resolve(true)
                } catch (e: Exception) {
                    NativeLogger.e("NativeUtilModule", "setClipboardImageFromFile failed", e)
                    promise.resolve(false)
                }
            }
        }

    }

    private fun resolveFilePath(fileUri: String): String {
        return if (fileUri.startsWith("file://", ignoreCase = true)) {
            Uri.parse(fileUri).path ?: fileUri.removePrefix("file://")
        } else {
            fileUri
        }
    }
}

class JobNotFoundException(jobId: String) : CodedException("Job not found: $jobId")

class FileNotFoundException(path: String) : CodedException("File not found: $path")

class OpenFailedException(uri: String) : CodedException("Cannot open output stream for: $uri")

class CopyErrorException(message: String, cause: Throwable? = null) : CodedException(message, cause)

class HashErrorException(message: String, cause: Throwable? = null) : CodedException(message, cause)

class CancelledException : CodedException("Operation was cancelled")

class HttpErrorException(statusCode: Int, body: String) : CodedException("HTTP $statusCode: $body")

class UploadErrorException(message: String, cause: Throwable? = null) : CodedException(message, cause)

class DownloadErrorException(message: String, cause: Throwable? = null) : CodedException(message, cause)

class UnexpectedResultException(type: String) : CodedException("Unexpected result type: $type")

class WaitForJobException(message: String, cause: Throwable? = null) : CodedException(message, cause)

class ZipErrorException(message: String, cause: Throwable? = null) : CodedException(message, cause)
