package expo.modules.foregroundservice

import org.junit.Assert.*
import org.junit.Test

class ForegroundServiceStopTest {
    @Test fun replacementJsCancelsPendingIntentWithoutStoppingIndependentSession() {
        val state = ForegroundServiceLaunchState()
        val old = state.requestStart()!!
        var stoppedNative = false
        stopForegroundService(state, false, null, {
            assertFalse(state.acceptStart(old))
            stoppedNative = true
        }, { fail("Independent Headless session must remain active") })
        assertTrue(stoppedNative)
        assertFalse(state.acceptStart(old))
        val next = state.requestStart()!!
        assertTrue(state.acceptStart(next))
    }

    @Test fun stoppingUntouchedServiceDoesNotStopHeadless() {
        val state = ForegroundServiceLaunchState()
        stopForegroundService(state, false, null, {}, {
            fail("No service owns a Headless session")
        })
        assertFalse(state.isRunning)
        assertTrue(state.acceptStart(state.requestStart()))
    }

    @Test fun stoppingAttachedServiceUsesItsSessionIdAndInvalidatesStartsFirst() {
        val state = ForegroundServiceLaunchState()
        assertTrue(state.acceptStart(state.requestStart()))
        var currentSession = "attached"
        var stoppedSession: String? = null
        stopForegroundService(state, true, currentSession, {
            assertFalse(state.isRunning)
            currentSession = "replacement"
        }, { stoppedSession = it })
        assertEquals("attached", stoppedSession)
        assertEquals("replacement", currentSession)
        assertNull(state.onDestroyed())
    }
}
