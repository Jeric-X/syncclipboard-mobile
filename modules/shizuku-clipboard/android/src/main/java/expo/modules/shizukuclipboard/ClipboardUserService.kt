package expo.modules.shizukuclipboard

import android.content.ClipData
import android.content.ClipDescription
import android.os.Binder
import android.os.IBinder
import android.os.Parcel
import java.util.IdentityHashMap

/**
 * ClipboardUserService — 运行在 Shizuku 进程（UID 2000/shell）中
 *
 * 在 Shizuku 的进程中，没有隐藏 API 限制，可以自由反射调用 IClipboard 的方法。
 * 通过 ServiceManager 获取 clipboard binder，然后反射调用 getPrimaryClip 等方法。
 */
class ClipboardUserService : IClipboardUserService.Stub() {

    companion object {
        private const val TAG = "ShizukuClipboard.UserService"
        // UserService 以 UID 2000 (shell) 运行，需要使用 shell 的包名
        private const val PACKAGE_NAME = "com.android.shell"
        private const val PRIMARY_CLIP_CHANGED_DESCRIPTOR =
            "android.content.IOnPrimaryClipChangedListener"
        private const val TRANSACTION_DISPATCH_PRIMARY_CLIP_CHANGED =
            IBinder.FIRST_CALL_TRANSACTION

        init {
            // 当 Shizuku 以 root 权限运行时，UserService 进程继承 UID 0。
            // 剪贴板服务会校验 callingPackage 对应的 UID 是否匹配 Binder.getCallingUid()，
            // "com.android.shell"(UID 2000) 与 root(UID 0) 不匹配，导致访问被拒绝。
            // 修复：将进程身份从 root 切换到 shell，使 UID 与 PACKAGE_NAME 一致。
            // UserService 运行在独立进程（processNameSuffix="clipboard"）中，不影响 Shizuku 主进程。
            if (android.os.Process.myUid() == 0) {
                try {
                    // setgid 必须在 setuid 之前调用，因为 setuid 后将失去 root 权限
                    @Suppress("DEPRECATION")
                    android.system.Os.setgid(2000)
                    @Suppress("DEPRECATION")
                    android.system.Os.setuid(2000)
                    android.util.Log.i(TAG, "Switched UID/GID from root(0) to shell(2000) for clipboard access")
                } catch (e: Exception) {
                    android.util.Log.e(TAG, "Failed to switch UID from root to shell", e)
                }
            }
        }

        private var clipboardService: Any? = null
        private var clipboardBinder: IBinder? = null

        @Synchronized
        private fun getClipboardService(): Any? {
            val cachedBinder = clipboardBinder
            if (clipboardService != null && cachedBinder != null &&
                cachedBinder.isBinderAlive && cachedBinder.pingBinder()
            ) {
                return clipboardService
            }
            // ClipboardService can restart independently. Do not keep its old proxy forever.
            clipboardService = null
            clipboardBinder = null
            return try {
                // 在 Shizuku 进程中，通过 ServiceManager 获取 clipboard service
                val serviceManager = Class.forName("android.os.ServiceManager")
                val getService = serviceManager.getMethod("getService", String::class.java)
                val binder = getService.invoke(null, "clipboard") as? IBinder
                if (binder == null) {
                    android.util.Log.e(TAG, "ServiceManager returned null for clipboard")
                    return null
                }
                val iClipboardStub = Class.forName("android.content.IClipboard\$Stub")
                val asInterface = iClipboardStub.getMethod("asInterface", IBinder::class.java)
                clipboardBinder = binder
                clipboardService = asInterface.invoke(null, binder)
                android.util.Log.d(TAG, "Got clipboard service: ${clipboardService?.javaClass?.name}")
                clipboardService
            } catch (e: Exception) {
                android.util.Log.e(TAG, "Failed to get clipboard service", e)
                null
            }
        }

        /**
         * 动态查找并调用剪贴板方法
         */
        private fun findAndInvokeMethod(clipboard: Any, methodName: String): Any? {
            val clazz = clipboard.javaClass
            val methods = clazz.methods
                .filter { it.name == methodName }
                .sortedByDescending { it.parameterCount }

            for (method in methods) {
                val params = method.parameterTypes
                val args = buildArgs(params) ?: continue
                // 将第一个 String 参数设为 packageName
                for (i in params.indices) {
                    if (params[i] == String::class.java) {
                        args[i] = PACKAGE_NAME
                        break
                    }
                }
                return try {
                    android.util.Log.d(TAG, "Calling ${method.name}(${params.joinToString { it.simpleName }}) with args=${args.joinToString()}")
                    method.invoke(clipboard, *args)
                } catch (e: Exception) {
                    android.util.Log.e(TAG, "Failed to invoke $methodName with ${params.size} params", e)
                    if (e is java.lang.reflect.InvocationTargetException) {
                        android.util.Log.e(TAG, "  cause: ${e.cause}", e.cause)
                    }
                    null
                }
            }
            android.util.Log.e(TAG, "No suitable method found: $methodName")
            return null
        }

        private fun buildArgs(paramTypes: Array<Class<*>>): Array<Any?>? {
            return try {
                paramTypes.map { type ->
                    when {
                        type == String::class.java -> null
                        type == Int::class.javaPrimitiveType || type == Int::class.java -> 0
                        type == Long::class.javaPrimitiveType || type == Long::class.java -> 0L
                        type == Boolean::class.javaPrimitiveType || type == Boolean::class.java -> false
                        else -> return null
                    }
                }.toTypedArray()
            } catch (e: Exception) {
                null
            }
        }
    }

    private data class ClientRecord(
        val token: IBinder,
        val deathRecipient: IBinder.DeathRecipient,
        var callback: IClipboardChangedCallback
    )

    private val clients = IdentityHashMap<IBinder, ClientRecord>()
    private var systemListener: Any? = null
    private var registeredClipboardBinder: IBinder? = null
    private val clientLifecycleLock = Any()

    /** Handles the hidden IOnPrimaryClipChangedListener Binder callback without linking it. */
    private val systemListenerBinder = object : Binder() {
        override fun onTransact(code: Int, data: Parcel, reply: Parcel?, flags: Int): Boolean {
            when (code) {
                INTERFACE_TRANSACTION -> {
                    reply?.writeString(PRIMARY_CLIP_CHANGED_DESCRIPTOR)
                    return true
                }
                TRANSACTION_DISPATCH_PRIMARY_CLIP_CHANGED -> {
                    data.enforceInterface(PRIMARY_CLIP_CHANGED_DESCRIPTOR)
                    val callbacks = synchronized(clientLifecycleLock) {
                        clients.values.map { record -> record.token to record.callback }
                    }
                    callbacks.forEach { (token, callback) ->
                        try {
                            callback.onPrimaryClipChanged()
                        } catch (e: Exception) {
                            android.util.Log.w(TAG, "Failed to forward clipboard change", e)
                            removeFailedClient(token, callback)
                        }
                    }
                    return true
                }
            }
            return super.onTransact(code, data, reply, flags)
        }
    }

    override fun getPrimaryClipText(): String {
        return try {
            val clipboard = getClipboardService() ?: return ""
            val clip = findAndInvokeMethod(clipboard, "getPrimaryClip") as? ClipData
            if (clip != null && clip.itemCount > 0) {
                val text = clip.getItemAt(0).text?.toString() ?: ""
                android.util.Log.d(TAG, "getPrimaryClipText: length=${text.length}")
                text
            } else {
                android.util.Log.d(TAG, "getPrimaryClipText: clip is null or empty")
                ""
            }
        } catch (e: Exception) {
            android.util.Log.e(TAG, "getPrimaryClipText failed", e)
            ""
        }
    }

    override fun hasPrimaryClipText(): Boolean {
        return try {
            val clipboard = getClipboardService() ?: return false
            val desc = findAndInvokeMethod(clipboard, "getPrimaryClipDescription") as? ClipDescription
            desc?.hasMimeType("text/*") ?: false
        } catch (e: Exception) {
            android.util.Log.e(TAG, "hasPrimaryClipText failed", e)
            false
        }
    }

    override fun hasPrimaryClipImage(): Boolean {
        return try {
            val clipboard = getClipboardService() ?: return false
            val desc = findAndInvokeMethod(clipboard, "getPrimaryClipDescription") as? ClipDescription
            desc?.let { it.hasMimeType("image/*") || it.hasMimeType("application/octet-stream") } ?: false
        } catch (e: Exception) {
            android.util.Log.e(TAG, "hasPrimaryClipImage failed", e)
            false
        }
    }

    override fun getPrimaryClipImageUri(): String {
        return try {
            val clipboard = getClipboardService() ?: return ""
            val clip = findAndInvokeMethod(clipboard, "getPrimaryClip") as? ClipData
            if (clip != null && clip.itemCount > 0) {
                clip.getItemAt(0).uri?.toString() ?: ""
            } else {
                ""
            }
        } catch (e: Exception) {
            android.util.Log.e(TAG, "getPrimaryClipImageUri failed", e)
            ""
        }
    }

    /** Adds or updates one subscribed client without replacing other module instances. */
    private fun registerClientLocked(
        callerToken: IBinder,
        callback: IClipboardChangedCallback
    ): ClientRecord? {
        clients[callerToken]?.let { client ->
            client.callback = callback
            return client
        }

        val deathRecipient = object : IBinder.DeathRecipient {
            override fun binderDied() {
                handleCallerDeath(callerToken, this)
            }
        }
        return try {
            callerToken.linkToDeath(deathRecipient, 0)
            ClientRecord(callerToken, deathRecipient, callback).also { record ->
                clients[callerToken] = record
                android.util.Log.i(TAG, "Registered clipboard client; clients=${clients.size}")
            }
        } catch (e: Exception) {
            android.util.Log.e(TAG, "Failed to link to caller token death", e)
            null
        }
    }

    override fun setClipboardChangedCallback(
        callerToken: IBinder,
        callback: IClipboardChangedCallback
    ): Boolean {
        synchronized(clientLifecycleLock) {
            val client = registerClientLocked(callerToken, callback) ?: return false
            return try {
                val clipboard = getClipboardService()
                val currentClipboardBinder = clipboardBinder
                val listenerAlreadyRegistered =
                    clipboard != null &&
                        currentClipboardBinder != null &&
                        registeredClipboardBinder === currentClipboardBinder

                if (listenerAlreadyRegistered) return true

                // ClipboardService 可能已重启；旧 Binder 上的注册状态不能复用。
                unregisterSystemListener()
                val listener = getOrCreateSystemListener()
                if (clipboard == null || listener == null) {
                    removeClientLocked(client, unlinkDeathRecipient = true)
                    return false
                }
                invokeListenerRegistration(clipboard, "addPrimaryClipChangedListener", listener)
                    .also { registered ->
                        registeredClipboardBinder = if (registered) currentClipboardBinder else null
                        if (!registered) {
                            removeClientLocked(client, unlinkDeathRecipient = true)
                        }
                    }
            } catch (e: Exception) {
                removeClientLocked(client, unlinkDeathRecipient = true)
                android.util.Log.e(TAG, "Failed to register primary clip listener", e)
                false
            }
        }
    }

    override fun clearClipboardChangedCallback(callerToken: IBinder) {
        synchronized(clientLifecycleLock) {
            val client = clients[callerToken] ?: return
            removeClientLocked(client, unlinkDeathRecipient = true)
            android.util.Log.i(TAG, "Removed clipboard client; clients=${clients.size}")
        }
    }

    /** Removes one client and unregisters the system listener after the last callback leaves. */
    private fun removeClientLocked(
        client: ClientRecord,
        unlinkDeathRecipient: Boolean
    ) {
        if (clients[client.token] !== client) return
        clients.remove(client.token)
        if (unlinkDeathRecipient) unlinkClientDeathRecipientLocked(client)
        if (clients.isEmpty()) {
            unregisterSystemListener()
        }
    }

    private fun removeFailedClient(
        callerToken: IBinder,
        failedCallback: IClipboardChangedCallback
    ) {
        synchronized(clientLifecycleLock) {
            val client = clients[callerToken] ?: return
            if (client.callback.asBinder() !== failedCallback.asBinder()) return
            removeClientLocked(client, unlinkDeathRecipient = true)
            android.util.Log.i(TAG, "Removed unreachable clipboard client")
        }
    }

    /** 调用时必须持有 clientLifecycleLock。 */
    private fun unlinkClientDeathRecipientLocked(client: ClientRecord) {
        try {
            client.token.unlinkToDeath(client.deathRecipient, 0)
        } catch (e: Exception) {
            // token 可能已死且 death recipient 已被 Binder 移除。
            android.util.Log.d(TAG, "Client death recipient was already unlinked: ${e.message}")
        }
    }

    private fun getOrCreateSystemListener(): Any? {
        if (systemListener != null) return systemListener
        return try {
            val stubClass = Class.forName("android.content.IOnPrimaryClipChangedListener\$Stub")
            val asInterface = stubClass.getMethod("asInterface", IBinder::class.java)
            asInterface.invoke(null, systemListenerBinder).also { systemListener = it }
        } catch (e: Exception) {
            android.util.Log.e(TAG, "Failed to create IOnPrimaryClipChangedListener", e)
            null
        }
    }

    private fun unregisterSystemListener() {
        if (registeredClipboardBinder == null) return
        try {
            val clipboard = getClipboardService()
            val listener = systemListener
            if (clipboard != null && listener != null) {
                invokeListenerRegistration(clipboard, "removePrimaryClipChangedListener", listener)
            }
        } catch (e: Exception) {
            android.util.Log.w(TAG, "Failed to unregister primary clip listener", e)
        } finally {
            registeredClipboardBinder = null
        }
    }

    /** Adapts to IClipboard listener signatures that vary across Android releases. */
    private fun invokeListenerRegistration(clipboard: Any, methodName: String, listener: Any): Boolean {
        val methods = clipboard.javaClass.methods
            .filter { it.name == methodName }
            .sortedByDescending { it.parameterCount }

        for (method in methods) {
            val args = buildListenerArgs(method.parameterTypes, listener) ?: continue
            try {
                android.util.Log.d(TAG, "Calling $methodName(${method.parameterTypes.joinToString { it.simpleName }})")
                method.invoke(clipboard, *args)
                return true
            } catch (e: Exception) {
                android.util.Log.w(TAG, "Failed to invoke $methodName with ${method.parameterCount} params", e)
            }
        }
        android.util.Log.e(TAG, "No suitable listener method found: $methodName")
        return false
    }

    private fun buildListenerArgs(paramTypes: Array<Class<*>>, listener: Any): Array<Any?>? {
        var listenerAssigned = false
        var stringIndex = 0
        return paramTypes.map { type ->
            when {
                type.name == PRIMARY_CLIP_CHANGED_DESCRIPTOR && !listenerAssigned -> {
                    listenerAssigned = true
                    listener
                }
                type == String::class.java -> if (stringIndex++ == 0) PACKAGE_NAME else null
                type == Int::class.javaPrimitiveType || type == Int::class.java -> 0
                type == Long::class.javaPrimitiveType || type == Long::class.java -> 0L
                type == Boolean::class.javaPrimitiveType || type == Boolean::class.java -> false
                else -> return null
            }
        }.let { args -> if (listenerAssigned) args.toTypedArray() else null }
    }

    /** 客户端进程死亡时只清理对应记录，保留其他客户端和 daemon UserService。 */
    private fun handleCallerDeath(
        callerToken: IBinder,
        deathRecipient: IBinder.DeathRecipient
    ) {
        synchronized(clientLifecycleLock) {
            val client = clients[callerToken] ?: return
            if (client.deathRecipient !== deathRecipient) return
            removeClientLocked(client, unlinkDeathRecipient = false)
            android.util.Log.i(TAG, "Caller process died; remaining clients=${clients.size}")
        }
    }

    /**
     * End-to-end health probe used by the App process before every Shizuku operation.
     * It detects an alive UserService whose cached system clipboard Binder has died.
     */
    override fun isClipboardServiceHealthy(): Boolean {
        if (getClipboardService() == null) return false
        val binder = clipboardBinder ?: return false
        return try {
            binder.isBinderAlive && binder.pingBinder()
        } catch (e: Exception) {
            android.util.Log.w(TAG, "Clipboard service health check failed", e)
            false
        }
    }

    override fun destroy() {
        android.util.Log.i(TAG, "UserService destroy called, exiting process")
        synchronized(clientLifecycleLock) {
            clients.values.toList().forEach { client ->
                unlinkClientDeathRecipientLocked(client)
            }
            clients.clear()
            unregisterSystemListener()
        }
        clipboardService = null
        clipboardBinder = null
        System.exit(0)
    }
}
