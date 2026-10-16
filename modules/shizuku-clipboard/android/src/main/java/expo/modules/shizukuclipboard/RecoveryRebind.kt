package expo.modules.shizukuclipboard

/** 有效断线或绑定失败后有限重试；关闭和新连接使已出队的旧回调失效。 */
internal class RecoveryRebind(
    private val schedule: (Long, () -> Unit) -> (() -> Unit),
    private val canBind: () -> Boolean,
    private val bind: () -> Unit
) {
    private var generation = 0L
    private var retries = 0
    private val retryDelays = longArrayOf(2_000L, 5_000L, 15_000L)
    private var cancelPending: () -> Unit = {}

    @Synchronized
    fun disconnected() {
        // 未成功连接就断开同样消耗预算；成功连接处的 cancel 才会清零。
        failed()
    }

    @Synchronized
    fun failed() {
        invalidatePending()
        if (retries >= retryDelays.size) return
        val delayMs = retryDelays[retries++]
        val expected = generation
        cancelPending = schedule(delayMs) { execute(expected) }
    }

    @Synchronized
    fun cancel() {
        retries = 0
        invalidatePending()
    }

    private fun invalidatePending() {
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
