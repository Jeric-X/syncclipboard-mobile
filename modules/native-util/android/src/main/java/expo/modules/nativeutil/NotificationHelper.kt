package expo.modules.nativeutil

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat

internal data class NativeNotificationOptions(
    val id: Int,
    val channelId: String,
    val channelName: String,
    val title: String,
    val content: String,
    val importance: String,
    val timeoutMs: Long,
    val autoCancel: Boolean,
    val openApp: Boolean
)

/** Shared Android system-notification implementation exposed by native-util. */
internal object NotificationHelper {
    fun show(context: Context?, options: NativeNotificationOptions): Boolean {
        if (context == null || options.channelId.isBlank()) return false

        return try {
            val manager =
                context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            ensureChannel(manager, options)

            val builder = NotificationCompat.Builder(context, options.channelId)
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle(options.title)
                .setContentText(options.content)
                .setStyle(NotificationCompat.BigTextStyle().bigText(options.content))
                .setAutoCancel(options.autoCancel)
                .setOnlyAlertOnce(true)
                .setPriority(resolvePriority(options.importance))

            if (options.timeoutMs > 0) {
                builder.setTimeoutAfter(options.timeoutMs)
            }
            if (options.openApp) {
                createLaunchIntent(context, options.id)?.let(builder::setContentIntent)
            }

            manager.notify(options.id, builder.build())
            true
        } catch (_: SecurityException) {
            NativeLogger.w("NotificationHelper", "Notification permission unavailable")
            false
        } catch (error: IllegalArgumentException) {
            NativeLogger.e("NotificationHelper", "Invalid notification options", error)
            false
        }
    }

    fun cancel(context: Context?, notificationId: Int): Boolean {
        if (context == null) return false

        return try {
            val manager =
                context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.cancel(notificationId)
            true
        } catch (_: SecurityException) {
            false
        }
    }

    private fun createLaunchIntent(context: Context, notificationId: Int): PendingIntent? =
        context.packageManager
            .getLaunchIntentForPackage(context.packageName)
            ?.let { launchIntent ->
                PendingIntent.getActivity(
                    context,
                    notificationId,
                    launchIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
            }

    private fun ensureChannel(
        manager: NotificationManager,
        options: NativeNotificationOptions
    ) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        manager.createNotificationChannel(
            NotificationChannel(
                options.channelId,
                options.channelName,
                resolveChannelImportance(options.importance)
            )
        )
    }

    private fun resolveChannelImportance(importance: String): Int = when (importance) {
        "min" -> NotificationManager.IMPORTANCE_MIN
        "default" -> NotificationManager.IMPORTANCE_DEFAULT
        "high" -> NotificationManager.IMPORTANCE_HIGH
        else -> NotificationManager.IMPORTANCE_LOW
    }

    private fun resolvePriority(importance: String): Int = when (importance) {
        "min" -> NotificationCompat.PRIORITY_MIN
        "default" -> NotificationCompat.PRIORITY_DEFAULT
        "high" -> NotificationCompat.PRIORITY_HIGH
        else -> NotificationCompat.PRIORITY_LOW
    }
}
