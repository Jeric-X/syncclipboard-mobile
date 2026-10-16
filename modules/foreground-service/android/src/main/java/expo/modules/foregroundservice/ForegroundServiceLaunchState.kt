package expo.modules.foregroundservice

/** 不依赖 Android 的启动状态；停止中的旧实例不能确认新请求已经成功。 */
internal class ForegroundServiceLaunchState {
    @Volatile var isRunning = false
        private set
    private var pending = false
    private var stopping = false
    private var restartRequested = false
    private var generation = 0L

    /** 返回需要发送的请求代号；重复请求或等待销毁的请求不立即发 Intent。 */
    @Synchronized
    fun requestStart(): Long? {
        if (isRunning || pending) return null
        if (stopping) {
            restartRequested = true
            return null
        }
        pending = true
        return generation
    }

    @Synchronized
    fun requestStop(hasInstance: Boolean) {
        generation += 1
        isRunning = false
        pending = false
        stopping = hasInstance
        restartRequested = false
    }

    /** null 是系统 START_STICKY 重启；显式请求必须属于当前代。 */
    @Synchronized
    fun acceptStart(token: Long?): Boolean {
        if (stopping || (token != null && token != generation)) return false
        pending = false
        isRunning = true
        return true
    }

    @Synchronized
    fun rejectStart(token: Long) {
        if (token == generation) pending = false
    }

    /** 旧实例已销毁后，将排队需求转换成一个新的待发送请求。 */
    @Synchronized
    fun onDestroyed(): Long? {
        val restart = restartRequested
        isRunning = false
        pending = false
        stopping = false
        restartRequested = false
        return if (restart) requestStart() else null
    }
}
