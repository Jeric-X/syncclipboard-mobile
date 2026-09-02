package com.jericx.syncclipboardmobile.xposed

internal data class ClipboardHookMethodSignature(
    val name: String,
    val parameterTypes: List<String>,
)

internal enum class ExactClipboardCommitHookLayout(
    val parameterTypes: List<String>,
    val clipArgIndex: Int,
    val uidArgIndex: Int,
    val deviceIdArgIndex: Int?,
    val sourcePackageArgIndex: Int,
) {
    DEVICE_SCOPED(
        parameterTypes = listOf(CLIP_DATA, INT, INT, STRING),
        clipArgIndex = 0,
        uidArgIndex = 1,
        deviceIdArgIndex = 2,
        sourcePackageArgIndex = 3,
    ),
    LEGACY_DEFAULT_DEVICE(
        parameterTypes = listOf(CLIP_DATA, INT, STRING),
        clipArgIndex = 0,
        uidArgIndex = 1,
        deviceIdArgIndex = null,
        sourcePackageArgIndex = 2,
    ),
}

internal data class ExactClipboardCommitHookSelection(
    val signature: ClipboardHookMethodSignature,
    val layout: ExactClipboardCommitHookLayout,
)

internal enum class ClipboardListenerHookLayout(
    val parameterTypes: List<String>,
    val listenerArgIndex: Int,
    val userIdArgIndex: Int,
    val deviceIdArgIndex: Int?,
) {
    DEVICE_SCOPED(
        parameterTypes = listOf(PRIMARY_CLIP_CHANGED_LISTENER, STRING, STRING, INT, INT),
        listenerArgIndex = 0,
        userIdArgIndex = 3,
        deviceIdArgIndex = 4,
    ),
    LEGACY_DEFAULT_DEVICE(
        parameterTypes = listOf(PRIMARY_CLIP_CHANGED_LISTENER, STRING, INT),
        listenerArgIndex = 0,
        userIdArgIndex = 2,
        deviceIdArgIndex = null,
    ),
}

internal data class ClipboardListenerHookSelection(
    val signature: ClipboardHookMethodSignature,
    val layout: ClipboardListenerHookLayout,
)

internal data class ExactClipboardListenerScope(
    val userId: Int,
    val deviceId: Int,
)

internal fun selectExactClipboardCommitHook(
    methods: List<ClipboardHookMethodSignature>,
): ExactClipboardCommitHookSelection? {
    for (layout in ExactClipboardCommitHookLayout.values()) {
        val matches = methods.filter { method ->
            method.name == EXACT_COMMIT_METHOD && method.parameterTypes == layout.parameterTypes
        }
        if (matches.size > 1) return null
        if (matches.size == 1) {
            return ExactClipboardCommitHookSelection(matches.single(), layout)
        }
    }
    return null
}

internal fun selectClipboardListenerHook(
    methods: List<ClipboardHookMethodSignature>,
    methodName: String,
): ClipboardListenerHookSelection? {
    if (methodName != ADD_LISTENER_METHOD && methodName != REMOVE_LISTENER_METHOD) return null
    for (layout in ClipboardListenerHookLayout.values()) {
        val matches = methods.filter { method ->
            method.name == methodName && method.parameterTypes == layout.parameterTypes
        }
        if (matches.size > 1) return null
        if (matches.size == 1) {
            return ClipboardListenerHookSelection(matches.single(), layout)
        }
    }
    return null
}

internal fun buildExactClipboardListenerScope(
    layout: ClipboardListenerHookLayout,
    userId: Int?,
    deviceId: Int?,
): ExactClipboardListenerScope? {
    if (userId == null || userId < 0) return null
    val resolvedDeviceId = if (layout.deviceIdArgIndex == null) {
        DEFAULT_DEVICE_ID
    } else {
        deviceId ?: return null
    }
    if (resolvedDeviceId < 0) return null
    return ExactClipboardListenerScope(userId, resolvedDeviceId)
}

internal fun shouldDispatchToExactClipboardListener(
    listenerScope: ExactClipboardListenerScope,
    commitUserId: Int,
    commitDeviceId: Int,
): Boolean =
    listenerScope.userId == commitUserId && listenerScope.deviceId == commitDeviceId

/** Mirrors UserHandle.getUserId without calling the hidden framework API. */
internal fun userIdFromUid(uid: Int): Int? =
    if (uid >= 0) uid / PER_USER_RANGE else null

private const val CLIP_DATA = "android.content.ClipData"
private const val PRIMARY_CLIP_CHANGED_LISTENER =
    "android.content.IOnPrimaryClipChangedListener"
private const val INT = "int"
private const val STRING = "java.lang.String"
private const val DEFAULT_DEVICE_ID = 0
private const val PER_USER_RANGE = 100_000

internal const val EXACT_COMMIT_METHOD = "setPrimaryClipInternalLocked"
internal const val ADD_LISTENER_METHOD = "addPrimaryClipChangedListener"
internal const val REMOVE_LISTENER_METHOD = "removePrimaryClipChangedListener"
