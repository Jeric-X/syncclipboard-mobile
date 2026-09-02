package com.jericx.syncclipboardmobile.xposed

import android.content.ClipData
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import io.github.libxposed.api.XposedModule
import io.github.libxposed.api.XposedModuleInterface.ModuleLoadedParam
import io.github.libxposed.api.XposedModuleInterface.SystemServerStartingParam
import java.util.concurrent.atomic.AtomicLong

/** Optional modern libxposed entry point for exact system clipboard commit events. */
class SyncClipboardXposedModule : XposedModule() {
    @Volatile
    var exactWriteHookInstalled: Boolean = false
        private set

    override fun onModuleLoaded(param: ModuleLoadedParam) {
        log(Log.INFO, TAG, "Module loaded in ${param.processName}")
    }

    override fun onSystemServerStarting(param: SystemServerStartingParam) {
        try {
            installExactClipboardWriteHook(param.classLoader)
        } catch (error: Throwable) {
            exactWriteHookInstalled = false
            log(Log.ERROR, TAG, "Exact clipboard write hook unavailable; no events intercepted", error)
        }
    }

    private fun installExactClipboardWriteHook(classLoader: ClassLoader) {
        val clipboardServiceClass = Class.forName(CLIPBOARD_SERVICE_CLASS, false, classLoader)
        val intType = Int::class.javaPrimitiveType ?: error("Primitive int type unavailable")
        val commitMethod = clipboardServiceClass.getDeclaredMethod(
            EXACT_COMMIT_METHOD,
            ClipData::class.java,
            intType,
            intType,
            String::class.java,
        )
        val eventHandler = Handler(Looper.getMainLooper())

        hook(commitMethod)
            .setId(EXACT_WRITE_HOOK_ID)
            .intercept { chain ->
                val result = chain.proceed()
                val clip = chain.args.getOrNull(CLIP_ARG_INDEX) as? ClipData
                val deviceId = chain.args.getOrNull(DEVICE_ID_ARG_INDEX) as? Int

                if (shouldDispatchExactClipboardCommit(clip != null, deviceId)) {
                    val uid = chain.args.getOrNull(UID_ARG_INDEX) as? Int ?: UNKNOWN_UID
                    val sourcePackage = chain.args.getOrNull(SOURCE_PACKAGE_ARG_INDEX) as? String
                    if (!eventHandler.post { dispatchExactClipboardCommit(uid, sourcePackage) }) {
                        log(Log.WARN, TAG, "Exact clipboard commit event dropped: handler unavailable")
                    }
                }
                result
            }

        exactWriteHookInstalled = true
        log(Log.INFO, TAG, "Exact clipboard write hook installed")
    }

    private fun dispatchExactClipboardCommit(uid: Int, sourcePackage: String?) {
        val sequence = exactCommitSequence.incrementAndGet()
        log(
            Log.DEBUG,
            TAG,
            "Exact clipboard commit #$sequence uid=$uid sourcePackage=${sourcePackage ?: "unknown"}",
        )
    }

    private companion object {
        const val TAG = "SyncClipboardXposed"
        const val CLIPBOARD_SERVICE_CLASS = "com.android.server.clipboard.ClipboardService"
        const val EXACT_COMMIT_METHOD = "setPrimaryClipInternalLocked"
        const val EXACT_WRITE_HOOK_ID = "syncclipboard.exact-clipboard-write"
        const val CLIP_ARG_INDEX = 0
        const val UID_ARG_INDEX = 1
        const val DEVICE_ID_ARG_INDEX = 2
        const val SOURCE_PACKAGE_ARG_INDEX = 3
        const val UNKNOWN_UID = -1
        val exactCommitSequence = AtomicLong()
    }
}

internal fun shouldDispatchExactClipboardCommit(hasClip: Boolean, deviceId: Int?): Boolean =
    hasClip && deviceId == Context.DEVICE_ID_DEFAULT
