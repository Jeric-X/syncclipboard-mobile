package expo.modules.foregroundservice

/** 取消跨 JS 重载保留的原生请求，仅结束已绑定服务的会话，保留独立 Headless。 */
internal fun stopForegroundService(
    state: ForegroundServiceLaunchState,
    hasInstance: Boolean,
    attachedSessionId: String?,
    stopNative: () -> Unit,
    stopSession: (String) -> Unit
) {
    state.requestStop(hasInstance)
    stopNative()
    attachedSessionId?.let(stopSession)
}
