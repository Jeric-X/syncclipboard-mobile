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

/** 由 Headless 管理的前台服务；仅系统 Sticky 重建时反向恢复 Headless。 */
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
        @Volatile private var instance: SyncForegroundService? = null
        private val launchState = ForegroundServiceLaunchState()
        val isRunning get() = launchState.isRunning
        private const val EXTRA_GENERATION = "generation"

        @Synchronized
        fun requestStart(context: Context): Boolean {
            if (getStopReason(context) != null) return false
            val token = launchState.requestStart() ?: return true
            dispatchStart(context, token)
            return true
        }

        /** 调用方持有 Companion 锁，停止请求不能穿过代号检查与 Intent 发送。 */
        private fun dispatchStart(context: Context, token: Long) {
            val intent = Intent(context, SyncForegroundService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_GENERATION, token)
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
                else context.startService(intent)
            } catch (error: Exception) {
                launchState.rejectStart(token)
                throw error
            }
        }

        @Synchronized
        fun requestStop(context: Context) {
            stopForegroundService(
                launchState,
                hasInstance = instance != null,
                stopNative = { context.stopService(Intent(context, SyncForegroundService::class.java)) }
            )
        }

        @Synchronized
        private fun acceptStart(intent: Intent?): Boolean {
            return launchState.acceptStart(intent?.getLongExtra(EXTRA_GENERATION, -1L))
        }

        fun getStopReason(context: Context): String? =
            context.getSharedPreferences(PREFS, MODE_PRIVATE).getString(STOP_REASON, null)
        fun clearStopReason(context: Context) {
            context.getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(STOP_REASON).commit()
        }
    }

    private val sessionId: String? get() = ServiceRuntimeSession.currentSessionId()
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
                forwardControl("stop")
                return START_NOT_STICKY
            }
            ACTION_TEMP_STOP -> {
                forwardControl("temporary")
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
                    if (getStopReason(this) != null || !acceptStart(intent)) {
                        stopSelfResult(startId)
                        return START_NOT_STICKY
                    }
                    // 普通启动由 Headless 发起，不反向创建运行时。
                    if (intent == null) ServiceRuntimeSession.ensureStarted(this)
                } catch (error: Exception) {
                    NativeLogger.e(TAG, "Cannot start foreground sync", error)
                    // 前台服务失败不能结束 Headless，也不能修改用户暂停状态。
                    synchronized(Companion) {
                        launchState.requestStop(hasInstance = true)
                    }
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelfResult(startId)
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

    /** 只保存并转发用户命令，任务停止和偏好更新由 Headless 执行。 */
    private fun forwardControl(reason: String) {
        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        // 永久停止优先，随后划掉主界面的临时停止不能覆盖它。
        val pending = if (prefs.getString(STOP_REASON, null) == "stop") "stop" else reason
        prefs.edit().putString(STOP_REASON, pending).commit()
        if (pending == "stop") ForegroundServiceModule.sendStopEvent()
        else ForegroundServiceModule.sendTempStopEvent()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // specialUse 当前没有类型专属配额，保留系统超时回调作为防御性清理。
    override fun onTimeout(startId: Int, fgsType: Int) {
        NativeLogger.w(TAG, "Foreground service timeout, type=$fgsType")
        // 系统要求立即结束前台服务，但不改变 Headless 的任务策略。
        requestStop(this)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelfResult(startId)
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        if (rootIntent?.component?.className?.endsWith(".MainActivity") == true) {
            forwardControl("temporary")
        }
    }

    override fun onDestroy() {
        synchronized(Companion) {
            if (instance === this) {
                instance = null
                val restart = launchState.onDestroyed()
                if (restart != null) {
                    if (getStopReason(this) == null) {
                        try {
                            // 只兑现等待销毁期间的显式请求，不因意外销毁循环拉起。
                            dispatchStart(applicationContext, restart)
                        } catch (error: Exception) {
                            NativeLogger.e(TAG, "Cannot dispatch queued foreground start", error)
                        }
                    } else {
                        launchState.rejectStart(restart)
                    }
                }
            }
        }
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
}

/** 取消跨 JS 重载保留的前台服务请求，不改变 Headless 会话。 */
internal fun stopForegroundService(
    state: ForegroundServiceLaunchState,
    hasInstance: Boolean,
    stopNative: () -> Unit
) {
    state.requestStop(hasInstance)
    stopNative()
}
