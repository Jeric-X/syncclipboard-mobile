package expo.modules.shizukuclipboard

import android.content.ComponentName
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.Binder
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.nativeutil.NativeLogger
import rikka.shizuku.Shizuku

/**
 * ShizukuClipboardModule
 *
 * 通过 Shizuku UserService 在后台读取剪贴板内容，绕过 Android 10+ 前台限制。
 * UserService 运行在 Shizuku 的进程（UID 2000/shell）中，
 * 没有隐藏 API 限制，可以自由访问 IClipboard 的方法。
 */
class ShizukuClipboardModule : Module() {

    companion object {
        private const val TAG = "ShizukuClipboard"
        private const val REQUEST_CODE_PERMISSION = 10086
    }

    private var permissionGranted = false
    private var clipboardService: IClipboardUserService? = null
    private var serviceConnected = false
    private var isBinding = false
    private var clipboardListenerRequested = false
    private val mainHandler = Handler(Looper.getMainLooper())

    // 用于 linkToDeath：UserService 进程监听此 token，当主进程死亡时自动退出
    private val callerToken = Binder()

    private val clipboardChangedCallback = object : IClipboardChangedCallback.Stub() {
        override fun onPrimaryClipChanged() {
            mainHandler.post {
                if (clipboardListenerRequested) {
                    sendEvent("onPrimaryClipChanged", emptyMap<String, Any>())
                }
            }
        }
    }

    private val userServiceArgs by lazy {
        Shizuku.UserServiceArgs(
            ComponentName(
                appContext.reactContext?.packageName ?: "com.jericx.syncclipboardmobile",
                ClipboardUserService::class.java.name
            )
        )
            .daemon(false)
            .processNameSuffix("clipboard")
            .debuggable(true)
            .version(6)
    }

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            NativeLogger.i(TAG, "UserService connected: ${name?.className}")
            isBinding = false
            if (service != null && service.pingBinder()) {
                val userService = IClipboardUserService.Stub.asInterface(service)
                if (userService == null) {
                    NativeLogger.e(TAG, "Failed to create UserService interface")
                    return
                }
                clipboardService = userService
                serviceConnected = true
                NativeLogger.i(TAG, "UserService bound successfully")
                // 传入本进程 token，使 UserService 在主进程死亡时能自动退出
                try {
                    userService.init(callerToken)
                } catch (e: Exception) {
                    NativeLogger.e(TAG, "Failed to init UserService with caller token", e)
                    invalidateUserService("init failed")
                    return
                }
                if (clipboardListenerRequested) {
                    registerClipboardListener()
                }
            } else {
                NativeLogger.e(TAG, "UserService binder is null or dead")
            }
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            NativeLogger.w(TAG, "UserService disconnected")
            isBinding = false
            clipboardService = null
            serviceConnected = false
            if (clipboardListenerRequested) sendClipboardListenerUnavailable()
        }
    }

    private val permissionResultListener =
        Shizuku.OnRequestPermissionResultListener { requestCode, grantResult ->
            if (requestCode == REQUEST_CODE_PERMISSION) {
                permissionGranted = grantResult == PackageManager.PERMISSION_GRANTED
                if (permissionGranted) {
                    bindUserService()
                }
            }
        }

    private val binderReceivedListener = Shizuku.OnBinderReceivedListener {
        NativeLogger.i(TAG, "Shizuku binder received")
        // 当 Shizuku 连接时，如果已有权限，自动绑定 UserService
        if (hasPermission()) {
            bindUserService()
        }
    }

    private val binderDeadListener = Shizuku.OnBinderDeadListener {
        NativeLogger.w(TAG, "Shizuku binder dead")
        permissionGranted = false
        clipboardService = null
        serviceConnected = false
        if (clipboardListenerRequested) sendClipboardListenerUnavailable()
    }

    private fun hasPermission(): Boolean {
        return try {
            if (!Shizuku.pingBinder()) false
            else if (Shizuku.isPreV11()) {
                val context = appContext.reactContext ?: return false
                context.checkSelfPermission("moe.shizuku.manager.permission.API_V23") ==
                    PackageManager.PERMISSION_GRANTED
            } else {
                Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED
            }
        } catch (e: Exception) {
            false
        }
    }

    private fun bindUserService() {
        if (serviceConnected || isBinding) return
        isBinding = true
        try {
            NativeLogger.i(TAG, "Binding UserService...")
            Shizuku.bindUserService(userServiceArgs, serviceConnection)
        } catch (e: Exception) {
            isBinding = false
            NativeLogger.e(TAG, "Failed to bind UserService", e)
        }
    }

    private fun isServiceAlive(service: IClipboardUserService): Boolean {
        return try {
            val binder = service.asBinder()
            binder.isBinderAlive && binder.pingBinder()
        } catch (e: Exception) {
            false
        }
    }

    /** Verifies both the UserService Binder and its connection to Android's clipboard service. */
    private fun isUserServiceHealthy(service: IClipboardUserService): Boolean {
        if (!isServiceAlive(service)) return false
        return try {
            service.isClipboardServiceHealthy()
        } catch (e: Exception) {
            NativeLogger.w(TAG, "UserService health check failed: ${e.message}")
            false
        }
    }

    /** Removes a failed UserService so the next bind starts with a fresh service record. */
    private fun invalidateUserService(reason: String) {
        NativeLogger.w(TAG, "Removing unhealthy UserService for recreation: $reason")
        clipboardService = null
        serviceConnected = false
        isBinding = false
        try {
            // Remove the server-side record as well as this process' local connection.
            Shizuku.unbindUserService(userServiceArgs, serviceConnection, true)
        } catch (e: Exception) {
            NativeLogger.w(TAG, "Failed to remove unhealthy UserService: ${e.message}")
        }
    }

    private fun unbindUserService() {
        if (!serviceConnected && !isBinding) return
        val service = clipboardService
        clipboardService = null
        serviceConnected = false
        isBinding = false
        try {
            service?.destroy()
        } catch (e: Exception) {
            NativeLogger.e(TAG, "Failed to call destroy on UserService", e)
        }
        try {
            Shizuku.unbindUserService(userServiceArgs, serviceConnection, true)
        } catch (e: Exception) {
            NativeLogger.e(TAG, "Failed to unbind UserService", e)
        }
    }

    private fun registerClipboardListener(): Boolean {
        repeat(2) { attempt ->
            val service = ensureServiceConnected() ?: return false
            try {
                if (service.setClipboardChangedCallback(clipboardChangedCallback)) return true
                NativeLogger.w(TAG, "Primary clip listener registration returned false")
            } catch (e: Exception) {
                NativeLogger.w(TAG, "Failed to register primary clip listener: ${e.message}")
            }
            if (attempt == 0) invalidateUserService("listener registration failed")
        }
        return false
    }

    private fun sendClipboardListenerUnavailable() {
        mainHandler.post {
            if (clipboardListenerRequested) {
                sendEvent("onPrimaryClipListenerUnavailable", emptyMap<String, Any>())
            }
        }
    }

    private fun ensureServiceConnected(): IClipboardUserService? {
        val currentService = clipboardService
        if (currentService != null && serviceConnected) {
            if (isUserServiceHealthy(currentService)) return currentService
            invalidateUserService("UserService health check failed")
        }
        // 尝试重新绑定
        bindUserService()
        // 等待短暂时间让连接建立
        val startTime = System.currentTimeMillis()
        while (System.currentTimeMillis() - startTime < 3000) {
            val service = clipboardService
            if (service != null && serviceConnected) {
                if (isUserServiceHealthy(service)) return service
                invalidateUserService("newly connected UserService health check failed")
                return null
            }
            Thread.sleep(100)
        }
        NativeLogger.w(TAG, "Timed out waiting for a live UserService")
        return null
    }

    private fun <T> callUserService(
        operation: String,
        fallback: T,
        block: (IClipboardUserService) -> T
    ): T {
        repeat(2) { attempt ->
            val service = ensureServiceConnected() ?: return fallback
            try {
                return block(service)
            } catch (e: Exception) {
                NativeLogger.w(
                    TAG,
                    "$operation failed on UserService (attempt ${attempt + 1}): ${e.message}"
                )
                if (attempt == 0) invalidateUserService("$operation remote call failed")
            }
        }
        return fallback
    }

    override fun definition() = ModuleDefinition {
        Name("ShizukuClipboardModule")

        Events("onPrimaryClipChanged", "onPrimaryClipListenerUnavailable")

        OnCreate {
            try {
                Shizuku.addRequestPermissionResultListener(permissionResultListener)
                Shizuku.addBinderReceivedListenerSticky(binderReceivedListener)
                Shizuku.addBinderDeadListener(binderDeadListener)
            } catch (e: Exception) {
                NativeLogger.e(TAG, "Failed to register Shizuku listeners", e)
            }
        }

        OnDestroy {
            try {
                clipboardListenerRequested = false
                unbindUserService()
                Shizuku.removeRequestPermissionResultListener(permissionResultListener)
                Shizuku.removeBinderReceivedListener(binderReceivedListener)
                Shizuku.removeBinderDeadListener(binderDeadListener)
            } catch (e: Exception) {
                NativeLogger.e(TAG, "Failed to cleanup Shizuku listeners", e)
            }
        }

        Function("isShizukuAvailable") {
            try {
                return@Function Shizuku.pingBinder()
            } catch (e: Exception) {
                return@Function false
            }
        }

        Function("hasShizukuPermission") {
            return@Function hasPermission()
        }

        Function("requestShizukuPermission") {
            try {
                if (!Shizuku.pingBinder()) return@Function false
                if (Shizuku.isPreV11()) return@Function false
                Shizuku.requestPermission(REQUEST_CODE_PERMISSION)
                return@Function true
            } catch (e: Exception) {
                NativeLogger.e(TAG, "Failed to request Shizuku permission", e)
                return@Function false
            }
        }

        AsyncFunction("getStringViaShizuku") { promise: Promise ->
            try {
                NativeLogger.i(TAG, "getStringViaShizuku: called")
                val text = callUserService("getStringViaShizuku", "") {
                    it.primaryClipText ?: ""
                }
                NativeLogger.i(TAG, "getStringViaShizuku: result length=${text.length}")
                promise.resolve(text)
            } catch (e: Exception) {
                NativeLogger.e(TAG, "getStringViaShizuku failed", e)
                promise.resolve("")
            }
        }

        AsyncFunction("hasStringViaShizuku") { promise: Promise ->
            try {
                promise.resolve(callUserService("hasStringViaShizuku", false) {
                    it.hasPrimaryClipText()
                })
            } catch (e: Exception) {
                NativeLogger.e(TAG, "hasStringViaShizuku failed", e)
                promise.resolve(false)
            }
        }

        AsyncFunction("hasImageViaShizuku") { promise: Promise ->
            try {
                promise.resolve(callUserService("hasImageViaShizuku", false) {
                    it.hasPrimaryClipImage()
                })
            } catch (e: Exception) {
                NativeLogger.e(TAG, "hasImageViaShizuku failed", e)
                promise.resolve(false)
            }
        }

        AsyncFunction("getImageUriViaShizuku") { promise: Promise ->
            try {
                val uri = callUserService("getImageUriViaShizuku", "") {
                    it.primaryClipImageUri ?: ""
                }
                promise.resolve(if (uri.isNullOrEmpty()) null else uri)
            } catch (e: Exception) {
                NativeLogger.e(TAG, "getImageUriViaShizuku failed", e)
                promise.resolve(null)
            }
        }

        AsyncFunction("startPrimaryClipChangedListener") { promise: Promise ->
            try {
                clipboardListenerRequested = true
                promise.resolve(registerClipboardListener())
            } catch (e: Exception) {
                NativeLogger.e(TAG, "Failed to start primary clip listener", e)
                promise.resolve(false)
            }
        }

        AsyncFunction("stopPrimaryClipChangedListener") { promise: Promise ->
            clipboardListenerRequested = false
            try {
                clipboardService?.clearClipboardChangedCallback()
            } catch (e: Exception) {
                NativeLogger.e(TAG, "Failed to stop primary clip listener", e)
            }
            promise.resolve(null)
        }
    }
}
