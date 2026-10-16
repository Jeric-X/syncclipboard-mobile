package expo.modules.foregroundservice

import android.app.Service
import org.junit.Assert.*
import org.junit.Test

class ForegroundServiceStopTest {
    @Test fun restartPolicyHonorsStickyAndUserStop() {
        assertEquals(Service.START_STICKY, foregroundServiceRestartMode(true, true, false))
        assertEquals(Service.START_NOT_STICKY, foregroundServiceRestartMode(true, false, false))
        assertEquals(Service.START_NOT_STICKY, foregroundServiceRestartMode(true, true, true))
        assertEquals(Service.START_NOT_STICKY, foregroundServiceRestartMode(false, true, false))
    }

    @Test fun replacementJsCancelsPendingIntentWithoutSessionOwnership() {
        val state = ForegroundServiceLaunchState()
        val old = state.requestStart()!!
        var stoppedNative = false
        stopForegroundService(state, false, {
            assertFalse(state.acceptStart(old))
            stoppedNative = true
        })
        assertTrue(stoppedNative)
        assertFalse(state.acceptStart(old))
        val next = state.requestStart()!!
        assertTrue(state.acceptStart(next))
    }

    @Test fun stoppingUntouchedServiceDoesNotPreventLaterStart() {
        val state = ForegroundServiceLaunchState()
        stopForegroundService(state, false, {})
        assertFalse(state.isRunning)
        assertTrue(state.acceptStart(state.requestStart()))
    }

    @Test fun stoppingRunningServiceInvalidatesStartsWithoutSessionOwnership() {
        val state = ForegroundServiceLaunchState()
        assertTrue(state.acceptStart(state.requestStart()))
        var stopped = false
        stopForegroundService(state, true, {
            assertFalse(state.isRunning)
            stopped = true
        })
        assertTrue(stopped)
        assertNull(state.onDestroyed())
    }
}
