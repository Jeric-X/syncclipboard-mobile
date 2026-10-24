package expo.modules.shizukuclipboard

/** 有效断线或绑定失败后有限重试；关闭和新连接使已出队的旧回调失效。 */
internal class UserServiceRebind(
    private val schedule: (Long, () -> Unit) -> (() -> Unit),
    private val canBind: () -> Boolean,
    private val bind: () -> Unit
) {
    private var clipboardRequested = false
    private var recoveryRequested = false
    private val requested get() = clipboardRequested || recoveryRequested

    /** 每个功能只修改自己的需求；停用一方不能取消另一方的重试。 */
    @Synchronized
    fun setClipboardRequested(enabled: Boolean) {
        val wasRequested = requested
        clipboardRequested = enabled
        if (!requested || !wasRequested) cancel()
    }

    @Synchronized
    fun setRecoveryRequested(enabled: Boolean) {
        val wasRequested = requested
        recoveryRequested = enabled
        if (!requested || !wasRequested) cancel()
    }

    private var generation = 0L
    private var retries = 0
    private var pending = false
    private val retryDelays = longArrayOf(2_000L, 5_000L, 15_000L)
    private var cancelPending: () -> Unit = {}

    @Synchronized
    fun disconnected() {
        // 未成功连接就断开同样消耗预算；成功连接处的 cancel 才会清零。
        failed()
    }

    @Synchronized
    fun failed() {
        // 等待线程和主线程超时可能同时报告同一次失败，只排队一次。
        if (pending) return
        invalidatePending()
        if (!requested || !canBind() || retries >= retryDelays.size) return
        val delayMs = retryDelays[retries++]
        val expected = generation
        pending = true
        cancelPending = schedule(delayMs) { execute(expected) }
    }

    @Synchronized
    fun cancel() {
        retries = 0
        invalidatePending()
    }

    private fun invalidatePending() {
        pending = false
        generation++
        cancelPending()
        cancelPending = {}
    }

    private fun execute(expected: Long) {
        val current = synchronized(this) {
            if (generation != expected || !requested) false else {
                generation++
                pending = false
                cancelPending = {}
                true
            }
        }
        // 不持有调度锁调用绑定，避免与连接、模块生命周期锁形成反向顺序。
        if (current && canBind()) bind()
    }
}
