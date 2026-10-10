package expo.modules.foregroundservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import expo.modules.nativeutil.NativeLogger
import java.util.UUID

/** 前台服务直接持有 Headless JS 会话，不依赖 Activity 创建或恢复 JS。 */
class SyncForegroundService : Service(), HeadlessJsTaskEventListener {
    companion object {
        private const val TAG = "SyncForegroundService"
        private const val APP_PACKAGE = "com.jericx.syncclipboardmobile"
        private const val STARTUP_TIMEOUT_MS = 60_000L
        private const val PREFS = "sync_foreground_runtime"
        private const val STOP_REASON = "stop_reason"
        const val CHANNEL_ID = "syncclipboard_foreground"
        const val NOTIFY_ID = 0x2020
        const val ACTION_START = "START"
        const val ACTION_STOP = "STOP"
        const val ACTION_TEMP_STOP = "TEMP_STOP"
        const val ACTION_UPDATE = "UPDATE"
        const val EXTRA_CONTENT = "content"
        const val RESTART_NOTIFY_ID = 0x2021
        private const val RESTART_CHANNEL_ID = "syncclipboard_restart"
        @Volatile private var instance: SyncForegroundService? = null
        @Volatile var isRunning = false
            private set
        @Volatile internal var stoppedByUser = false

        fun currentSessionId(): String? = instance?.takeIf { isRunning }?.sessionId
        fun getStopReason(context: Context): String? =
            context.getSharedPreferences(PREFS, MODE_PRIVATE).getString(STOP_REASON, null)
        fun clearStopReason(context: Context) {
            context.getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(STOP_REASON).commit()
        }
        fun markSessionReady(sessionId: String) {
            val service = instance ?: return
            service.handler.post {
                if (isRunning && service.sessionId == sessionId) {
                    service.handler.removeCallbacks(service.startupTimeout)
                    service.releaseStartupWakeLock()
                    service.notificationManager?.cancel(RESTART_NOTIFY_ID)
                    NativeLogger.i(TAG, "Headless sync ready: $sessionId")
                    service.logStartupTiming("jsReady")
                }
            }
        }
    }

    @Volatile private var sessionId = UUID.randomUUID().toString()
    private val createdAtMs = SystemClock.elapsedRealtime()
    private val startupTimingStages = mutableSetOf<String>()

    /** 与 JS 日志通过 sessionId/wallTimeMs 关联；原生耗时使用单调时钟。 */
    private fun logStartupTiming(stage: String) {
        if (!startupTimingStages.add(stage)) return
        val now = SystemClock.elapsedRealtime()
        NativeLogger.i(TAG, "[StartupTiming] stage=native.$stage sessionId=$sessionId " +
            "pid=${android.os.Process.myPid()} serviceElapsedMs=${now - createdAtMs} " +
            "processElapsedMs=${now - android.os.Process.getStartElapsedRealtime()} " +
            "wallTimeMs=${System.currentTimeMillis()}")
    }
    private val handler = Handler(Looper.getMainLooper())
    private var notificationManager: NotificationManager? = null
    private var startupWakeLock: PowerManager.WakeLock? = null
    private var taskContext: HeadlessJsTaskContext? = null
    private var taskReactContext: ReactContext? = null
    private var taskId: Int? = null
    private var contextListener: ReactInstanceEventListener? = null
    private val reactHost get() = (application as ReactApplication).reactHost
    private val startupTimeout = Runnable {
        if (isRunning) {
            NativeLogger.w(TAG, "Headless startup timed out")
            pauseAndStop("temporary", showRecovery = true)
        }
    }

    private fun getAppString(name: String): String {
        val resId = resources.getIdentifier(name, "string", APP_PACKAGE)
        return if (resId != 0) getString(resId) else name
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        stoppedByUser = false
        createNotificationChannel()
        logStartupTiming("serviceCreated")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        NativeLogger.d(TAG, "onStartCommand action=${intent?.action}, session=$sessionId")
        when (intent?.action) {
            ACTION_STOP -> {
                pauseAndStop("stop")
                return START_NOT_STICKY
            }
            ACTION_TEMP_STOP -> {
                pauseAndStop("temporary")
                return START_NOT_STICKY
            }
            ACTION_UPDATE -> {
                if (isRunning) updateNotification(intent.getStringExtra(EXTRA_CONTENT)
                    ?: getAppString("fg_notification_running"))
                return if (isRunning) START_STICKY else START_NOT_STICKY
            }
            ACTION_START, null -> {
                logStartupTiming(if (intent == null) "stickyStart" else "explicitStart")
                try {
                    // 必须先兑现前台服务启动时限，再等待 ReactHost/配置初始化。
                    promoteToForeground()
                    logStartupTiming("foregroundReady")
                    if (getStopReason(this) != null) {
                        stoppedByUser = true
                        stopSelf()
                        return START_NOT_STICKY
                    }
                    isRunning = true
                    startHeadlessSession()
                } catch (error: Exception) {
                    NativeLogger.e(TAG, "Cannot start headless sync", error)
                    pauseAndStop("temporary", showRecovery = true)
                    return START_NOT_STICKY
                }
            }
            else -> return START_NOT_STICKY
        }
        return START_STICKY
    }

    private fun promoteToForeground() {
        val notification = createNotification(getAppString("fg_notification_running"))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFY_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFY_ID, notification)
        }
    }

    private fun startHeadlessSession() {
        val host = checkNotNull(reactHost) { "ReactHost is unavailable" }
        val context = host.currentReactContext
        if (contextListener != null) return
        if (context === taskReactContext && taskId?.let { taskContext?.isTaskRunning(it) } == true) return
        // JS reload 时换一代会话，迟到的完成回调不能终止新任务。
        if (taskId != null) {
            releaseTask()
            sessionId = UUID.randomUUID().toString()
            startupTimingStages.clear()
        }
        logStartupTiming(if (context == null) "reactHostStart" else "reactContextAlreadyReady")
        val powerManager = getSystemService(POWER_SERVICE) as PowerManager
        startupWakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:sync-startup")
            .apply { setReferenceCounted(false); acquire(STARTUP_TIMEOUT_MS) }
        handler.postDelayed(startupTimeout, STARTUP_TIMEOUT_MS)
        if (context != null) {
            launchTask(context)
        } else {
            val listener = object : ReactInstanceEventListener {
                override fun onReactContextInitialized(context: ReactContext) {
                    handler.post {
                        logStartupTiming("reactContextReady")
                        host.removeReactInstanceEventListener(this)
                        contextListener = null
                        if (instance === this@SyncForegroundService && isRunning && !stoppedByUser) {
                            launchTask(context)
                        }
                    }
                }
            }
            contextListener = listener
            host.addReactInstanceEventListener(listener)
            host.start()
        }
    }

    private fun launchTask(context: ReactContext) {
        try {
            taskReactContext = context
            taskContext = HeadlessJsTaskContext.getInstance(context).also { tasks ->
                tasks.addTaskEventListener(this)
                taskId = tasks.startTask(HeadlessJsTaskConfig(
                    "ServiceRuntimeHeadlessTask",
                    Arguments.createMap().apply { putString("sessionId", sessionId) },
                    0L,
                    true
                ))
            }
            NativeLogger.i(TAG, "Started Headless JS task=$taskId, session=$sessionId")
            logStartupTiming("headlessTaskScheduled")
        } catch (error: Exception) {
            NativeLogger.e(TAG, "Cannot launch Headless JS task", error)
            pauseAndStop("temporary", showRecovery = true)
        }
    }

    override fun onHeadlessJsTaskStart(taskId: Int) = Unit

    override fun onHeadlessJsTaskFinish(taskId: Int) {
        // 短信上传等其他 Headless 任务完成不能停止同步服务。
        if (this.taskId != taskId) return
        if (isRunning && !stoppedByUser) pauseAndStop("temporary", showRecovery = true)
    }

    private fun releaseTask() {
        taskContext?.removeTaskEventListener(this)
        taskId?.let { taskContext?.finishTask(it) }
        taskId = null
        taskContext = null
        taskReactContext = null
    }

    private fun releaseStartupWakeLock() {
        startupWakeLock?.let { if (it.isHeld) it.release() }
        startupWakeLock = null
    }

    private fun pauseAndStop(reason: String, showRecovery: Boolean = false) {
        // 先持久化，确保 JS 尚未启动或进程随后死亡时也不会丢失用户的停止操作。
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(STOP_REASON, reason).commit()
        stoppedByUser = true
        if (reason == "stop") ForegroundServiceModule.sendStopEvent()
        else ForegroundServiceModule.sendTempStopEvent()
        if (showRecovery) showRestartNotification()
        stopForeground(STOP_FOREGROUND_REMOVE)
        isRunning = false
        stopSelf()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // Android 15 的 dataSync 配额使用带 fgsType 的回调；单参回调属于 shortService。
    override fun onTimeout(startId: Int, fgsType: Int) {
        NativeLogger.w(TAG, "Foreground service timeout, type=$fgsType")
        pauseAndStop("temporary", showRecovery = true)
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        if (rootIntent?.component?.className?.endsWith(".MainActivity") == true) {
            pauseAndStop("temporary")
        }
    }

    override fun onDestroy() {
        val endedSession = sessionId
        val unexpected = isRunning && !stoppedByUser
        isRunning = false
        instance = null
        handler.removeCallbacks(startupTimeout)
        contextListener?.let { reactHost?.removeReactInstanceEventListener(it) }
        contextListener = null
        releaseStartupWakeLock()
        ForegroundServiceModule.sendSessionStopped(endedSession)
        releaseTask()
        if (unexpected) showRestartNotification()
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        notificationManager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getAppString("fg_channel_name"),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getAppString("fg_channel_desc")
                setShowBadge(false)
            }
            notificationManager?.createNotificationChannel(channel)
        }
    }

    private fun createNotification(content: String): Notification {
        // PendingIntent to open the app when notification is tapped
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingLaunchIntent = PendingIntent.getActivity(
            this, 0, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Temp stop action
        val tempStopIntent = Intent(this, SyncForegroundService::class.java).apply {
            action = ACTION_TEMP_STOP
        }
        val tempStopPendingIntent = PendingIntent.getService(
            this, 2, tempStopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Stop action
        val stopIntent = Intent(this, SyncForegroundService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPendingIntent = PendingIntent.getService(
            this, 1, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val iconResId = applicationContext.resources.getIdentifier(
            "ic_notification", "drawable", packageName
        ).takeIf { it != 0 }
            ?: applicationContext.resources.getIdentifier(
                "ic_launcher_foreground", "mipmap", packageName
            ).takeIf { it != 0 }
            ?: android.R.drawable.ic_menu_info_details

        NativeLogger.d(TAG, "Notification icon resId=$iconResId")

        // 内容以 \n 分割为标题和正文
        val lines = content.split("\n", limit = 2)
        val title = lines[0]
        val body = if (lines.size > 1) lines[1] else ""

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(iconResId)
            .setContentIntent(pendingLaunchIntent)
            .setOngoing(true)
            .setSilent(true)
            .addAction(0, getAppString("fg_action_temp_stop"), tempStopPendingIntent)
            .addAction(0, getAppString("fg_action_stop"), stopPendingIntent)
            .setStyle(NotificationCompat.BigTextStyle()
                .setBigContentTitle(title)
                .bigText(body)
            )
            .build()
    }

    private fun updateNotification(content: String) {
        val notification = createNotification(content)
        notificationManager?.notify(NOTIFY_ID, notification)
    }

    private fun showRestartNotification(contentText: String = getAppString("fg_restart_content")) {
        val nm = getSystemService(NOTIFICATION_SERVICE) as? NotificationManager ?: return

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                RESTART_CHANNEL_ID,
                getAppString("fg_restart_channel_name"),
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = getAppString("fg_restart_channel_desc")
            }
            nm.createNotificationChannel(channel)
        }

        val restartIntent = Intent().apply {
            setClassName(packageName, "com.jericx.syncclipboardmobile.servicerestart.ServiceRestartActivity")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val pendingIntent = PendingIntent.getActivity(
            this, 0, restartIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val iconResId = applicationContext.resources.getIdentifier(
            "ic_notification", "drawable", packageName
        ).takeIf { it != 0 }
            ?: applicationContext.resources.getIdentifier(
                "ic_launcher_foreground", "mipmap", packageName
            ).takeIf { it != 0 }
            ?: android.R.drawable.ic_menu_info_details

        val notification = NotificationCompat.Builder(this, RESTART_CHANNEL_ID)
            .setContentTitle(getAppString("fg_restart_title"))
            .setContentText(contentText)
            .setSmallIcon(iconResId)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        nm.notify(RESTART_NOTIFY_ID, notification)
    }
}
