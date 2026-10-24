package expo.modules.foregroundservice

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import expo.modules.nativeutil.NativeLogger

/** 外部恢复只进入 Headless；前台服务及悬浮窗由 JS 子系统自行管理。 */
class ShizukuRecoveryReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ShizukuRecovery.ACTION || !ShizukuRecovery.isAllowed(context, intent)) return
        val pending = goAsync()
        val startedAt = SystemClock.elapsedRealtime()
        try {
            val sessionId = ServiceRuntimeSession.ensureStarted(context)
            if (sessionId == null) {
                pending.finish()
                return
            }
            // ReactHost 异步启动时保留广播生命周期；就绪、会话结束或八秒后释放，
            // 不等待长驻 Headless 任务结束，也不占满广播的十秒执行预算。
            val handler = Handler(Looper.getMainLooper())
            val completion = object : Runnable {
                override fun run() {
                    if (ServiceRuntimeSession.currentSessionId() != sessionId ||
                        ServiceRuntimeSession.isReady() ||
                        SystemClock.elapsedRealtime() - startedAt >= 8_000L) {
                        pending.finish()
                    } else {
                        handler.postDelayed(this, 100L)
                    }
                }
            }
            completion.run()
        } catch (error: Exception) {
            pending.finish()
            NativeLogger.e("ShizukuRecovery", "Cannot recover Headless from Shizuku", error)
        }
    }
}
