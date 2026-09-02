package expo.modules.foregroundservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import expo.modules.nativeutil.NativeLogger
import androidx.core.app.NotificationCompat

class SyncForegroundService : Service() {

    companion object {
        private const val TAG = "SyncForegroundService"
        private const val APP_PACKAGE = "com.jericx.syncclipboardmobile"
        const val CHANNEL_ID = "syncclipboard_foreground"
        const val NOTIFY_ID = 0x2020
        const val ACTION_START = "START"
        const val ACTION_STOP = "STOP"
        const val ACTION_TEMP_STOP = "TEMP_STOP"
        const val ACTION_UPDATE = "UPDATE"
        const val EXTRA_CONTENT = "content"
        const val RESTART_NOTIFY_ID = 0x2021
        private const val RESTART_CHANNEL_ID = "syncclipboard_restart"

        var isRunning = false
            private set

        internal var stoppedByUser = false
    }

    private var notificationManager: NotificationManager? = null

    private fun getAppString(name: String): String {
        val resId = resources.getIdentifier(name, "string", APP_PACKAGE)
        return if (resId != 0) getString(resId) else name
    }

    override fun onCreate() {
        super.onCreate()
        NativeLogger.d(TAG, "Service onCreate")
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        NativeLogger.d(TAG, "onStartCommand action=${intent?.action} flags=$flags startId=$startId")
        when (intent?.action) {
            ACTION_START, null -> {
                NativeLogger.d(TAG, "Starting foreground, intent action=${intent?.action}")

                // 系统 START_STICKY 重启时：
                //   - intent 为 null：系统直接重启
                //   - intent.action == ACTION_START 但 jsInitiatedService == false：
                //     系统重投了上次的 ACTION_START intent，JS 并未实际运行
                // 以上两种情况：JS 不存在，不启动前台服务，仅发重启引导通知
                if (intent == null || !ForegroundServiceModule.isJsRuntimeAlive()) {
                    NativeLogger.w(TAG, "Service restarted by system (intent=${intent?.action}, jsAlive=${ForegroundServiceModule.isJsRuntimeAlive()}), JS not running, showing restart notification")
                    showRestartNotification()
                    stoppedByUser = true  // 防止 onDestroy 再次发重启通知
                    stopSelf()
                    return START_NOT_STICKY
                }

                val notification = createNotification(getAppString("fg_notification_running"))
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    startForeground(NOTIFY_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
                } else {
                    startForeground(NOTIFY_ID, notification)
                }
                NativeLogger.d(TAG, "startForeground called successfully")
                isRunning = true
            }
            ACTION_STOP -> {
                NativeLogger.d(TAG, "Stopping foreground service (permanent)")
                stoppedByUser = true
                if (!isRunning) {
                    val notification = createNotification(getAppString("fg_notification_stopping"))
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                        startForeground(NOTIFY_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
                    } else {
                        startForeground(NOTIFY_ID, notification)
                    }
                }
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                isRunning = false
                ForegroundServiceModule.sendStopEvent()
            }
            ACTION_TEMP_STOP -> {
                NativeLogger.d(TAG, "Stopping foreground service (temporary)")
                stoppedByUser = true
                if (!isRunning) {
                    val notification = createNotification(getAppString("fg_notification_stopping"))
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                        startForeground(NOTIFY_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
                    } else {
                        startForeground(NOTIFY_ID, notification)
                    }
                }
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                isRunning = false
                ForegroundServiceModule.sendTempStopEvent()
            }
            ACTION_UPDATE -> {
                val content = intent.getStringExtra(EXTRA_CONTENT) ?: getAppString("fg_notification_running")
                updateNotification(content)
            }
            else -> {
                val notification = createNotification(getAppString("fg_notification_running"))
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    startForeground(NOTIFY_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
                } else {
                    startForeground(NOTIFY_ID, notification)
                }
                isRunning = true
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    /** Android 14+ shortService timeout callback. Kept as a defensive legacy path. */
    @androidx.annotation.RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
    override fun onTimeout(startId: Int) {
        NativeLogger.w(TAG, "Foreground service timed out via shortService callback, startId=$startId")
        stopAfterTimeout()
    }

    /**
     * Android 15+ callback for time-limited foreground service types such as dataSync.
     * The service must stop promptly after this callback to avoid a system ANR.
     */
    @androidx.annotation.RequiresApi(Build.VERSION_CODES.VANILLA_ICE_CREAM)
    override fun onTimeout(startId: Int, fgsType: Int) {
        if (!ForegroundServiceTimeoutPolicy.isDataSync(fgsType)) {
            NativeLogger.w(TAG, "Ignoring timeout for unsupported fgsType=$fgsType, startId=$startId")
            super.onTimeout(startId, fgsType)
            return
        }

        NativeLogger.w(
            TAG,
            "dataSync foreground service timed out, startId=$startId, fgsType=$fgsType; stopping gracefully"
        )
        stopAfterTimeout()
    }

    private fun stopAfterTimeout() {
        stoppedByUser = true
        isRunning = false
        // Reuse the temporary-stop event so JS runtime state and other background tasks converge.
        ForegroundServiceModule.sendTempStopEvent()
        showRestartNotification(contentText = getAppString("fg_timeout_content"))
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        val rootClassName = rootIntent?.component?.className.orEmpty()
        val fromMainActivity = rootClassName.endsWith(".MainActivity")

        if (!fromMainActivity) {
            NativeLogger.d(TAG, "onTaskRemoved ignored: root=$rootClassName")
            return
        }

        NativeLogger.d(TAG, "onTaskRemoved: user swiped app from recents, pausing background tasks")
        stoppedByUser = true
        isRunning = false
        // 通知 JS 侧暂停所有后台任务（复用临时停止逻辑，回到前台自动恢复）
        ForegroundServiceModule.sendTempStopEvent()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        NativeLogger.d(TAG, "onDestroy called, stoppedByUser=$stoppedByUser, isRunning=$isRunning")
        val wasRunning = isRunning
        isRunning = false
        // 非用户主动停止且之前确实在运行 → 可能被系统杀死，发通知引导重启
        if (!stoppedByUser && wasRunning) {
            NativeLogger.w(TAG, "Service destroyed unexpectedly, showing restart notification")
            showRestartNotification()
        }
        stoppedByUser = false
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
