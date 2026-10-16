package expo.modules.shizukuclipboard

import android.app.PendingIntent
import android.os.IBinder
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** 在 shell 进程监听独立 Binder，不依赖剪贴板订阅或轮询 App 进程列表。 */
internal class RecoveryWatch {
    private val executor = Executors.newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "shizuku-recovery").apply { isDaemon = true }
    }
    private val guard = ProcessRecoveryGuard<IBinder>(
        now = SystemClock::elapsedRealtime,
        link = { token, died ->
            val recipient = IBinder.DeathRecipient { died() }
            token.linkToDeath(recipient, 0)
            val unlink: () -> Unit = {
                try { token.unlinkToDeath(recipient, 0) } catch (_: Exception) { }
            }
            unlink
        },
        schedule = { recover ->
            val future = executor.schedule({ recover() }, 2, TimeUnit.SECONDS)
            val cancel: () -> Unit = { future.cancel(false); Unit }
            cancel
        }
    )

    fun watch(token: IBinder, recovery: PendingIntent) {
        guard.watch(token) {
            try {
                // PendingIntent 由 App 创建，shell 无须访问未导出的服务或私有配置。
                recovery.send(null, 0, null, null, null, null, recoveryOptions())
                Log.i("ShizukuRecovery", "Requested Headless recovery after process death")
            } catch (error: Exception) {
                // 已取消、强制停止或系统拒绝均不循环拉起；下一次有效注册才重新守护。
                Log.w("ShizukuRecovery", "Recovery request failed", error)
            }
        }
    }

    fun clear(token: IBinder) = guard.clear(token)

    fun ready(token: IBinder) = guard.ready(token)

    /**
     * PendingIntent 按创建者身份启动服务，不会自动继承 shell 的后台启动权限。
     * Android 12+ 由 shell 授予本次启动十秒临时豁免；不修改永久电池优化设置。
     * 此隐藏 API 只在不受非 SDK 限制的 UserService 内使用。
     */
    private fun recoveryOptions(): Bundle? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return null
        val optionsClass = Class.forName("android.app.BroadcastOptions")
        val exemptions = Class.forName("android.os.PowerExemptionManager")
        val options = optionsClass.getMethod("makeBasic").invoke(null)
        optionsClass.getMethod(
            "setTemporaryAppAllowlist", Long::class.javaPrimitiveType,
            Int::class.javaPrimitiveType, Int::class.javaPrimitiveType, String::class.java
        ).invoke(
            options, 10_000L,
            exemptions.getField("TEMPORARY_ALLOW_LIST_TYPE_FOREGROUND_SERVICE_ALLOWED").getInt(null),
            exemptions.getField("REASON_SHELL").getInt(null), "Shizuku sync recovery"
        )
        return optionsClass.getMethod("toBundle").invoke(options) as Bundle
    }

    fun close() {
        guard.close()
        executor.shutdownNow()
    }
}
