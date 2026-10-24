package expo.modules.shizukuclipboard

import org.junit.Assert.*
import org.junit.Test

class UserServiceRebindTest {
    private var allowed = true
    private var bindings = 0
    private val delays = mutableListOf<Long>()
    private val queued = mutableListOf<() -> Unit>()
    private val rebind = UserServiceRebind(
        schedule = { delayMs, callback -> delays.add(delayMs); queued.add(callback); {} },
        canBind = { allowed },
        bind = { bindings++ }
    )

    private fun updateRequests(clipboard: Boolean, recovery: Boolean) {
        rebind.setClipboardRequested(clipboard)
        rebind.setRecoveryRequested(recovery)
    }

    init { updateRequests(clipboard = false, recovery = true) }

    @Test fun clipboardAloneCanReconnectWithoutHeadlessRecovery() {
        updateRequests(clipboard = true, recovery = false)
        rebind.disconnected()
        queued.single()()
        assertEquals(1, bindings)
    }

    @Test fun disablingRecoveryDoesNotCancelClipboardRetry() {
        updateRequests(clipboard = true, recovery = true)
        rebind.disconnected()
        updateRequests(clipboard = true, recovery = false)
        queued.single()()
        assertEquals(1, bindings)
    }

    @Test fun disablingClipboardCancelsRetryWhenRecoveryIsOff() {
        updateRequests(clipboard = true, recovery = false)
        rebind.disconnected()
        updateRequests(clipboard = false, recovery = false)
        queued.single()()
        rebind.failed()
        assertEquals(0, bindings)
        assertEquals(1, queued.size)
    }

    @Test fun disablingClipboardPreservesRecoveryRetry() {
        updateRequests(clipboard = true, recovery = true)
        rebind.disconnected()
        updateRequests(clipboard = false, recovery = true)
        queued.single()()
        assertEquals(1, bindings)
    }

    @Test fun reEnablingClipboardStartsANewRetryBudget() {
        updateRequests(clipboard = true, recovery = false)
        repeat(3) { rebind.failed(); queued.last()() }
        updateRequests(clipboard = false, recovery = false)
        updateRequests(clipboard = true, recovery = false)
        rebind.failed()
        queued.last()()
        assertEquals(4, bindings)
        assertEquals(2_000L, delays.last())
    }

    @Test fun disconnectedUserServiceRebindsWithoutClipboardOperations() {
        rebind.disconnected()
        assertEquals(0, bindings)
        queued.single()()
        assertEquals(1, bindings)
        queued.single()()
        assertEquals(1, bindings)
    }

    @Test fun cancellationRejectsEvenDequeuedCallbacks() {
        rebind.disconnected()
        rebind.cancel()
        queued.single()()
        assertEquals(0, bindings)
    }

    @Test fun permissionOrRequestChangesAreCheckedAgainWhenCallbackRuns() {
        rebind.disconnected()
        allowed = false
        queued.single()()
        assertEquals(0, bindings)
    }

    @Test fun duplicateFailureSignalsShareThePendingRetry() {
        rebind.disconnected()
        rebind.disconnected()
        assertEquals(1, queued.size)
        assertEquals(listOf(2_000L), delays)
        queued.first()()
        queued.last()()
        assertEquals(1, bindings)
    }

    @Test fun aFailedInitialBindCanRetryWithoutAnEstablishedDisconnect() {
        rebind.failed()
        assertEquals(1, queued.size)
        queued.single()()
        assertEquals(1, bindings)
    }

    @Test fun repeatedBindFailuresHaveABoundedRetryBudget() {
        rebind.failed()
        repeat(3) {
            assertEquals(it + 1, queued.size)
            queued.last()()
            rebind.failed()
        }
        assertEquals(3, bindings)
        assertEquals(3, queued.size)
        assertEquals(listOf(2_000L, 5_000L, 15_000L), delays)
    }

    @Test fun successfulConnectionResetsBindingFailureBudget() {
        repeat(3) { rebind.failed(); queued.last()() }
        rebind.cancel()
        rebind.failed()
        queued.last()()
        assertEquals(4, bindings)
    }

    @Test fun disconnectsBeforeConnectionDoNotResetTheFailureBudget() {
        repeat(4) {
            rebind.disconnected()
            queued.last()()
        }
        assertEquals(3, bindings)
        assertEquals(listOf(2_000L, 5_000L, 15_000L), delays)
    }
}
