package expo.modules.shizukuclipboard

import org.junit.Assert.*
import org.junit.Test

class RecoveryRebindTest {
    private var allowed = true
    private var bindings = 0
    private val queued = mutableListOf<() -> Unit>()
    private val rebind = RecoveryRebind(
        schedule = { callback -> queued.add(callback); {} },
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
}
