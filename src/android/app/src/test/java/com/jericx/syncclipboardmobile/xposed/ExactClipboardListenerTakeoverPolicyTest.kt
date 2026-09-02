package com.jericx.syncclipboardmobile.xposed

import android.os.Process
import org.junit.Assert.assertFalse
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
}
