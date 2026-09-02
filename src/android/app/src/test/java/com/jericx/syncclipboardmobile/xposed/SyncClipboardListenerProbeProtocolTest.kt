package com.jericx.syncclipboardmobile.xposed

import android.os.Process
import expo.modules.shizukuclipboard.SyncClipboardListenerProbeProtocol
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncClipboardListenerProbeProtocolTest {
    private val requestNonce = 0x1020304050607080L

    @Test
    fun acceptsMatchingHandshakeResponse() {
        assertTrue(
            SyncClipboardListenerProbeProtocol.isValidResponse(
                SyncClipboardListenerProbeProtocol.RESPONSE_MAGIC,
                SyncClipboardListenerProbeProtocol.VERSION,
                SyncClipboardListenerProbeProtocol.responseNonce(requestNonce),
                requestNonce,
            )
        )
    }

    @Test
    fun rejectsWrongMagic() {
        assertFalse(
            SyncClipboardListenerProbeProtocol.isValidResponse(
                0,
                SyncClipboardListenerProbeProtocol.VERSION,
                SyncClipboardListenerProbeProtocol.responseNonce(requestNonce),
                requestNonce,
            )
        )
    }

    @Test
    fun rejectsWrongVersion() {
        assertFalse(
            SyncClipboardListenerProbeProtocol.isValidResponse(
                SyncClipboardListenerProbeProtocol.RESPONSE_MAGIC,
                SyncClipboardListenerProbeProtocol.VERSION + 1,
                SyncClipboardListenerProbeProtocol.responseNonce(requestNonce),
                requestNonce,
            )
        )
    }

    @Test
    fun rejectsReplayedNonce() {
        assertFalse(
            SyncClipboardListenerProbeProtocol.isValidResponse(
                SyncClipboardListenerProbeProtocol.RESPONSE_MAGIC,
                SyncClipboardListenerProbeProtocol.VERSION,
                SyncClipboardListenerProbeProtocol.responseNonce(requestNonce + 1),
                requestNonce,
            )
        )
    }

    @Test
    fun probesShizukuShellUidCandidate() {
        assertTrue(shouldProbeSyncClipboardListener(Process.SHELL_UID))
    }

    @Test
    fun skipsOrdinaryAppListener() {
        assertFalse(shouldProbeSyncClipboardListener(Process.FIRST_APPLICATION_UID))
    }
}
