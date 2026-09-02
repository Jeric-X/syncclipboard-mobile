package com.jericx.syncclipboardmobile.xposed

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.Context
import android.os.Binder
import android.os.Handler
import android.os.IBinder
import android.os.IInterface
import android.os.Looper
import android.os.Parcel
import android.os.Process
import android.util.Log
import expo.modules.shizukuclipboard.SyncClipboardListenerProbeProtocol
import io.github.libxposed.api.XposedModule
import io.github.libxposed.api.XposedModuleInterface.ModuleLoadedParam
import io.github.libxposed.api.XposedModuleInterface.SystemServerStartingParam
import java.lang.reflect.Method
import java.util.IdentityHashMap
import java.util.concurrent.atomic.AtomicLong

/** Optional modern libxposed entry point for exact system clipboard commit events. */
class SyncClipboardXposedModule : XposedModule() {
    @Volatile
    var exactWriteHookInstalled: Boolean = false
        private set

    @Volatile
    var listenerTakeoverHookInstalled: Boolean = false
        private set

    private val exactListenerLock = Any()
    private val exactListeners = IdentityHashMap<IBinder, IBinder.DeathRecipient>()

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
        try {
            installListenerTakeoverHooks(param.classLoader)
        } catch (error: Throwable) {
            listenerTakeoverHookInstalled = false
            log(Log.WARN, TAG, "Exact listener takeover unavailable; registrations unchanged", error)
        }
    }

    private fun installExactClipboardWriteHook(classLoader: ClassLoader) {
        val clipboardServiceClass = Class.forName(CLIPBOARD_SERVICE_CLASS, false, classLoader)
        val commitMethods = clipboardServiceClass.declaredMethods.toList()
        val commitSelection = selectExactClipboardCommitHook(commitMethods.map(Method::signature))
            ?: error("No supported exact clipboard commit signature found")
        val commitMethod = commitMethods.singleOrNull { method ->
            method.signature() == commitSelection.signature
        } ?: error("Exact clipboard commit signature is ambiguous")
        val commitLayout = commitSelection.layout
        val eventHandler = Handler(Looper.getMainLooper())

        hook(commitMethod)
            .setId(EXACT_WRITE_HOOK_ID)
            .intercept { chain ->
                val result = chain.proceed()
                val clip = chain.args.getOrNull(commitLayout.clipArgIndex) as? ClipData
                val deviceId = commitLayout.deviceIdArgIndex?.let { index ->
                    chain.args.getOrNull(index) as? Int
                } ?: Context.DEVICE_ID_DEFAULT

                if (shouldDispatchExactClipboardCommit(clip != null, deviceId)) {
                    val uid = chain.args.getOrNull(commitLayout.uidArgIndex) as? Int ?: UNKNOWN_UID
                    val sourcePackage =
                        chain.args.getOrNull(commitLayout.sourcePackageArgIndex) as? String
                    if (!eventHandler.post { dispatchExactClipboardCommit(uid, sourcePackage) }) {
                        log(Log.WARN, TAG, "Exact clipboard commit event dropped: handler unavailable")
                    }
                }
                result
            }

        exactWriteHookInstalled = true
        log(
            Log.INFO,
            TAG,
            "Exact clipboard write hook installed: ${commitSelection.signature.describe()}",
        )
    }

    @SuppressLint("BlockedPrivateApi")
    private fun installListenerTakeoverHooks(classLoader: ClassLoader) {
        val clipboardImplClass = Class.forName(CLIPBOARD_IMPL_CLASS, false, classLoader)
        val listenerMethods = clipboardImplClass.declaredMethods.toList()
        val listenerSignatures = listenerMethods.map(Method::signature)
        val addSelection = selectClipboardListenerHook(listenerSignatures, ADD_LISTENER_METHOD)
            ?: error("No supported clipboard listener add signature found")
        val removeSelection =
            selectClipboardListenerHook(listenerSignatures, REMOVE_LISTENER_METHOD)
                ?: error("No supported clipboard listener remove signature found")
        check(addSelection.layout == removeSelection.layout) {
            "Clipboard listener add/remove signatures use different scope layouts"
        }
        val addListenerMethod = listenerMethods.singleOrNull { method ->
            method.signature() == addSelection.signature
        } ?: error("Clipboard listener add signature is ambiguous")
        val removeListenerMethod = listenerMethods.singleOrNull { method ->
            method.signature() == removeSelection.signature
        } ?: error("Clipboard listener remove signature is ambiguous")
        // Keep the synchronous challenge scoped to this Binder thread; never mark an app-owned
        // BinderProxy as permanently safe for blocking calls from system_server.
        val allowBlockingForCurrentThread = Binder::class.java.getDeclaredMethod(
            ALLOW_BLOCKING_FOR_CURRENT_THREAD_METHOD,
        )
        val defaultBlockingForCurrentThread = Binder::class.java.getDeclaredMethod(
            DEFAULT_BLOCKING_FOR_CURRENT_THREAD_METHOD,
        )

        hook(addListenerMethod)
            .setId(LISTENER_ADD_HOOK_ID)
            .intercept { chain ->
                val listener = chain.args.firstOrNull() as? IInterface
                val callingUid = Binder.getCallingUid()
                if (
                    listener != null &&
                    shouldAttemptExactListenerTakeover(
                        exactWriteHookInstalled,
                        listenerTakeoverHookInstalled,
                        callingUid,
                    ) &&
                    probeSyncClipboardListener(
                        listener.asBinder(),
                        allowBlockingForCurrentThread,
                        defaultBlockingForCurrentThread,
                    ) &&
                    registerExactClipboardListener(listener.asBinder())
                ) {
                    log(Log.INFO, TAG, "Exact listener takeover active; AOSP registration skipped")
                    null
                } else {
                    chain.proceed()
                }
            }

        hook(removeListenerMethod)
            .setId(LISTENER_REMOVE_HOOK_ID)
            .intercept { chain ->
                val listener = chain.args.firstOrNull() as? IInterface
                if (
                    listener != null &&
                    unregisterExactClipboardListener(listener.asBinder())
                ) {
                    log(Log.INFO, TAG, "Exact listener removed; AOSP removal skipped")
                    null
                } else {
                    chain.proceed()
                }
            }

        listenerTakeoverHookInstalled = true
        log(
            Log.INFO,
            TAG,
            "Exact listener takeover hooks installed: ${addSelection.signature.describe()}",
        )
    }

    private fun probeSyncClipboardListener(
        listenerBinder: IBinder,
        allowBlockingForCurrentThread: Method,
        defaultBlockingForCurrentThread: Method,
    ): Boolean {
        val request = Parcel.obtain()
        val response = Parcel.obtain()
        val requestNonce = listenerProbeSequence.incrementAndGet() xor System.nanoTime()
        var blockingAllowed = false
        return try {
            allowBlockingForCurrentThread.invoke(null)
            blockingAllowed = true
            request.writeInterfaceToken(SyncClipboardListenerProbeProtocol.LISTENER_DESCRIPTOR)
            request.writeInt(SyncClipboardListenerProbeProtocol.REQUEST_MAGIC)
            request.writeInt(SyncClipboardListenerProbeProtocol.VERSION)
            request.writeLong(requestNonce)
            if (
                !listenerBinder.transact(
                    SyncClipboardListenerProbeProtocol.TRANSACTION_CODE,
                    request,
                    response,
                    0,
                )
            ) {
                return false
            }
            response.readException()
            SyncClipboardListenerProbeProtocol.isValidResponse(
                response.readInt(),
                response.readInt(),
                response.readLong(),
                requestNonce,
            )
        } catch (error: Throwable) {
            log(Log.WARN, TAG, "Clipboard listener probe failed; registration preserved", error)
            false
        } finally {
            if (blockingAllowed) {
                runCatching { defaultBlockingForCurrentThread.invoke(null) }
                    .onFailure { error ->
                        log(Log.ERROR, TAG, "Failed to restore Binder blocking warnings", error)
                    }
            }
            response.recycle()
            request.recycle()
        }
    }

    private fun registerExactClipboardListener(listenerBinder: IBinder): Boolean {
        synchronized(exactListenerLock) {
            if (exactListeners.containsKey(listenerBinder)) return true
            if (!listenerBinder.isBinderAlive) {
                log(Log.WARN, TAG, "Exact listener takeover failed: listener already dead")
                return false
            }

            val deathRecipient = object : IBinder.DeathRecipient {
                override fun binderDied() {
                    handleExactListenerDeath(listenerBinder, this)
                }
            }
            return try {
                listenerBinder.linkToDeath(deathRecipient, 0)
                exactListeners[listenerBinder] = deathRecipient
                log(Log.INFO, TAG, "Exact listener registered; listeners=${exactListeners.size}")
                true
            } catch (error: Throwable) {
                log(Log.WARN, TAG, "Exact listener takeover failed; AOSP registration preserved", error)
                false
            }
        }
    }

    private fun unregisterExactClipboardListener(listenerBinder: IBinder): Boolean {
        val deathRecipient = synchronized(exactListenerLock) {
            exactListeners.remove(listenerBinder)
        } ?: return false

        runCatching { listenerBinder.unlinkToDeath(deathRecipient, 0) }
            .onFailure { error ->
                log(Log.DEBUG, TAG, "Exact listener death recipient already removed", error)
            }
        return true
    }

    private fun handleExactListenerDeath(
        listenerBinder: IBinder,
        deathRecipient: IBinder.DeathRecipient,
    ) {
        val removed = synchronized(exactListenerLock) {
            if (exactListeners[listenerBinder] !== deathRecipient) {
                false
            } else {
                exactListeners.remove(listenerBinder)
                true
            }
        }
        if (removed) {
            log(Log.INFO, TAG, "Exact listener binder died; registry cleaned")
        }
    }

    private fun exactListenerSnapshot(): List<IBinder> =
        synchronized(exactListenerLock) { exactListeners.keys.toList() }

    private fun dispatchExactClipboardCommit(uid: Int, sourcePackage: String?) {
        val sequence = exactCommitSequence.incrementAndGet()
        val listeners = exactListenerSnapshot()
        log(
            Log.DEBUG,
            TAG,
            "Exact clipboard commit #$sequence uid=$uid sourcePackage=${sourcePackage ?: "unknown"} " +
                "listeners=${listeners.size}",
        )
        listeners.forEach(::dispatchExactListener)
    }

    private fun dispatchExactListener(listenerBinder: IBinder) {
        val data = Parcel.obtain()
        try {
            data.writeInterfaceToken(SyncClipboardListenerProbeProtocol.LISTENER_DESCRIPTOR)
            if (
                !listenerBinder.transact(
                    TRANSACTION_DISPATCH_PRIMARY_CLIP_CHANGED,
                    data,
                    null,
                    IBinder.FLAG_ONEWAY,
                )
            ) {
                log(Log.WARN, TAG, "Exact listener dispatch rejected; removing listener")
                unregisterExactClipboardListener(listenerBinder)
            }
        } catch (error: Throwable) {
            log(Log.WARN, TAG, "Exact listener dispatch failed; removing listener", error)
            unregisterExactClipboardListener(listenerBinder)
        } finally {
            data.recycle()
        }
    }

    private companion object {
        const val TAG = "SyncClipboardXposed"
        const val CLIPBOARD_SERVICE_CLASS = "com.android.server.clipboard.ClipboardService"
        const val CLIPBOARD_IMPL_CLASS =
            "com.android.server.clipboard.ClipboardService\$ClipboardImpl"
        const val ALLOW_BLOCKING_FOR_CURRENT_THREAD_METHOD = "allowBlockingForCurrentThread"
        const val DEFAULT_BLOCKING_FOR_CURRENT_THREAD_METHOD = "defaultBlockingForCurrentThread"
        const val EXACT_WRITE_HOOK_ID = "syncclipboard.exact-clipboard-write"
        const val LISTENER_ADD_HOOK_ID = "syncclipboard.exact-listener-add"
        const val LISTENER_REMOVE_HOOK_ID = "syncclipboard.exact-listener-remove"
        const val TRANSACTION_DISPATCH_PRIMARY_CLIP_CHANGED = IBinder.FIRST_CALL_TRANSACTION
        const val UNKNOWN_UID = -1
        val exactCommitSequence = AtomicLong()
        val listenerProbeSequence = AtomicLong()
    }
}

private fun Method.signature(): ClipboardHookMethodSignature = ClipboardHookMethodSignature(
    name = name,
    parameterTypes = parameterTypes.map { type -> type.name },
)

private fun ClipboardHookMethodSignature.describe(): String =
    "$name(${parameterTypes.joinToString()})"

internal fun shouldDispatchExactClipboardCommit(hasClip: Boolean, deviceId: Int?): Boolean =
    hasClip && deviceId == Context.DEVICE_ID_DEFAULT

internal fun shouldProbeSyncClipboardListener(callingUid: Int): Boolean =
    callingUid == Process.SHELL_UID

internal fun shouldAttemptExactListenerTakeover(
    exactWriteHookInstalled: Boolean,
    listenerTakeoverHookInstalled: Boolean,
    callingUid: Int,
): Boolean =
    exactWriteHookInstalled &&
        listenerTakeoverHookInstalled &&
        shouldProbeSyncClipboardListener(callingUid)
