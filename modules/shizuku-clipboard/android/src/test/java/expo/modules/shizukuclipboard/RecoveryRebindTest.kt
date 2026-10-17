package expo.modules.shizukuclipboard

import org.junit.Assert.*
import org.junit.Test

class RecoveryRebindTest {
    private var allowed = true
    private var bindings = 0
    private val delays = mutableListOf<Long>()
    private val queued = mutableListOf<() -> Unit>()
    private val rebind = RecoveryRebind(
        schedule = { delayMs, callback -> delays.add(delayMs); queued.add(callback); {} },
        canBind = { allowed },
        bind = { bindings++ }
    )

    @Test fun disconnectedRecoveryRebindsWithoutClipboardOperations() {
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

    @Test fun newerDisconnectSupersedesAnOlderPendingCallback() {
        rebind.disconnected()
        rebind.disconnected()
        queued.first()()
        assertEquals(0, bindings)
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
