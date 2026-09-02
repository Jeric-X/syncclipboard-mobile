package com.jericx.syncclipboardmobile.xposed

import android.os.Process
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ExactClipboardListenerTakeoverPolicyTest {
    @Test
    fun takesOverShellListenerWhenBothHooksAreReady() {
        assertTrue(
            shouldAttemptExactListenerTakeover(
                exactWriteHookInstalled = true,
                listenerTakeoverHookInstalled = true,
                callingUid = Process.SHELL_UID,
            )
        )
    }

    @Test
    fun preservesRegistrationWhenExactWriteHookIsMissing() {
        assertFalse(
            shouldAttemptExactListenerTakeover(
                exactWriteHookInstalled = false,
                listenerTakeoverHookInstalled = true,
                callingUid = Process.SHELL_UID,
            )
        )
    }

    @Test
    fun preservesRegistrationWhileTakeoverHooksAreIncomplete() {
        assertFalse(
            shouldAttemptExactListenerTakeover(
                exactWriteHookInstalled = true,
                listenerTakeoverHookInstalled = false,
                callingUid = Process.SHELL_UID,
            )
        )
    }

    @Test
    fun preservesOrdinaryAppListener() {
        assertFalse(
            shouldAttemptExactListenerTakeover(
                exactWriteHookInstalled = true,
                listenerTakeoverHookInstalled = true,
                callingUid = Process.FIRST_APPLICATION_UID,
            )
        )
    }

    @Test
    fun buildsDeviceScopedListenerRegistration() {
        val scope = buildExactClipboardListenerScope(
            ClipboardListenerHookLayout.DEVICE_SCOPED,
            userId = 10,
            deviceId = 0,
        )

        assertEquals(ExactClipboardListenerScope(userId = 10, deviceId = 0), scope)
    }

    @Test
    fun assignsDefaultDeviceToLegacyListenerRegistration() {
        val scope = buildExactClipboardListenerScope(
            ClipboardListenerHookLayout.LEGACY_DEFAULT_DEVICE,
            userId = 10,
            deviceId = null,
        )

        assertEquals(ExactClipboardListenerScope(userId = 10, deviceId = 0), scope)
    }

    @Test
    fun rejectsIncompleteDeviceScopedListenerRegistration() {
        assertNull(
            buildExactClipboardListenerScope(
                ClipboardListenerHookLayout.DEVICE_SCOPED,
                userId = 10,
                deviceId = null,
            )
        )
    }

    @Test
    fun dispatchesOnlyToMatchingUserAndDeviceScope() {
        val personal = ExactClipboardListenerScope(userId = 0, deviceId = 0)
        val work = ExactClipboardListenerScope(userId = 10, deviceId = 0)
        val virtual = ExactClipboardListenerScope(userId = 10, deviceId = 42)

        assertTrue(
            shouldDispatchToExactClipboardListener(
                listenerScope = work,
                commitUserId = 10,
                commitDeviceId = 0,
            )
        )
        assertFalse(
            shouldDispatchToExactClipboardListener(
                listenerScope = personal,
                commitUserId = 10,
                commitDeviceId = 0,
            )
        )
        assertFalse(
            shouldDispatchToExactClipboardListener(
                listenerScope = virtual,
                commitUserId = 10,
                commitDeviceId = 0,
            )
        )
    }

    @Test
    fun derivesAndroidUserFromCommitUid() {
        assertEquals(0, userIdFromUid(1_000))
        assertEquals(10, userIdFromUid(1_012_345))
        assertNull(userIdFromUid(-1))
    }
}
