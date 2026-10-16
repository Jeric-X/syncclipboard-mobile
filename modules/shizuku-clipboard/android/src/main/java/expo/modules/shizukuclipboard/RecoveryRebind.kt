package expo.modules.shizukuclipboard

/** 只为有效断线安排重连；关闭和新连接使已经出队的旧回调失效。 */
internal class RecoveryRebind(
    private val schedule: (() -> Unit) -> (() -> Unit),
    private val canBind: () -> Boolean,
    private val bind: () -> Unit
) {
    private var generation = 0L
    private var cancelPending: () -> Unit = {}

    @Synchronized
    fun disconnected() {
        cancel()
        val expected = generation
        cancelPending = schedule { execute(expected) }
    }

    @Synchronized
    fun cancel() {
        generation++
        cancelPending()
        cancelPending = {}
    }

    private fun execute(expected: Long) {
        val current = synchronized(this) {
            if (generation != expected) false else {
                generation++
                cancelPending = {}
                true
            }
        }
        // 不持有调度锁调用绑定，避免与连接、模块生命周期锁形成反向顺序。
        if (current && canBind()) bind()
    }
}
