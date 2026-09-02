package com.jericx.syncclipboardmobile.xposed

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ClipboardHookSignaturePolicyTest {
    @Test
    fun selectsDeviceScopedCommitWithoutHookingPerUserInternalOverload() {
        val selection = selectExactClipboardCommitHook(
            listOf(
                signature(
                    EXACT_COMMIT_METHOD,
                    "com.android.server.clipboard.ClipboardService\$Clipboard",
                    CLIP_DATA,
                    INT,
                    STRING,
                ),
                signature(EXACT_COMMIT_METHOD, CLIP_DATA, INT, INT, STRING),
            )
        )

        assertEquals(ExactClipboardCommitHookLayout.DEVICE_SCOPED, selection?.layout)
    }

    @Test
    fun selectsLegacyDefaultDeviceCommit() {
        val selection = selectExactClipboardCommitHook(
            listOf(signature(EXACT_COMMIT_METHOD, CLIP_DATA, INT, STRING))
        )

        assertEquals(ExactClipboardCommitHookLayout.LEGACY_DEFAULT_DEVICE, selection?.layout)
    }

    @Test
    fun rejectsUnknownCommitSignature() {
        val selection = selectExactClipboardCommitHook(
            listOf(signature(EXACT_COMMIT_METHOD, CLIP_DATA, STRING))
        )

        assertNull(selection)
    }

    @Test
    fun prefersDeviceScopedCommitWhenBothKnownLayoutsExist() {
        val selection = selectExactClipboardCommitHook(
            listOf(
                signature(EXACT_COMMIT_METHOD, CLIP_DATA, INT, STRING),
                signature(EXACT_COMMIT_METHOD, CLIP_DATA, INT, INT, STRING),
            )
        )

        assertEquals(ExactClipboardCommitHookLayout.DEVICE_SCOPED, selection?.layout)
    }

    @Test
    fun selectsDeviceScopedListenerRegistration() {
        val selection = selectClipboardListenerHook(
            listOf(
                signature(
                    ADD_LISTENER_METHOD,
                    LISTENER,
                    STRING,
                    STRING,
                    INT,
                    INT,
                )
            ),
            ADD_LISTENER_METHOD,
        )

        assertEquals(ClipboardListenerHookLayout.DEVICE_SCOPED, selection?.layout)
    }

    @Test
    fun selectsLegacyListenerRegistration() {
        val selection = selectClipboardListenerHook(
            listOf(signature(REMOVE_LISTENER_METHOD, LISTENER, STRING, INT)),
            REMOVE_LISTENER_METHOD,
        )

        assertEquals(ClipboardListenerHookLayout.LEGACY_DEFAULT_DEVICE, selection?.layout)
    }

    @Test
    fun rejectsListenerRegistrationWithUnknownExtraParameter() {
        val selection = selectClipboardListenerHook(
            listOf(signature(ADD_LISTENER_METHOD, LISTENER, STRING, INT, STRING)),
            ADD_LISTENER_METHOD,
        )

        assertNull(selection)
    }

    private fun signature(name: String, vararg parameterTypes: String) =
        ClipboardHookMethodSignature(name, parameterTypes.toList())

    private companion object {
        const val CLIP_DATA = "android.content.ClipData"
        const val LISTENER = "android.content.IOnPrimaryClipChangedListener"
        const val INT = "int"
        const val STRING = "java.lang.String"
    }
}
