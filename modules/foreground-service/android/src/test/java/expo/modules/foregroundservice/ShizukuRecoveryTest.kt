package expo.modules.foregroundservice

import org.junit.Assert.*
import org.junit.Test

class ShizukuRecoveryTest {
    @Test fun onlyCurrentTicketWithoutStopMayRecover() {
        assertTrue(recoveryTicketMatches("current", "current", false))
        assertFalse(recoveryTicketMatches("current", "current", true))
        assertFalse(recoveryTicketMatches(null, "old", false))
        assertFalse(recoveryTicketMatches("new", "old", false))
        assertFalse(recoveryTicketMatches("new", null, false))
        assertFalse(recoveryTicketMatches(null, null, false))
    }
}
