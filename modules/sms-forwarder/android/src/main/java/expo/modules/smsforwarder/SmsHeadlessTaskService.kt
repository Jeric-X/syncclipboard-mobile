package expo.modules.smsforwarder

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Bundle
import expo.modules.nativeutil.NativeLogger
import androidx.core.app.NotificationCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Headless JS 任务服务 — 在后台（无 Activity / 无 UI）启动 React Native JS 运行时，
 * 执行短信验证码提取与上传。
 *
 * 由 [StaticSmsReceiver] 通过 `startForegroundService()` 启动。
 * 启动后立即调用 `startForeground()` 以满足 Android 8+ 要求。
 *
 * 上传成功后发送成功通知（30 秒后自动清除），随即停止前台服务。
 * 新 SMS 到来会替换通知并重新处理。
 */
class SmsHeadlessTaskService : HeadlessJsTaskService() {

    companion object {
        private const val TAG = "SmsHeadlessTask"
        private const val APP_PACKAGE = "com.jericx.syncclipboardmobile"
        const val CHANNEL_ID = "syncclipboard_sms_headless"
        const val NOTIFICATION_ID = 0x2022
        const val TASK_NAME = "SmsUploadTask"
        const val ACTION_DISMISS = "expo.modules.smsforwarder.ACTION_DISMISS_COUNTDOWN"
        private const val TASK_TIMEOUT_MS = 60_000L
        private const val SUCCESS_NOTIFICATION_TIMEOUT_MS = 30_000L

        @Volatile
        private var instance: SmsHeadlessTaskService? = null

        @Volatile
        var pendingSuccessCode: String? = null

        private fun getAppString(context: Context, name: String): String {
            val resId = context.resources.getIdentifier(name, "string", APP_PACKAGE)
            return if (resId != 0) context.getString(resId) else name
        }

        private fun getAppStringFormatted(context: Context, name: String, vararg args: Any): String {
            val resId = context.resources.getIdentifier(name, "string", APP_PACKAGE)
            return if (resId != 0) context.getString(resId, *args) else name
        }

        fun updateNotificationText(context: Context, text: String) {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                ?: return
            ensureNotificationChannel(context, nm)
            nm.notify(NOTIFICATION_ID, buildStaticNotification(
                context, "SyncClipboard", text,
                dismissButtonLabel = getAppString(context, "sms_cancel")
            ))
        }

        fun startCountdown(code: String) {
            NativeLogger.d(TAG, "startCountdown called with code=$code")
            pendingSuccessCode = code
            instance?.let { service ->
                if (!service.isSuccessPosted) {
                    pendingSuccessCode = null
                    service.postSuccessNotification(code)
                }
            }
        }

        private fun ensureNotificationChannel(context: Context, nm: NotificationManager) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    getAppString(context, "sms_channel_name"),
                    NotificationManager.IMPORTANCE_LOW
                ).apply {
                    description = getAppString(context, "sms_channel_desc")
                    setShowBadge(false)
                    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                }
                nm.createNotificationChannel(channel)
            }
        }

        private fun getNotificationIcon(context: Context): Int {
            return context.resources.getIdentifier(
                "ic_notification", "drawable", context.packageName
            ).takeIf { it != 0 }
                ?: context.resources.getIdentifier(
                    "ic_launcher_foreground", "mipmap", context.packageName
                ).takeIf { it != 0 }
                ?: android.R.drawable.ic_menu_info_details
        }

        private fun buildStaticNotification(
            context: Context,
            title: String,
            text: String,
            dismissButtonLabel: String? = null
        ): Notification {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            ensureNotificationChannel(context, nm)
            val builder = NotificationCompat.Builder(context, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(text)
                .setSmallIcon(getNotificationIcon(context))
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
            if (dismissButtonLabel != null) {
                val dismissIntent = Intent(context, SmsHeadlessTaskService::class.java).apply {
                    action = ACTION_DISMISS
                }
                val pendingIntent = PendingIntent.getForegroundService(
                    context, 0, dismissIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                builder.addAction(0, dismissButtonLabel, pendingIntent)
            }
            return builder.build()
        }
    }

    private var isSuccessPosted = false

    override fun onCreate() {
        NativeLogger.d(TAG, "[A] onCreate entered (before super.onCreate) — process=${android.os.Process.myPid()}")
        try {
            super.onCreate()
            NativeLogger.d(TAG, "[B] super.onCreate() returned successfully")
        } catch (e: Exception) {
            NativeLogger.e(TAG, "[B] super.onCreate() threw ${e.javaClass.simpleName}: ${e.message}", e)
            throw e
        }
        instance = this
        pendingSuccessCode = null
        NativeLogger.d(TAG, "[C] Building foreground notification")
        val notification = buildStaticNotification(this, "SyncClipboard", getAppString(this, "sms_processing"))
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            NativeLogger.d(TAG, "[D] startForeground() completed")
        } catch (e: Exception) {
            NativeLogger.e(TAG, "[D] startForeground() threw ${e.javaClass.simpleName}: ${e.message}", e)
            throw e
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        NativeLogger.d(TAG, "[E] onStartCommand entered, action=${intent?.action}, startId=$startId")
        // "取消"按钮触发
        if (intent?.action == ACTION_DISMISS) {
            NativeLogger.d(TAG, "Dismiss action received, stopping service")
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        // 新 SMS 到来 → 重置成功状态
        if (isSuccessPosted) {
            isSuccessPosted = false
            NativeLogger.d(TAG, "New SMS arrived, resetting success state")
        }
        return try {
            super.onStartCommand(intent, flags, startId)
        } catch (e: Exception) {
            NativeLogger.e(TAG, "HeadlessJsTaskService failed to start React context: " +
                    "${e.javaClass.simpleName}: ${e.message}", e)
            updateNotificationText(this,
                getAppStringFormatted(this, "sms_upload_failed", "JS runtime not ready: ${e.javaClass.simpleName}: ${e.message}"))
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }, 5000)
            START_NOT_STICKY
        }
    }

    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
        val extras: Bundle = intent?.extras ?: return null
        val from = extras.getString("from", "")
        val body = extras.getString("body", "")
        if (body.isNullOrEmpty()) {
            NativeLogger.w(TAG, "getTaskConfig: body is null or empty, skipping task (from=$from)")
            return null
        }

        NativeLogger.d(TAG, "Creating headless task config for SMS from=$from")

        return HeadlessJsTaskConfig(
            TASK_NAME,
            Arguments.fromBundle(extras),
            TASK_TIMEOUT_MS,
            true  // allowedInForeground: 即使 app 在前台也可以执行
        )
    }

    // 使用基类按本服务的 taskId 结束任务。其他 Headless 任务（持续同步）完成时，
    // 不得提前停止尚在上传短信的服务。
    override fun onHeadlessJsTaskFinish(taskId: Int) {
        NativeLogger.d(TAG, "Headless task finished: $taskId")
        super.onHeadlessJsTaskFinish(taskId)
    }

    override fun onDestroy() {
        if (!isSuccessPosted) {
            pendingSuccessCode?.let { code ->
                pendingSuccessCode = null
                postSuccessNotification(code)
            }
        }
        instance = null
        super.onDestroy()
    }

    private fun postSuccessNotification(code: String) {
        NativeLogger.d(TAG, "Posting success notification for code=$code, stopping service")
        isSuccessPosted = true
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        ensureNotificationChannel(this, nm)

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getAppStringFormatted(this, "sms_uploaded_title", code))
            .setContentText(getAppString(this, "sms_auto_close"))
            .setSmallIcon(getNotificationIcon(this))
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(false)
            .setAutoCancel(true)
            .setTimeoutAfter(SUCCESS_NOTIFICATION_TIMEOUT_MS)
            .build()

        stopForeground(STOP_FOREGROUND_DETACH)
        nm.notify(NOTIFICATION_ID, notification)
        stopSelf()
    }
}
