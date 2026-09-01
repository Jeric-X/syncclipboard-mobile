package expo.modules.signalrclient

import android.os.Handler
import android.os.Looper
import android.util.Base64
import expo.modules.nativeutil.NativeLogger
import com.google.gson.JsonObject
import com.microsoft.signalr.HubConnection
import com.microsoft.signalr.HubConnectionBuilder
import com.microsoft.signalr.HubConnectionState
import com.microsoft.signalr.TransportEnum
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import io.reactivex.rxjava3.plugins.RxJavaPlugins

class SignalRClientModule : Module() {

    private val handler = Handler(Looper.getMainLooper())

    @Volatile
    private var hubConnection: HubConnection? = null
    @Volatile
    private var isConnecting = false
    private val reconnectHandler = Handler(Looper.getMainLooper())
    private var reconnectRunnable: Runnable? = null
    private var reconnectAttempt = 0
    @Volatile
    private var currentUrl: String? = null
    @Volatile
    private var currentUsername: String? = null
    @Volatile
    private var currentPassword: String? = null
    @Volatile
    private var hasValidatedNetwork = false
    private val validatedNetworkMonitor = ValidatedNetworkMonitor(::onValidatedNetworkChanged)

    companion object {
        private const val TAG = "SignalRClientModule"
    }

    override fun definition() = ModuleDefinition {
        Name("SignalRClientModule")

        OnCreate {
            // SignalR Java 客户端在连接失败时（transport 尚未初始化）会触发 NPE，
            // 该异常由 RxJava 作为 undeliverable exception 在 OkHttp 线程上抛出导致崩溃。
            // 设置全局错误处理器捕获此类异常，记录日志而不崩溃。
            if (RxJavaPlugins.getErrorHandler() == null) {
                RxJavaPlugins.setErrorHandler { e ->
                    NativeLogger.e(TAG, "RxJava undeliverable exception (SignalR bug workaround)", e)
                }
            }
            validatedNetworkMonitor.start(appContext.reactContext)
        }

        Events("onProfileChanged", "onHistoryChanged", "onStateChanged")

        Function("connect") { url: String, username: String, password: String ->
            connectSignalR(url, username, password)
        }

        Function("disconnect") {
            disconnectSignalR()
        }

        Function("isConnected") {
            hubConnection?.connectionState == HubConnectionState.CONNECTED
        }

        Function("getState") {
            hubConnection?.connectionState?.name ?: "DISCONNECTED"
        }

        OnDestroy {
            validatedNetworkMonitor.stop()
            disconnectSignalR()
        }
    }

    private fun connectSignalR(url: String, username: String, password: String) {
        if (isConnecting) return
        if (hubConnection?.connectionState == HubConnectionState.CONNECTED &&
            currentUrl == url && currentUsername == username) {
            NativeLogger.d(TAG, "Already connected to $url")
            return
        }

        disconnectSignalRInternal()

        currentUrl = url
        currentUsername = username
        currentPassword = password

        if (!hasValidatedNetwork) {
            cancelReconnect()
            NativeLogger.d(TAG, "Deferring SignalR connection until the network is validated")
            handler.post {
                sendEvent("onStateChanged", mapOf("state" to "DISCONNECTED"))
            }
            return
        }

        isConnecting = true

        val hubUrl = url.trimEnd('/') + "/SyncClipboardHub"
        val credentials = "$username:$password"
        val encodedCredentials = Base64.encodeToString(credentials.toByteArray(), Base64.NO_WRAP)

        NativeLogger.d(TAG, "Connecting to SignalR hub: $hubUrl")

        try {
            val connection = HubConnectionBuilder
                .create(hubUrl)
                .withHeader("Authorization", "Basic $encodedCredentials")
                .withTransport(TransportEnum.WEBSOCKETS)
                .shouldSkipNegotiate(false)
                .build()

            connection.on("RemoteProfileChanged", { profileJson: JsonObject ->
                NativeLogger.d(TAG, "RemoteProfileChanged received")
                handler.post {
                    sendEvent("onProfileChanged", mapOf(
                        "type" to getJsonString(profileJson, "Type", "Text"),
                        "hash" to getJsonString(profileJson, "Hash", ""),
                        "text" to getJsonString(profileJson, "Text", ""),
                        "hasData" to getJsonBoolean(profileJson, "HasData", false),
                        "dataName" to getJsonStringOrNull(profileJson, "DataName"),
                        "size" to getJsonLong(profileJson, "Size", 0L)
                    ))
                }
            }, JsonObject::class.java)

            connection.on("RemoteHistoryChanged", { historyJson: JsonObject ->
                NativeLogger.d(TAG, "RemoteHistoryChanged received")
                handler.post {
                    sendEvent("onHistoryChanged", mapOf(
                        "hash" to getJsonString(historyJson, "Hash", ""),
                        "text" to getJsonString(historyJson, "Text", ""),
                        "type" to getJsonString(historyJson, "Type", "Text"),
                        "hasData" to getJsonBoolean(historyJson, "HasData", false),
                        "size" to getJsonLong(historyJson, "Size", 0L),
                        "starred" to getJsonBoolean(historyJson, "Starred", false),
                        "pinned" to getJsonBoolean(historyJson, "Pinned", false),
                        "version" to getJsonInt(historyJson, "Version", 0),
                        "isDeleted" to getJsonBoolean(historyJson, "IsDeleted", false),
                        "createTime" to getJsonStringOrNull(historyJson, "CreateTime"),
                        "lastModified" to getJsonStringOrNull(historyJson, "LastModified"),
                        "lastAccessed" to getJsonStringOrNull(historyJson, "LastAccessed")
                    ))
                }
            }, JsonObject::class.java)

            connection.onClosed { error ->
                if (hubConnection !== connection) {
                    NativeLogger.d(TAG, "Ignoring close event from stale SignalR connection")
                    return@onClosed
                }
                NativeLogger.d(TAG, "SignalR connection closed: ${error?.message}")
                handler.post {
                    sendEvent("onStateChanged", mapOf("state" to "DISCONNECTED"))
                }
                if (currentUrl != null) {
                    scheduleReconnect()
                }
            }

            hubConnection = connection

            Thread {
                try {
                    connection.start().blockingAwait()
                    if (hubConnection !== connection) {
                        NativeLogger.d(TAG, "Ignoring successful start from stale SignalR connection")
                        connection.stop().blockingAwait()
                        return@Thread
                    }
                    reconnectAttempt = 0
                    isConnecting = false
                    NativeLogger.d(TAG, "SignalR connected successfully")
                    handler.post {
                        sendEvent("onStateChanged", mapOf("state" to "CONNECTED"))
                    }
                } catch (e: Exception) {
                    if (hubConnection !== connection) {
                        NativeLogger.d(TAG, "Ignoring failure from stale SignalR connection")
                        return@Thread
                    }
                    isConnecting = false
                    NativeLogger.e(TAG, "SignalR connection failed", e)
                    handler.post {
                        sendEvent("onStateChanged", mapOf("state" to "DISCONNECTED"))
                    }
                    scheduleReconnect()
                }
            }.start()

        } catch (e: Exception) {
            isConnecting = false
            NativeLogger.e(TAG, "Failed to create SignalR connection", e)
        }
    }

    private fun disconnectSignalR() {
        currentUrl = null
        currentUsername = null
        currentPassword = null
        cancelReconnect()
        disconnectSignalRInternal()
    }

    private fun disconnectSignalRInternal() {
        hubConnection?.let { conn ->
            try {
                if (conn.connectionState != HubConnectionState.DISCONNECTED) {
                    Thread {
                        try {
                            conn.stop().blockingAwait()
                        } catch (e: Exception) {
                            NativeLogger.e(TAG, "Error stopping SignalR", e)
                        }
                    }.start()
                }
            } catch (e: Exception) {
                NativeLogger.e(TAG, "Error during SignalR disconnect", e)
            }
        }
        hubConnection = null
        isConnecting = false
    }

    private fun scheduleReconnect() {
        if (currentUrl == null) {
            NativeLogger.d(TAG, "Skipping SignalR reconnect because the client was disconnected")
            return
        }

        if (!hasValidatedNetwork) {
            NativeLogger.d(TAG, "Skipping SignalR reconnect until the network is validated")
            return
        }

        if (reconnectRunnable != null) {
            NativeLogger.d(TAG, "SignalR reconnect is already scheduled")
            return
        }

        val delayMs = ReconnectBackoffPolicy.delayMillis(reconnectAttempt)
        val attemptNumber = if (reconnectAttempt == Int.MAX_VALUE) {
            Int.MAX_VALUE
        } else {
            reconnectAttempt + 1
        }
        reconnectAttempt = attemptNumber
        NativeLogger.d(
            TAG,
            "Scheduling SignalR reconnect attempt $attemptNumber in ${delayMs}ms (jitter +/-20%)"
        )

        val runnable = Runnable {
            reconnectRunnable = null
            if (!hasValidatedNetwork) {
                NativeLogger.d(TAG, "Cancelling scheduled SignalR reconnect: network is not validated")
                return@Runnable
            }
            val url = currentUrl ?: return@Runnable
            val user = currentUsername ?: return@Runnable
            val pass = currentPassword ?: return@Runnable
            isConnecting = false
            connectSignalR(url, user, pass)
        }
        reconnectRunnable = runnable
        reconnectHandler.postDelayed(runnable, delayMs)
    }

    private fun cancelReconnect() {
        val hadPendingReconnect = reconnectRunnable != null
        reconnectRunnable?.let {
            reconnectHandler.removeCallbacks(it)
        }
        reconnectRunnable = null
        reconnectAttempt = 0
        if (hadPendingReconnect) {
            NativeLogger.d(TAG, "Cancelled pending SignalR reconnect")
        }
    }

    private fun onValidatedNetworkChanged(isValidated: Boolean, reason: String) {
        handler.post {
            val wasValidated = hasValidatedNetwork
            val action = ValidatedNetworkPolicy.transitionAction(
                wasValidated = wasValidated,
                isValidated = isValidated,
                hasConnectionRequest = currentUrl != null,
                isConnectedOrConnecting =
                    hubConnection?.connectionState == HubConnectionState.CONNECTED || isConnecting
            )
            hasValidatedNetwork = isValidated
            when (action) {
                ValidatedNetworkAction.DISCONNECT -> {
                    NativeLogger.d(
                        TAG,
                        "Validated network lost ($reason); cancelling reconnect and closing SignalR"
                    )
                    cancelReconnect()
                    disconnectSignalRInternal()
                    sendEvent("onStateChanged", mapOf("state" to "DISCONNECTED"))
                }
                ValidatedNetworkAction.RECONNECT -> {
                    val url = currentUrl ?: return@post
                    val user = currentUsername ?: return@post
                    val pass = currentPassword ?: return@post
                    cancelReconnect()
                    NativeLogger.d(
                        TAG,
                        "Validated network available ($reason); reconnecting immediately"
                    )
                    connectSignalR(url, user, pass)
                }
                ValidatedNetworkAction.NONE -> {
                    if (!wasValidated && isValidated && currentUrl == null) {
                        NativeLogger.d(
                            TAG,
                            "Validated network available ($reason); no connection requested"
                        )
                    }
                }
            }
        }
    }

    private fun getJsonString(json: JsonObject, key: String, default: String): String {
        val element = json.get(key) ?: json.get(key.replaceFirstChar { it.lowercase() })
        return if (element != null && !element.isJsonNull) element.asString else default
    }

    private fun getJsonStringOrNull(json: JsonObject, key: String): String? {
        val element = json.get(key) ?: json.get(key.replaceFirstChar { it.lowercase() })
        return if (element != null && !element.isJsonNull) element.asString else null
    }

    private fun getJsonBoolean(json: JsonObject, key: String, default: Boolean): Boolean {
        val element = json.get(key) ?: json.get(key.replaceFirstChar { it.lowercase() })
        return if (element != null && !element.isJsonNull) element.asBoolean else default
    }

    private fun getJsonLong(json: JsonObject, key: String, default: Long): Long {
        val element = json.get(key) ?: json.get(key.replaceFirstChar { it.lowercase() })
        return if (element != null && !element.isJsonNull) element.asLong else default
    }

    private fun getJsonInt(json: JsonObject, key: String, default: Int): Int {
        val element = json.get(key) ?: json.get(key.replaceFirstChar { it.lowercase() })
        return if (element != null && !element.isJsonNull) element.asInt else default
    }
}
