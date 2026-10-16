package expo.modules.foregroundservice

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import expo.modules.nativeutil.NativeLogger
import java.util.UUID

/** 向守护进程授予可撤销的单一恢复能力，不导出接收器，也不清除用户停止状态。 */
object ShizukuRecovery {
    const val ACTION = "SHIZUKU_RECOVER"
    private const val PREFS = "shizuku_recovery"
    private const val TICKET = "ticket"
    private var pendingIntent: PendingIntent? = null
    private var currentOwner: String? = null
    private var readyListener: (() -> Unit)? = null

    @Synchronized
    fun enable(context: Context, owner: String, onReady: () -> Unit): PendingIntent? {
        if (SyncForegroundService.getStopReason(context) != null) return null
        readyListener = onReady
        if (currentOwner == owner) pendingIntent?.let { return it }
        pendingIntent?.cancel()
        pendingIntent = null
        currentOwner = owner
        val ticket = UUID.randomUUID().toString()
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        check(prefs.edit().putString(TICKET, ticket).commit()) { "Cannot persist recovery permission" }
        return PendingIntent.getBroadcast(
            context, 50,
            Intent(context, ShizukuRecoveryReceiver::class.java).apply {
                action = ACTION
                putExtra(TICKET, ticket)
            },
            PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_IMMUTABLE
        ).also { pendingIntent = it }
    }

    @Synchronized
    fun disable(context: Context, owner: String? = null) {
        // 旧 Expo 实例的销毁不能撤销新实例已经注册的守护。
        if (owner != null && currentOwner != null && owner != currentOwner) return
        // 先撤销系统持有的能力，即使偏好写入失败也不能继续拉起。
        val existing = pendingIntent ?: PendingIntent.getBroadcast(
            context, 50, Intent(context, ShizukuRecoveryReceiver::class.java).setAction(ACTION),
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        )
        existing?.cancel()
        pendingIntent = null
        readyListener = null
        if (!context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().remove(TICKET).commit()) {
            NativeLogger.w("ShizukuRecovery", "Cannot persist revoked recovery permission")
        }
    }

    @Synchronized
    fun isAllowed(context: Context, intent: Intent): Boolean = recoveryTicketMatches(
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(TICKET, null),
        intent.getStringExtra(TICKET),
        SyncForegroundService.getStopReason(context) != null
    )

    /** 回调不持有恢复凭证锁，避免与模块订阅锁形成反向锁顺序。 */
    fun notifyRuntimeReady() {
        val listener = synchronized(this) { readyListener }
        listener?.invoke()
    }
}

/** 已发送但尚未处理的旧恢复请求也必须遵守撤销和用户停止。 */
internal fun recoveryTicketMatches(saved: String?, received: String?, stopped: Boolean): Boolean =
    !stopped && saved != null && saved == received
