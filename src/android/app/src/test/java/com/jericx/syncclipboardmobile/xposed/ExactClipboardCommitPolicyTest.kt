package com.jericx.syncclipboardmobile.xposed

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ExactClipboardCommitPolicyTest {
    @Test
    fun dispatchesNonNullClipOnDefaultDevice() {
        assertTrue(shouldDispatchExactClipboardCommit(hasClip = true, deviceId = 0))
    }

    @Test
    fun ignoresClipboardClear() {
        assertFalse(shouldDispatchExactClipboardCommit(hasClip = false, deviceId = 0))
    }

    @Test
    fun ignoresVirtualDeviceClipboard() {
        assertFalse(shouldDispatchExactClipboardCommit(hasClip = true, deviceId = 42))
    }

    @Test
    fun ignoresMissingDeviceId() {
        assertFalse(shouldDispatchExactClipboardCommit(hasClip = true, deviceId = null))
    }
}
