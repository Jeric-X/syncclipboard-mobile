package expo.modules.foregroundservice

import android.app.NotificationManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import expo.modules.nativeutil.NativeLogger
import java.util.UUID

/** 进程内唯一的 Headless 会话；不以某个前台服务实例作为启动前提。操作串行于主线程。 */
object ServiceRuntimeSession {
    private const val TAG = "ServiceRuntimeSession"
    private const val STARTUP_TIMEOUT_MS = 60_000L
    private val handler = Handler(Looper.getMainLooper())
    @Volatile private var current: Session? = null

    fun currentSessionId(): String? = current?.id

    /** 先占用会话再启动 ReactHost，重复请求复用正在启动或运行的任务。 */
    fun ensureStarted(context: Context): String? {
        check(Looper.myLooper() == Looper.getMainLooper())
        val application = context.applicationContext
        if (SyncForegroundService.getStopReason(application) != null) return null
        val host = checkNotNull((application as ReactApplication).reactHost) { "ReactHost is unavailable" }
        current?.let { session ->
            if (session.reactContext == null || session.reactContext === host.currentReactContext) {
                SyncForegroundService.attachRuntime(session.id)
                return session.id
            }
            // React reload 后使用新一代会话，旧任务的回调不能结束新任务。
            stop(session.id)
        }
        val session = Session(application, host)
        current = session
        try {
            session.start()
        } catch (error: Exception) {
            stop(session.id)
            throw error
        }
        return session.id.takeIf { current === session }?.also { SyncForegroundService.attachRuntime(it) }
    }

    fun markReady(id: String) {
        handler.post {
            current?.takeIf { it.id == id }?.let {
                it.releaseStartupResources()
                (it.context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager)
                    ?.cancel(SyncForegroundService.RESTART_NOTIFY_ID)
                NativeLogger.i(TAG, "Headless sync ready: $id")
                it.logStartupTiming("jsReady")
            }
        }
    }

    /** JS 初始化异常也要先释放原生占用，再让 JS 判断是否清理共享运行时。 */
    fun finishFromJs(id: String) {
        check(Looper.myLooper() == Looper.getMainLooper())
        if (current?.id != id) return
        stop(id)
        SyncForegroundService.onRuntimeFailed()
    }

    /** 带会话 ID 的结束请求不会误停下一代；调用方可来自 JS 线程。 */
    fun requestStop(id: String?) {
        handler.post { if (id != null) stop(id) }
    }

    fun stop(id: String) {
        check(Looper.myLooper() == Looper.getMainLooper())
        val session = current?.takeIf { it.id == id } ?: return
        current = null
        session.release()
        ForegroundServiceModule.sendSessionStopped(id)
    }

    private class Session(val context: Context, val host: ReactHost) {
        val id = UUID.randomUUID().toString()
        private val createdAtMs = SystemClock.elapsedRealtime()
        var reactContext: ReactContext? = null
        private var tasks: HeadlessJsTaskContext? = null
        private var taskId: Int? = null
        private var contextListener: ReactInstanceEventListener? = null
        private var wakeLock: PowerManager.WakeLock? = null
        private val timeout = Runnable { fail("Headless startup timed out") }
        // 监听器绑定会话而非全局 taskId，避免不同 ReactContext 的 ID 重用。
        private val taskListener = object : HeadlessJsTaskEventListener {
            override fun onHeadlessJsTaskStart(taskId: Int) = Unit
            override fun onHeadlessJsTaskFinish(taskId: Int) {
                if (this@Session.taskId == taskId) fail("Headless task finished")
            }
        }

        /** 保留与 JS 通过 sessionId 对齐的启动阶段耗时。 */
        fun logStartupTiming(stage: String) {
            val now = SystemClock.elapsedRealtime()
            NativeLogger.i(TAG, "[StartupTiming] stage=native.$stage sessionId=$id " +
                "pid=${android.os.Process.myPid()} sessionElapsedMs=${now - createdAtMs} " +
                "processElapsedMs=${now - android.os.Process.getStartElapsedRealtime()} " +
                "wallTimeMs=${System.currentTimeMillis()}")
        }

        fun start() {
            val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "${context.packageName}:sync-startup")
                .apply { setReferenceCounted(false); acquire(STARTUP_TIMEOUT_MS) }
            handler.postDelayed(timeout, STARTUP_TIMEOUT_MS)
            val readyContext = host.currentReactContext
            logStartupTiming(if (readyContext == null) "reactHostStart" else "reactContextAlreadyReady")
            if (readyContext != null) {
                launch(readyContext)
                return
            }
            val listener = object : ReactInstanceEventListener {
                override fun onReactContextInitialized(context: ReactContext) {
                    handler.post {
                        host.removeReactInstanceEventListener(this)
                        contextListener = null
                        if (current === this@Session) {
                            logStartupTiming("reactContextReady")
                            launch(context)
                        }
                    }
                }
            }
            contextListener = listener
            host.addReactInstanceEventListener(listener)
            host.start()
        }

        private fun launch(context: ReactContext) {
            if (current !== this || taskId != null) return
            try {
                reactContext = context
                val taskContext = HeadlessJsTaskContext.getInstance(context)
                tasks = taskContext
                taskContext.addTaskEventListener(taskListener)
                taskId = taskContext.startTask(HeadlessJsTaskConfig(
                    "ServiceRuntimeHeadlessTask",
                    Arguments.createMap().apply { putString("sessionId", id) },
                    0L,
                    true
                ))
                NativeLogger.i(TAG, "Started Headless JS task=$taskId, session=$id")
                logStartupTiming("headlessTaskScheduled")
            } catch (error: Exception) {
                NativeLogger.e(TAG, "Cannot launch Headless JS task", error)
                fail("Headless launch failed")
            }
        }

        private fun fail(reason: String) {
            if (current !== this) return
            NativeLogger.w(TAG, "$reason, session=$id")
            stop(id)
            SyncForegroundService.onRuntimeFailed()
        }

        fun releaseStartupResources() {
            handler.removeCallbacks(timeout)
            wakeLock?.let { if (it.isHeld) it.release() }
            wakeLock = null
        }

        fun release() {
            releaseStartupResources()
            contextListener?.let { host.removeReactInstanceEventListener(it) }
            contextListener = null
            tasks?.removeTaskEventListener(taskListener)
            taskId?.let { if (tasks?.isTaskRunning(it) == true) tasks?.finishTask(it) }
            taskId = null
            tasks = null
            reactContext = null
        }
    }
}
