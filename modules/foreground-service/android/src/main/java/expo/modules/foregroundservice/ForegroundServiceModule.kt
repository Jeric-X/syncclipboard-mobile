package expo.modules.foregroundservice

import android.content.Context
import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ForegroundServiceModule : Module() {

    companion object {
        private var moduleInstance: ForegroundServiceModule? = null

        fun sendStopEvent() {
            moduleInstance?.sendEvent("onStopRequested", emptyMap<String, Any>())
        }

        fun sendTempStopEvent() {
            moduleInstance?.sendEvent("onTempStopRequested", emptyMap<String, Any>())
        }

        fun sendSessionStopped(sessionId: String) {
            moduleInstance?.sendEvent("onSessionStopped", mapOf("sessionId" to sessionId))
        }
    }

    override fun definition() = ModuleDefinition {
        Name("ForegroundServiceModule")

        Events("onStopRequested", "onTempStopRequested", "onSessionStopped")

        OnCreate {
            moduleInstance = this@ForegroundServiceModule
        }

        OnDestroy {
            if (moduleInstance == this@ForegroundServiceModule) {
                moduleInstance = null
            }
        }

        Function("startService") {
            val context = appContext.reactContext ?: return@Function false
            if (SyncForegroundService.getStopReason(context) != null) return@Function false
            val intent = Intent(context, SyncForegroundService::class.java).apply {
                action = SyncForegroundService.ACTION_START
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
            true
        }

        Function("stopService") {
            val context = appContext.reactContext ?: return@Function false
            if (!SyncForegroundService.isRunning) return@Function true
            // 标记为用户主动停止，避免 onDestroy 中误发重启通知
            SyncForegroundService.stoppedByUser = true
            val intent = Intent(context, SyncForegroundService::class.java)
            context.stopService(intent)
            true
        }

        Function("updateNotification") { content: String ->
            val context = appContext.reactContext ?: return@Function false
            // 服务未运行时不发送 startService，避免意外重启前台服务
            if (!SyncForegroundService.isRunning) return@Function false
            val intent = Intent(context, SyncForegroundService::class.java).apply {
                action = SyncForegroundService.ACTION_UPDATE
                putExtra(SyncForegroundService.EXTRA_CONTENT, content)
            }
            context.startService(intent)
            true
        }

        Function("isRunning") {
            SyncForegroundService.isRunning
        }

        Function("getSessionId") {
            SyncForegroundService.currentSessionId()
        }

        Function("getStopReason") {
            appContext.reactContext?.let { SyncForegroundService.getStopReason(it) }
        }

        Function("clearStopReason") {
            appContext.reactContext?.let { SyncForegroundService.clearStopReason(it) }
        }

        Function("markSessionReady") { sessionId: String ->
            SyncForegroundService.markSessionReady(sessionId)
        }

        Function("cancelRestartNotification") {
            val context = appContext.reactContext ?: return@Function false
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? android.app.NotificationManager
            nm?.cancel(SyncForegroundService.RESTART_NOTIFY_ID)
            true
        }
    }
}
