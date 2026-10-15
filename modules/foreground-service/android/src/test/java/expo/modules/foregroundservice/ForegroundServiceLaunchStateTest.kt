package expo.modules.foregroundservice

import org.junit.Assert.*
import org.junit.Test

class ForegroundServiceLaunchStateTest {
    @Test fun stopThenStartWaitsForDestructionAndStartsOnce() {
        val state = ForegroundServiceLaunchState()
        val old = state.requestStart()!!
        assertTrue(state.acceptStart(old))
        state.requestStop(hasInstance = true)
        assertFalse(state.isRunning)
        assertNull(state.requestStart())
        assertNull(state.requestStart())
        val restart = state.onDestroyed()!!
        assertNotEquals(old, restart)
        assertNull(state.requestStart())
        assertFalse(state.acceptStart(old))
        assertTrue(state.acceptStart(restart))
        assertTrue(state.isRunning)
    }

    @Test fun anotherStopCancelsTheQueuedRestart() {
        val state = ForegroundServiceLaunchState()
        assertTrue(state.acceptStart(state.requestStart()))
        state.requestStop(hasInstance = true)
        state.requestStart()
        state.requestStop(hasInstance = true)
        assertNull(state.onDestroyed())
        assertFalse(state.isRunning)
    }

    @Test fun lateStartCannotReviveAnInstanceThatIsStopping() {
        val state = ForegroundServiceLaunchState()
        val token = state.requestStart()!!
        state.requestStop(hasInstance = true)
        assertFalse(state.acceptStart(token))
        assertFalse(state.acceptStart(null))
        assertNull(state.onDestroyed())
    }

    @Test fun duplicateStartsReuseBothPendingAndRunningInstances() {
        val state = ForegroundServiceLaunchState()
        val token = state.requestStart()!!
        assertNull(state.requestStart())
        assertTrue(state.acceptStart(token))
        assertNull(state.requestStart())
    }

    @Test fun rejectedDispatchCanBeRetriedWithoutStartingADuplicate() {
        val state = ForegroundServiceLaunchState()
        val token = state.requestStart()!!
        state.rejectStart(token)
        assertEquals(token, state.requestStart())
        assertNull(state.requestStart())
    }

    @Test fun stoppingBeforeCreationInvalidatesTheOldRequest() {
        val state = ForegroundServiceLaunchState()
        val old = state.requestStart()!!
        state.requestStop(hasInstance = false)
        val next = state.requestStart()!!
        state.rejectStart(old)
        assertNull(state.requestStart())
        assertFalse(state.acceptStart(old))
        assertTrue(state.acceptStart(next))
    }

    @Test fun unexpectedDestructionDoesNotScheduleAnAutomaticLoop() {
        val state = ForegroundServiceLaunchState()
        assertTrue(state.acceptStart(null))
        assertNull(state.onDestroyed())
        assertFalse(state.isRunning)
    }
    @Test fun coldPromotionFailureOffersRecoveryAndInvalidatesTheRequest() {
        val state = ForegroundServiceLaunchState()
        val token = state.requestStart()!!
        assertTrue(state.promotionFailed(hasRuntimeSession = false, stoppedByPolicy = false))
        assertFalse(state.isRunning)
        assertFalse(state.acceptStart(token))
        assertNull(state.onDestroyed())
    }

    @Test fun promotionFailureLeavesExistingRuntimeToRetryWithoutRecoveryNotification() {
        val state = ForegroundServiceLaunchState()
        assertFalse(state.promotionFailed(hasRuntimeSession = true, stoppedByPolicy = false))
        assertNull(state.requestStart())
        val retry = state.onDestroyed()!!
        assertTrue(state.acceptStart(retry))
    }

    @Test fun policyStopDoesNotOfferRecoveryAfterPromotionFailure() {
        val state = ForegroundServiceLaunchState()
        assertFalse(state.promotionFailed(hasRuntimeSession = false, stoppedByPolicy = true))
        assertNull(state.onDestroyed())
    }
}
