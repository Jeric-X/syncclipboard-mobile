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
import android.os.IBinder
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import expo.modules.nativeutil.NativeLogger

/** 前台服务与进程级 Headless 会话相互确保启动，重复请求不会创建重复任务。 */
class SyncForegroundService : Service() {
    companion object {
        private const val TAG = "SyncForegroundService"
        private const val APP_PACKAGE = "com.jericx.syncclipboardmobile"
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

        private var startPending = false
        private var generation = 0L
        private const val EXTRA_GENERATION = "generation"

        @Synchronized
        fun requestStart(context: Context): Boolean {
            if (getStopReason(context) != null) return false
            if (isRunning || startPending) return true
            startPending = true
            val intent = Intent(context, SyncForegroundService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_GENERATION, generation)
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
                else context.startService(intent)
            } catch (error: Exception) {
                startPending = false
                throw error
            }
            return true
        }

        @Synchronized
        fun requestStop(context: Context) {
            generation += 1
            startPending = false
            stoppedByUser = true
            // 包括尚未执行 onStartCommand 的请求。
            context.stopService(Intent(context, SyncForegroundService::class.java))
            ServiceRuntimeSession.requestStop(ServiceRuntimeSession.currentSessionId())
        }

        @Synchronized
        private fun acceptStart(intent: Intent?): Boolean {
            if (intent != null && intent.getLongExtra(EXTRA_GENERATION, -1L) != generation) return false
            startPending = false
            return true
        }

        fun onRuntimeFailed() {
            instance?.pauseAndStop("temporary", showRecovery = true)
        }

        /** 仅正在运行的服务绑定当前会话；等待销毁的旧服务不能认领新会话。 */
        fun attachRuntime(sessionId: String) {
            instance?.takeIf { isRunning && !stoppedByUser }?.sessionId = sessionId
        }

        fun getStopReason(context: Context): String? =
            context.getSharedPreferences(PREFS, MODE_PRIVATE).getString(STOP_REASON, null)
        fun clearStopReason(context: Context) {
            context.getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(STOP_REASON).commit()
        }
    }

    private var sessionId: String? = null
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
    private var notificationManager: NotificationManager? = null
    private fun getAppString(name: String): String {
        val resId = resources.getIdentifier(name, "string", APP_PACKAGE)
        return if (resId != 0) getString(resId) else name
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
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
                    if (!acceptStart(intent) || getStopReason(this) != null) {
                        stoppedByUser = true
                        stopSelfResult(startId)
                        return START_NOT_STICKY
                    }
                    stoppedByUser = false
                    isRunning = true
                    sessionId = ServiceRuntimeSession.ensureStarted(this)
                } catch (error: Exception) {
                    NativeLogger.e(TAG, "Cannot start foreground sync", error)
                    synchronized(Companion) { startPending = false }
                    // 提升失败时保留独立启动的 Headless 会话，让 JS 完成有限的悬浮窗重试。
                    if (isRunning) {
                        pauseAndStop("temporary", showRecovery = true)
                    } else {
                        stopForeground(STOP_FOREGROUND_REMOVE)
                        stopSelfResult(startId)
                    }
                    return START_NOT_STICKY
                }
            }
            else -> return START_NOT_STICKY
        }
        return if (isRunning) START_STICKY else START_NOT_STICKY
    }

    private fun promoteToForeground() {
        val notification = createNotification(getAppString("fg_notification_running"))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFY_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFY_ID, notification)
        }
    }

    private fun pauseAndStop(reason: String, showRecovery: Boolean = false) {
        // 先持久化，确保 JS 尚未启动或进程随后死亡时也不会丢失用户的停止操作。
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(STOP_REASON, reason).commit()
        synchronized(Companion) {
            generation += 1
            startPending = false
            stoppedByUser = true
        }
        ServiceRuntimeSession.currentSessionId()?.let { ServiceRuntimeSession.stop(it) }
        if (reason == "stop") ForegroundServiceModule.sendStopEvent()
        else ForegroundServiceModule.sendTempStopEvent()
        if (showRecovery) showRestartNotification()
        stopForeground(STOP_FOREGROUND_REMOVE)
        isRunning = false
        stopSelf()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // specialUse 当前没有类型专属配额，保留系统超时回调作为防御性清理。
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
        endedSession?.let { ServiceRuntimeSession.stop(it) }
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
