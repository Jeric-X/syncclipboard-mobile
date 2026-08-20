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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

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
        private const val CONNECTION_TIMEOUT_SECONDS = 3L
    }

    private var permissionGranted = false
    @Volatile
    private var clipboardService: IClipboardUserService? = null
    @Volatile
    private var serviceConnected = false
    @Volatile
    private var isBinding = false
    @Volatile
    private var clipboardListenerRequested = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private val connectionStateLock = Any()
    private val listenerRegistrationLock = Any()
    @Volatile
    private var connectionLatch = CountDownLatch(0)

    // UserService 使用此 token 监听 App 进程死亡，只清理该客户端的回调资源。
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
            // App 进程退出后保留 UserService，下次启动直接复用，
            // 避免快速重启时的“销毁旧进程—创建新进程”竞态。
            .daemon(true)
            .processNameSuffix("clipboard")
            .debuggable(true)
            .version(8)
    }

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            NativeLogger.i(TAG, "UserService connected: ${name?.className}")
            if (service != null && service.pingBinder()) {
                val userService = IClipboardUserService.Stub.asInterface(service)
                if (userService == null) {
                    NativeLogger.e(TAG, "Failed to create UserService interface")
                    markConnectionFailed()
                    return
                }
                try {
                    // 先建立客户端死亡监听，再公布连接，避免剪贴板回调
                    // 注册在 init 之前抢先执行。
                    userService.init(callerToken)
                } catch (e: Exception) {
                    NativeLogger.e(TAG, "Failed to initialize UserService client lifecycle", e)
                    resetUserServiceConnection("client lifecycle init failed")
                    if (clipboardListenerRequested) sendClipboardListenerUnavailable()
                    return
                }
                synchronized(connectionStateLock) {
                    clipboardService = userService
                    serviceConnected = true
                    isBinding = false
                    connectionLatch.countDown()
                }
                NativeLogger.i(TAG, "UserService bound successfully")
                if (clipboardListenerRequested) {
                    restoreClipboardListenerAfterConnection(userService)
                }
            } else {
                NativeLogger.e(TAG, "UserService binder is null or dead")
                markConnectionFailed()
            }
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            NativeLogger.w(TAG, "UserService disconnected")
            markConnectionFailed()
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
        // 当 Shizuku 连接时，如果已有权限，绑定或复用 daemon UserService。
        if (hasPermission()) {
            bindUserService()
        }
    }

    private val binderDeadListener = Shizuku.OnBinderDeadListener {
        NativeLogger.w(TAG, "Shizuku binder dead")
        permissionGranted = false
        markConnectionFailed()
        if (clipboardListenerRequested) sendClipboardListenerUnavailable()
    }

    /** Publishes a disconnected state and wakes any waiting async operation. */
    private fun markConnectionFailed() {
        synchronized(connectionStateLock) {
            clipboardService = null
            serviceConnected = false
            isBinding = false
            connectionLatch.countDown()
        }
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

    /** Starts one bind attempt and returns the latch shared by concurrent callers. */
    private fun bindUserService(): CountDownLatch? {
        synchronized(connectionStateLock) {
            if (serviceConnected) return null
            if (isBinding) return connectionLatch

            isBinding = true
            val latch = CountDownLatch(1)
            connectionLatch = latch
            try {
                NativeLogger.i(TAG, "Binding UserService...")
                Shizuku.bindUserService(userServiceArgs, serviceConnection)
            } catch (e: Exception) {
                isBinding = false
                latch.countDown()
                NativeLogger.e(TAG, "Failed to bind UserService", e)
            }
            return latch
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

    /**
     * Drops only this App process' client connection. The daemon UserService is retained and can
     * be rebound without racing a remote process teardown.
     */
    private fun resetUserServiceConnection(reason: String) {
        NativeLogger.w(TAG, "Resetting UserService client connection: $reason")
        synchronized(connectionStateLock) {
            clipboardService = null
            serviceConnected = false
            isBinding = false
            connectionLatch.countDown()
            try {
                Shizuku.unbindUserService(userServiceArgs, serviceConnection, false)
            } catch (e: Exception) {
                NativeLogger.w(TAG, "Failed to reset UserService connection: ${e.message}")
            }
        }
    }

    /** Detaches this module while allowing the daemon UserService to survive App shutdown. */
    private fun disconnectUserService() {
        synchronized(connectionStateLock) {
            if (!serviceConnected && !isBinding) return
            val service = clipboardService
            clipboardService = null
            serviceConnected = false
            isBinding = false
            connectionLatch.countDown()
            try {
                service?.clearClipboardChangedCallback(callerToken)
            } catch (e: Exception) {
                NativeLogger.w(
                    TAG,
                    "Failed to clear UserService listener while disconnecting: ${e.message}"
                )
            }
            try {
                Shizuku.unbindUserService(userServiceArgs, serviceConnection, false)
            } catch (e: Exception) {
                NativeLogger.e(TAG, "Failed to unbind UserService", e)
            }
        }
    }

    private fun tryRegisterClipboardListener(service: IClipboardUserService): Boolean {
        val serviceBinder = service.asBinder()
        val registered = try {
            service.setClipboardChangedCallback(callerToken, clipboardChangedCallback)
        } catch (e: Exception) {
            NativeLogger.w(TAG, "Failed to register primary clip listener: ${e.message}")
            false
        }
        if (!registered) return false

        synchronized(connectionStateLock) {
            if (
                !clipboardListenerRequested ||
                !serviceConnected ||
                clipboardService?.asBinder() !== serviceBinder
            ) {
                try {
                    service.clearClipboardChangedCallback(callerToken)
                } catch (e: Exception) {
                    NativeLogger.w(TAG, "Failed to clear stale listener registration: ${e.message}")
                }
                return false
            }
        }
        return true
    }

    private fun registerClipboardListener(): Boolean {
        synchronized(listenerRegistrationLock) {
            clipboardListenerRequested = true
            for (attempt in 0 until 2) {
                val service = ensureServiceConnected()
                if (service == null) {
                    if (attempt == 0) continue
                    return false
                }
                if (tryRegisterClipboardListener(service)) return true
                if (attempt == 0) resetUserServiceConnection("listener registration failed")
            }
            return false
        }
    }

    /** Restores an existing subscription after a reconnect without racing an explicit start. */
    private fun restoreClipboardListenerAfterConnection(service: IClipboardUserService) {
        synchronized(listenerRegistrationLock) {
            if (!clipboardListenerRequested) return
            if (!tryRegisterClipboardListener(service)) {
                sendClipboardListenerUnavailable()
            }
        }
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
            resetUserServiceConnection("UserService health check failed")
        }

        val latch = bindUserService()
        if (latch != null && !latch.await(CONNECTION_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
            NativeLogger.w(TAG, "Timed out waiting for UserService connection callback")
            resetUserServiceConnection("connection callback timeout")
            return null
        }

        val connectedService = clipboardService
        if (connectedService != null && serviceConnected) {
            if (isUserServiceHealthy(connectedService)) return connectedService
            resetUserServiceConnection("newly connected UserService health check failed")
        }
        return null
    }

    private fun <T> callUserService(
        operation: String,
        fallback: T,
        block: (IClipboardUserService) -> T
    ): T {
        for (attempt in 0 until 2) {
            val service = ensureServiceConnected()
            if (service == null) {
                if (attempt == 0) continue
                break
            }
            try {
                return block(service)
            } catch (e: Exception) {
                NativeLogger.w(
                    TAG,
                    "$operation failed on UserService (attempt ${attempt + 1}): ${e.message}"
                )
                if (attempt == 0) {
                    resetUserServiceConnection("$operation remote call failed")
                }
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
                disconnectUserService()
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
                promise.resolve(registerClipboardListener())
            } catch (e: Exception) {
                NativeLogger.e(TAG, "Failed to start primary clip listener", e)
                promise.resolve(false)
            }
        }

        AsyncFunction("stopPrimaryClipChangedListener") { promise: Promise ->
            synchronized(listenerRegistrationLock) {
                clipboardListenerRequested = false
                try {
                    clipboardService?.clearClipboardChangedCallback(callerToken)
                } catch (e: Exception) {
                    NativeLogger.e(TAG, "Failed to stop primary clip listener", e)
                }
            }
            promise.resolve(null)
        }
    }
}
