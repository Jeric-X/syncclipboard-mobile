package expo.modules.shizukuclipboard

/** 独立于 Android 的守护状态机；重绑定取消旧恢复，崩溃循环最多十分钟尝试三次。 */
internal class ProcessRecoveryGuard<T>(
    private val now: () -> Long,
    private val link: (T, () -> Unit) -> (() -> Unit),
    private val schedule: (Long, () -> Unit) -> (() -> Unit)
) {
    private class Watch<T>(val token: T, var recover: () -> Unit) {
        var unlink: () -> Unit = {}
        var cancel: () -> Unit = {}
        var dead = false
        var initializationFailed = false
        var generation = 0L
    }
    private var current: Watch<T>? = null
    private val attempts = ArrayDeque<Long>()

    @Synchronized
    fun watch(token: T, recover: () -> Unit) {
        if (current?.token == token) {
            current?.recover = recover
            return
        }
        close()
        val watch = Watch(token, recover)
        current = watch
        try {
            watch.unlink = link(token) { died(watch) }
        } catch (error: Exception) {
            close()
            throw error
        }
    }

    @Synchronized
    fun clear(token: T) {
        if (current?.token == token) close()
    }

    /** 仅当前存活进程的 Headless 就绪确认能清零，重连接本身不算恢复成功。 */
    @Synchronized
    fun ready(token: T) {
        val watch = current?.takeIf { it.token == token && !it.dead } ?: return
        attempts.clear()
        watch.initializationFailed = false
        watch.generation++
        watch.cancel()
        watch.cancel = {}
    }

    /** 进程仍存活但 Headless 初始化失败时，也使用同一有限预算恢复。 */
    @Synchronized
    fun startupFailed(token: T) {
        val watch = current?.takeIf { it.token == token && !it.dead && !it.initializationFailed } ?: return
        watch.initializationFailed = true
        enqueue(watch, 60_000L)
    }

    @Synchronized
    fun close() {
        val old = current ?: return
        current = null
        old.cancel()
        old.unlink()
    }

    @Synchronized
    private fun died(watch: Watch<T>) {
        if (current !== watch || watch.dead) return
        watch.dead = true
        watch.cancel()
        enqueue(watch, 2_000L)
    }

    /** 每次排队都更新代际，已出队的旧回调不能重复消耗尝试次数。 */
    private fun enqueue(watch: Watch<T>, delayMs: Long) {
        val generation = ++watch.generation
        watch.cancel = schedule(delayMs) { recover(watch, generation) }
    }

    @Synchronized
    private fun recover(watch: Watch<T>, generation: Long) {
        if (current !== watch || (!watch.dead && !watch.initializationFailed) || watch.generation != generation) return
        watch.generation++
        watch.cancel = {}
        val time = now()
        while (attempts.isNotEmpty() && time - attempts.first() >= 600_000L) attempts.removeFirst()
        if (attempts.size >= 3) return
        attempts.addLast(time)
        try {
            watch.recover()
        } finally {
            if (current === watch) {
                // 保留旧凭证以处理 React 启动前崩溃；新注册会取消此重试但不清零预算。
                // 给每次启动完整的一分钟，避免与 Headless 的启动超时相互竞争。
                // 耗尽预算只停止发送，保留监听以接收最后一次启动的成功确认。
                if (attempts.size < 3) enqueue(watch, 60_000L)
            }
        }
    }
}
