package expo.modules.foregroundservice

import android.content.Intent
import expo.modules.kotlin.functions.Queues
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
            SyncForegroundService.requestStart(context)
        }

        Function("stopService") {
            val context = appContext.reactContext ?: return@Function false
            SyncForegroundService.requestStop(context)
            true
        }

        AsyncFunction("startHeadlessRuntime") {
            val context = appContext.reactContext ?: return@AsyncFunction null
            ServiceRuntimeSession.ensureStarted(context)
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("finishHeadlessRuntime") { sessionId: String ->
            ServiceRuntimeSession.finishFromJs(sessionId)
        }.runOnQueue(Queues.MAIN)

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
            ServiceRuntimeSession.currentSessionId()
        }

        Function("getStopReason") {
            appContext.reactContext?.let { SyncForegroundService.getStopReason(it) }
        }

        Function("clearStopReason") {
            appContext.reactContext?.let { SyncForegroundService.clearStopReason(it) }
        }

        Function("markSessionReady") { sessionId: String ->
            ServiceRuntimeSession.markReady(sessionId)
        }

    }
}
