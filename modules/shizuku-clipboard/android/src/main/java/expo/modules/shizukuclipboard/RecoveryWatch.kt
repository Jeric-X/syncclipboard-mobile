package expo.modules.shizukuclipboard

import android.app.PendingIntent
import android.os.IBinder
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
        schedule = { delayMs, recover ->
            val future = executor.schedule({ recover() }, delayMs, TimeUnit.MILLISECONDS)
            val cancel: () -> Unit = { future.cancel(false); Unit }
            cancel
        }
    )

    fun watch(token: IBinder, recovery: PendingIntent) {
        guard.watch(token) {
            try {
                // PendingIntent 由 App 创建，shell 无须访问未导出的接收器或私有配置。
                recovery.send()
                Log.i("ShizukuRecovery", "Requested Headless recovery after process death")
            } catch (error: PendingIntent.CanceledException) {
                // 用户撤销或系统强制停止后不可继续重试。
                guard.clear(token)
                Log.i("ShizukuRecovery", "Recovery permission was revoked", error)
            } catch (error: Exception) {
                // 暂时失败保留凭证，由守护状态机按剩余预算重试。
                Log.w("ShizukuRecovery", "Recovery request failed", error)
            }
        }
    }

    fun clear(token: IBinder) = guard.clear(token)

    fun ready(token: IBinder) = guard.ready(token)

    fun close() {
        guard.close()
        executor.shutdownNow()
    }
}
