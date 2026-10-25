package expo.modules.foregroundservice

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

    @Volatile private var startupFailed = false

    fun hasFailedStartup(): Boolean = startupFailed

    fun currentSessionId(): String? = current?.id
    fun isReady(): Boolean = current?.ready == true

    /** 与已保存的配置同步，默认关闭；不能把磁贴加载视为用户主动恢复。 */
    fun setTileRecoveryEnabled(context: Context, enabled: Boolean) {
        context.getSharedPreferences("tile_recovery", Context.MODE_PRIVATE)
            .edit().putBoolean("enabled", enabled).apply()
    }

    /** 磁贴仅触发已有 Headless 入口，不清除停止标记，也不直接启动前台服务。 */
    fun recoverFromTile(context: Context) {
        if (!context.getSharedPreferences("tile_recovery", Context.MODE_PRIVATE)
                .getBoolean("enabled", false)) return
        try {
            ensureStarted(context)
        } catch (error: Exception) {
            NativeLogger.e(TAG, "Cannot restore Headless from Quick Settings", error)
        }
    }

    /** 先占用会话再启动 ReactHost，重复请求复用正在启动或运行的任务。 */
    fun ensureStarted(context: Context): String? {
        check(Looper.myLooper() == Looper.getMainLooper())
        val application = context.applicationContext
        if (SyncForegroundService.getStopReason(application) != null) return null
        val host = checkNotNull((application as ReactApplication).reactHost) { "ReactHost is unavailable" }
        current?.let { session ->
            if (session.reactContext == null || session.reactContext === host.currentReactContext) {
                return session.id
            }
            // React reload 后使用新一代会话，旧任务的回调不能结束新任务。
            stop(session.id)
        }
        startupFailed = false
        val session = Session(application, host)
        current = session
        try {
            session.start()
        } catch (error: Exception) {
            session.fail("Headless startup failed")
            throw error
        }
        return session.id.takeIf { current === session }
    }

    fun markReady(id: String) {
        handler.post {
            current?.takeIf { it.id == id }?.let {
                it.ready = true
                startupFailed = false
                it.releaseStartupResources()
                ShizukuRecovery.notifyRuntimeReady()
                NativeLogger.i(TAG, "Headless sync ready: $id")
                it.logStartupTiming("jsReady")
            }
        }
    }

    /** JS 初始化异常也要先释放原生占用，再让 JS 判断是否清理共享运行时。 */
    fun finishFromJs(id: String) {
        check(Looper.myLooper() == Looper.getMainLooper())
        if (current?.id != id) return
        val session = current!!
        val context = session.context
        startupFailed = shouldRetryHeadlessStartup(session.ready, SyncForegroundService.getStopReason(context) != null)
        if (!startupFailed) ShizukuRecovery.disable(context)
        SyncForegroundService.requestStop(context)
        stop(id)
        if (startupFailed) ShizukuRecovery.notifyRuntimeFailed()
    }

    fun stop(id: String) {
        check(Looper.myLooper() == Looper.getMainLooper())
        val session = current?.takeIf { it.id == id } ?: return
        current = null
        session.release()
        ForegroundServiceModule.sendSessionStopped(id)
    }

    private class Session(val context: Context, val host: ReactHost) {
        @Volatile var ready = false
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
            logStartupTiming(when {
                readyContext == null -> "reactHostStart"
                readyContext.hasActiveReactInstance() -> "reactContextAlreadyReady"
                else -> "reactContextPending"
            })
            // ReactContext 可先于 ReactInstance 创建；此时 startTask 会登记任务但不调用 JS。
            if (readyContext?.hasActiveReactInstance() == true) {
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

        fun fail(reason: String) {
            if (current !== this) return
            NativeLogger.w(TAG, "$reason, session=$id")
            startupFailed = shouldRetryHeadlessStartup(ready, SyncForegroundService.getStopReason(context) != null)
            if (!startupFailed) ShizukuRecovery.disable(context)
            stop(id)
            SyncForegroundService.requestStop(context)
            if (startupFailed) ShizukuRecovery.notifyRuntimeFailed()
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

/** 初始化失败保留恢复预算；用户停止以及已就绪会话结束仍撤销恢复能力。 */
internal fun shouldRetryHeadlessStartup(wasReady: Boolean, stopped: Boolean): Boolean =
    !wasReady && !stopped
