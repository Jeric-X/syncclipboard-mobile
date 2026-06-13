package com.jericx.syncclipboardmobile.share

import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import expo.modules.nativeutil.NativeLogger
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import com.jericx.syncclipboardmobile.BuildConfig
import expo.modules.ReactActivityDelegateWrapper

/**
 * Transparent Activity for Android share intent.
 * Receives shared content (text, files, images) via SEND intent and renders
 * a semi-transparent overlay for uploading without showing the main app UI.
 * Reuses QuickActionApp component with shareMode parameter.
 */
class ShareActivity : ReactActivity() {

    companion object {
        private const val TAG = "ShareActivity"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(null)
    }

    override fun getMainComponentName(): String = "quickAction"

    override fun createReactActivityDelegate(): ReactActivityDelegate {
        return ReactActivityDelegateWrapper(
            this,
            BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
            object : DefaultReactActivityDelegate(
                this,
                mainComponentName,
                fabricEnabled
            ) {
                override fun getLaunchOptions(): Bundle? {
                    val isDarkMode = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
                    
                    // Parse share intent and pass directly to JS
                    val shareData = parseShareIntent(intent)
                    logIntentDetails(intent, shareData)
                    
                    return Bundle().apply {
                        putBoolean("shareMode", true)
                        putString("systemTheme", if (isDarkMode) "dark" else "light")
                        putBundle("shareData", shareData)
                    }
                }
            }
        )
    }

    /**
     * Parse share intent and extract data.
     * Handles both text shares and file shares (including .txt files).
     */
    private fun parseShareIntent(intent: Intent?): Bundle {
        if (intent == null) return Bundle()
        
        val type = intent.type
        val action = intent.action
        
        NativeLogger.d(TAG, "Parsing intent: action=$action, type=$type")
        
        return when (action) {
            Intent.ACTION_SEND -> parseSendAction(intent, type)
            Intent.ACTION_SEND_MULTIPLE -> parseSendMultipleAction(intent, type)
            else -> Bundle()
        }
    }

    private fun parseSendAction(intent: Intent, type: String?): Bundle {
        val bundle = Bundle()
        
        // Check if it's a text share
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)
        if (text != null) {
            NativeLogger.d(TAG, "Text share: $text")
            bundle.putString("type", "text")
            bundle.putString("text", text)
            bundle.putString("mimeType", type ?: "text/plain")
            return bundle
        }
        
        // Check if it's a file share
        val uri = intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        if (uri != null) {
            NativeLogger.d(TAG, "File share URI: $uri")
            
            // Copy file to cache directory
            val copiedFile = copyUriToCache(uri, type)
            if (copiedFile != null) {
                NativeLogger.d(TAG, "File copied to: ${copiedFile.absolutePath}")
                bundle.putString("type", "file")
                bundle.putString("uri", "file://${copiedFile.absolutePath}")
                bundle.putString("mimeType", type ?: "application/octet-stream")
                bundle.putString("fileName", copiedFile.name)
                return bundle
            } else {
                NativeLogger.e(TAG, "Failed to copy file from URI: $uri")
                return bundle
            }
        }
        
        NativeLogger.w(TAG, "No text or file found in SEND intent")
        return bundle
    }

    private fun parseSendMultipleAction(intent: Intent, type: String?): Bundle {
        val uris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
        if (uris.isNullOrEmpty()) {
            NativeLogger.w(TAG, "No files found in SEND_MULTIPLE intent")
            return Bundle()
        }

        NativeLogger.d(TAG, "Multiple files share: ${uris.size} files")

        // Copy all files to cache directory and collect per-file metadata
        // 同名文件去重：跟踪已使用的文件名，冲突时追加 " (1)", " (2)" 等后缀
        val copiedPaths = ArrayList<String>()
        val fileNames = ArrayList<String>()
        val usedNames = HashMap<String, Int>()

        for (uri in uris) {
            var fileName = getFileName(uri, type)

            // 去重：如果文件名已被使用，追加数字后缀
            val count = usedNames[fileName]
            if (count != null) {
                usedNames[fileName] = count + 1
                val dotIndex = fileName.lastIndexOf('.')
                if (dotIndex > 0) {
                    fileName = "${fileName.substring(0, dotIndex)} (${count + 1})${fileName.substring(dotIndex)}"
                } else {
                    fileName = "$fileName (${count + 1})"
                }
            } else {
                usedNames[fileName] = 1
            }

            val copiedFile = copyUriToCache(uri, type, fileName)
            if (copiedFile != null) {
                copiedPaths.add("file://${copiedFile.absolutePath}")
                fileNames.add(fileName)
            }
        }

        if (copiedPaths.isEmpty()) {
            NativeLogger.e(TAG, "Failed to copy any files")
            return Bundle()
        }

        val bundle = Bundle()
        bundle.putString("type", "multiple")
        bundle.putStringArrayList("uris", copiedPaths)
        bundle.putStringArrayList("fileNames", fileNames)
        bundle.putString("mimeType", type ?: "application/octet-stream")
        return bundle
    }

    /**
     * Copy content from URI to cache directory.
     * Returns the copied file, or null if failed.
     */
    private fun copyUriToCache(uri: Uri, mimeType: String?, desiredName: String? = null): File? {
        return try {
            // Open input stream from content provider
            val inputStream: InputStream? = contentResolver.openInputStream(uri)
            if (inputStream == null) {
                NativeLogger.e(TAG, "Cannot open input stream for URI: $uri")
                return null
            }
            
            // Get file name from URI or generate one (use desiredName if provided for dedup)
            val fileName = desiredName ?: getFileName(uri, mimeType)
            
            // Create file in cache directory
            val cacheDir = cacheDir
            val outputFile = File(cacheDir, fileName)
            
            // Copy content
            FileOutputStream(outputFile).use { outputStream ->
                inputStream.use { input ->
                    val buffer = ByteArray(8192)
                    var bytesRead: Int
                    while (input.read(buffer).also { bytesRead = it } != -1) {
                        outputStream.write(buffer, 0, bytesRead)
                    }
                }
            }
            
            NativeLogger.d(TAG, "File copied successfully: ${outputFile.absolutePath} (${outputFile.length()} bytes)")
            outputFile
        } catch (e: Exception) {
            NativeLogger.e(TAG, "Error copying file from URI: $uri", e)
            null
        }
    }

    /**
     * Get file name from URI or generate one based on mime type.
     */
    private fun getFileName(uri: Uri, mimeType: String?): String {
        // Try to get file name from content resolver
        val cursor = contentResolver.query(uri, null, null, null, null)
        cursor?.use {
            if (it.moveToFirst()) {
                val displayNameIndex = it.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                if (displayNameIndex != -1) {
                    val displayName = it.getString(displayNameIndex)
                    if (!displayName.isNullOrEmpty()) {
                        return displayName
                    }
                }
            }
        }
        
        // Fallback: generate file name from URI path
        val path = uri.path
        if (!path.isNullOrEmpty()) {
            val fileName = path.substringAfterLast('/')
            if (fileName.isNotEmpty()) {
                return fileName
            }
        }
        
        // Last resort: generate unique file name with extension
        val extension = getExtensionFromMimeType(mimeType)
        return "shared_${System.currentTimeMillis()}$extension"
    }

    /**
     * Get file extension from mime type.
     */
    private fun getExtensionFromMimeType(mimeType: String?): String {
        if (mimeType == null) return ""
        
        return when (mimeType) {
            "text/plain" -> ".txt"
            "text/html" -> ".html"
            "text/css" -> ".css"
            "text/javascript" -> ".js"
            "application/json" -> ".json"
            "application/xml" -> ".xml"
            "application/pdf" -> ".pdf"
            "application/zip" -> ".zip"
            "image/jpeg" -> ".jpg"
            "image/png" -> ".png"
            "image/gif" -> ".gif"
            "image/webp" -> ".webp"
            "image/svg+xml" -> ".svg"
            "video/mp4" -> ".mp4"
            "audio/mpeg" -> ".mp3"
            else -> {
                val parts = mimeType.split("/")
                if (parts.size == 2) ".${parts[1]}" else ""
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun logIntentDetails(intent: Intent?, shareData: Bundle) {
        if (intent == null) return
        
        NativeLogger.d(TAG, "=== Share Intent Details ===")
        NativeLogger.d(TAG, "Action: ${intent.action}")
        NativeLogger.d(TAG, "Type: ${intent.type}")
        NativeLogger.d(TAG, "Flags: ${intent.flags}")
        
        // Log extras
        val extras = intent.extras
        if (extras != null) {
            NativeLogger.d(TAG, "Extras count: ${extras.size()}")
            for (key in extras.keySet()) {
                val value = extras.get(key)
                NativeLogger.d(TAG, "Extra[$key]: $value (type: ${value?.javaClass?.simpleName})")
            }
        } else {
            NativeLogger.d(TAG, "No extras")
        }
        
        // Log parsed data
        NativeLogger.d(TAG, "Parsed share data: $shareData")
        NativeLogger.d(TAG, "===========================")
    }
}
