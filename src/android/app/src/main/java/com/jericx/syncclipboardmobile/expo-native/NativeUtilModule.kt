package com.jericx.syncclipboardmobile.nativeutil

import android.net.Uri
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import java.io.File
import java.io.FileInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.channels.Channels
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class NativeUtilModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val CHUNK_SIZE = 4 * 1024 * 1024 // 4 MB
        private const val UPLOAD_BUFFER_SIZE = 8 * 1024 // 8 KB
        private const val EVENT_HASH_PROGRESS = "HashProgress"
        private const val EVENT_HASH_CANCELLED = "HashCancelled"
    }

    private val executor = Executors.newCachedThreadPool()
    private val cancelFlags = ConcurrentHashMap<String, AtomicBoolean>()

    override fun getName(): String = "NativeUtilModule"

    /**
     * 计算文件的 SHA-256 哈希，在 IO 线程异步执行，不阻塞 JS 线程。
     *
     * @param fileUri  文件路径，支持 "file://" URI 或裸路径
     * @param jobId    本次计算的唯一 ID，由 JS 侧生成，用于取消和进度事件关联
     * @param promise  计算完毕后 resolve 大写十六进制 hash 字符串；异常时 reject
     */
    @ReactMethod
    fun calculateFileHash(fileUri: String, jobId: String, promise: Promise) {
        val cancelFlag = AtomicBoolean(false)
        cancelFlags[jobId] = cancelFlag

        executor.submit {
            try {
                val path = resolveFilePath(fileUri)
                val file = File(path)

                if (!file.exists()) {
                    cancelFlags.remove(jobId)
                    promise.reject("FILE_NOT_FOUND", "File not found: $path")
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
                            emitEvent(EVENT_HASH_CANCELLED, jobId, null)
                            promise.reject("CANCELLED", "Hash calculation was cancelled")
                            return@submit
                        }

                        digest.update(buffer, 0, read)
                        bytesRead += read

                        if (totalBytes > 0) {
                            val progress = bytesRead.toDouble() / totalBytes.toDouble()
                            emitProgress(jobId, progress, bytesRead, totalBytes)
                        }
                    }
                }

                cancelFlags.remove(jobId)

                if (cancelFlag.get()) {
                    emitEvent(EVENT_HASH_CANCELLED, jobId, null)
                    promise.reject("CANCELLED", "Hash calculation was cancelled")
                    return@submit
                }

                val hashBytes = digest.digest()
                val hashHex = hashBytes.joinToString("") { "%02x".format(it) }.uppercase()
                promise.resolve(hashHex)
            } catch (e: Exception) {
                cancelFlags.remove(jobId)
                promise.reject("HASH_ERROR", e.message ?: "Unknown error", e)
            }
        }
    }

    /**
     * 取消指定 jobId 的任务（哈希计算、上传、下载）。
     */
    @ReactMethod
    fun cancelJob(jobId: String) {
        cancelFlags[jobId]?.set(true)
    }

    /**
     * Required by React Native event emitter system (no-op stubs are enough for
     * DeviceEventEmitter-based events on both old and new architecture).
     */
    @ReactMethod
    fun addListener(eventName: String) {
        // no-op – required by RN event emitter contract
    }

    @ReactMethod
    fun removeListeners(count: Double) {
        // no-op – required by RN event emitter contract
    }

    /**
     * 将源文件复制到目标 URI（支持 SAF content:// 与普通 file://）。
     * 使用 FileChannel.transferTo，由 JVM/OS 选择最优传输策略（可触发 sendfile），
     * 无需在用户态手动分配缓冲区，不把文件读入内存。
     *
     * @param srcUri  源文件（file:// URI 或裸路径）
     * @param destUri 目标文件（SAF content:// URI 或 file:// URI）
     * @param promise resolve: null  |  reject: 错误信息
     */
    @ReactMethod
    fun copyFile(srcUri: String, destUri: String, promise: Promise) {
        executor.submit {
            try {
                val srcPath = resolveFilePath(srcUri)
                val src = File(srcPath)
                if (!src.exists()) {
                    promise.reject("FILE_NOT_FOUND", "Source file not found: $srcPath")
                    return@submit
                }

                val dest = Uri.parse(destUri)
                val outputStream = reactApplicationContext.contentResolver.openOutputStream(dest)
                    ?: run {
                        promise.reject("OPEN_FAILED", "Cannot open output stream for: $destUri")
                        return@submit
                    }

                // FileChannel.transferTo 让 JVM/OS 选择最优传输策略（可能触发 sendfile 系统调用），
                // 无需在用户态手动分配缓冲区。
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
                promise.reject("COPY_ERROR", e.message ?: "Unknown error", e)
            }
        }
    }

    /**
     * 流式 PUT 上传文件到 HTTP/HTTPS 端点，不将文件内容读入 JVM 堆内存。
     *
     * 通过 setFixedLengthStreamingMode 告知 HttpURLConnection 请求体长度已知，
     * JVM 不会缓冲 request body，而是直接以 UPLOAD_BUFFER_SIZE 大小的缓冲区
     * 逐块写入 socket 发送缓冲区，内存占用为 O(bufferSize)，与文件大小无关。
     *
     * @param url     上传目标 URL（http:// 或 https://）
     * @param headers 请求头键值对（含 Authorization、Content-Type 等）
     * @param fileUri 本地文件路径（file:// URI 或裸路径）
     * @param jobId   用于取消的唯一 ID，由 JS 侧生成，调用 cancelUpload(jobId) 可中断上传
     * @param promise resolve: null  |  reject: 错误码 + 信息
     */
    @ReactMethod
    fun uploadFile(url: String, headers: ReadableMap, fileUri: String, jobId: String, promise: Promise) {
        val cancelFlag = AtomicBoolean(false)
        cancelFlags[jobId] = cancelFlag

        executor.submit {
            var connection: HttpURLConnection? = null
            try {
                val path = resolveFilePath(fileUri)
                val file = File(path)

                if (!file.exists()) {
                    cancelFlags.remove(jobId)
                    promise.reject("FILE_NOT_FOUND", "File not found: $path")
                    return@submit
                }

                connection = (URL(url).openConnection() as HttpURLConnection).apply {
                    requestMethod = "PUT"
                    doOutput = true
                    connectTimeout = 30_000
                    readTimeout = 0  // 上传大文件时不设读超时

                    setFixedLengthStreamingMode(file.length())

                    val iter = headers.keySetIterator()
                    while (iter.hasNextKey()) {
                        val key = iter.nextKey()
                        setRequestProperty(key, headers.getString(key))
                    }
                }

                connection.outputStream.use { output ->
                    FileInputStream(file).use { input ->
                        val buffer = ByteArray(UPLOAD_BUFFER_SIZE)
                        var read: Int
                        while (input.read(buffer).also { read = it } != -1) {
                            if (cancelFlag.get()) {
                                cancelFlags.remove(jobId)
                                promise.reject("CANCELLED", "Upload was cancelled")
                                return@submit
                            }
                            output.write(buffer, 0, read)
                        }
                        output.flush()
                    }
                }

                val responseCode = connection.responseCode
                cancelFlags.remove(jobId)

                if (responseCode in 200..299) {
                    promise.resolve(null)
                } else {
                    val body = try {
                        connection.errorStream?.bufferedReader()?.readText() ?: ""
                    } catch (_: Exception) { "" }
                    promise.reject("HTTP_ERROR", "HTTP $responseCode: $body")
                }
            } catch (e: Exception) {
                cancelFlags.remove(jobId)
                promise.reject("UPLOAD_ERROR", e.message ?: "Unknown error", e)
            } finally {
                connection?.disconnect()
            }
        }
    }



    /**
     * 流式 GET 下载文件从 HTTP/HTTPS 端点，不将文件内容读入 JVM 堆内存。
     *
     * 以 DOWNLOAD_BUFFER_SIZE 大小的缓冲区逐块从 socket 读取并写入本地文件，
     * 内存占用为 O(bufferSize)，与文件大小无关。
     *
     * @param url     下载目标 URL（http:// 或 https://）
     * @param headers 请求头键值对（含 Authorization 等）
     * @param fileUri 本地文件路径（file:// URI 或裸路径）
     * @param jobId   用于取消的唯一 ID，由 JS 侧生成，调用 cancelDownload(jobId) 可中断下载
     * @param promise resolve: null  |  reject: 错误码 + 信息
     */
    @ReactMethod
    fun downloadFile(url: String, headers: ReadableMap, fileUri: String, jobId: String, promise: Promise) {
        val cancelFlag = AtomicBoolean(false)
        cancelFlags[jobId] = cancelFlag

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

                    val iter = headers.keySetIterator()
                    while (iter.hasNextKey()) {
                        val key = iter.nextKey()
                        setRequestProperty(key, headers.getString(key))
                    }
                }

                val responseCode = connection.responseCode

                if (responseCode !in 200..299) {
                    cancelFlags.remove(jobId)
                    val body = try {
                        connection.errorStream?.bufferedReader()?.readText() ?: ""
                    } catch (_: Exception) { "" }
                    promise.reject("HTTP_ERROR", "HTTP $responseCode: $body")
                    return@submit
                }

                connection.inputStream.use { input ->
                    file.outputStream().use { output ->
                        val buffer = ByteArray(UPLOAD_BUFFER_SIZE)
                        var read: Int
                        while (input.read(buffer).also { read = it } != -1) {
                            if (cancelFlag.get()) {
                                cancelFlags.remove(jobId)
                                file.delete()
                                promise.reject("CANCELLED", "Download was cancelled")
                                return@submit
                            }
                            output.write(buffer, 0, read)
                        }
                        output.flush()
                    }
                }

                cancelFlags.remove(jobId)
                promise.resolve(null)
            } catch (e: Exception) {
                cancelFlags.remove(jobId)
                promise.reject("DOWNLOAD_ERROR", e.message ?: "Unknown error", e)
            } finally {
                connection?.disconnect()
            }
        }
    }



    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /**
     * Strips "file://" scheme if present and returns an absolute FS path.
     */
    private fun resolveFilePath(fileUri: String): String {
        return if (fileUri.startsWith("file://", ignoreCase = true)) {
            Uri.parse(fileUri).path ?: fileUri.removePrefix("file://")
        } else {
            fileUri
        }
    }

    private fun emitProgress(jobId: String, progress: Double, bytesRead: Long, totalBytes: Long) {
        val params = WritableNativeMap().apply {
            putString("jobId", jobId)
            putDouble("progress", progress)
            putDouble("bytesRead", bytesRead.toDouble())
            putDouble("totalBytes", totalBytes.toDouble())
        }
        emitEvent(EVENT_HASH_PROGRESS, jobId, params)
    }

    private fun emitEvent(eventName: String, jobId: String, extraParams: WritableNativeMap?) {
        val params = extraParams ?: WritableNativeMap().apply {
            putString("jobId", jobId)
        }
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }
}
