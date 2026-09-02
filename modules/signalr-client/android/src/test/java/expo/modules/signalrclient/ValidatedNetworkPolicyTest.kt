package expo.modules.signalrclient

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ValidatedNetworkPolicyTest {

    @Test
    fun `allows LAN-only SignalR whenever an active network exists`() {
        assertTrue(ValidatedNetworkPolicy.canConnect(hasActiveNetwork = true))
        assertFalse(ValidatedNetworkPolicy.canConnect(hasActiveNetwork = false))
    }

    @Test
    fun `disconnects when a validated network is lost`() {
        assertEquals(
            ValidatedNetworkAction.DISCONNECT,
            ValidatedNetworkPolicy.transitionAction(
                wasAvailable = true,
                isAvailable = false,
                hasConnectionRequest = true,
                isConnectedOrConnecting = true
            )
        )
    }

    @Test
    fun `reconnects immediately when validated network returns for a pending request`() {
        assertEquals(
            ValidatedNetworkAction.RECONNECT,
            ValidatedNetworkPolicy.transitionAction(
                wasAvailable = false,
                isAvailable = true,
                hasConnectionRequest = true,
                isConnectedOrConnecting = false
            )
        )
    }

    @Test
    fun `does not repeat lifecycle actions without an actionable transition`() {
        assertEquals(
            ValidatedNetworkAction.NONE,
            ValidatedNetworkPolicy.transitionAction(
                wasAvailable = true,
                isAvailable = true,
                hasConnectionRequest = true,
                isConnectedOrConnecting = false
            )
        )
        assertEquals(
            ValidatedNetworkAction.NONE,
            ValidatedNetworkPolicy.transitionAction(
                wasAvailable = false,
                isAvailable = true,
                hasConnectionRequest = false,
                isConnectedOrConnecting = false
            )
        )
        assertEquals(
            ValidatedNetworkAction.NONE,
            ValidatedNetworkPolicy.transitionAction(
                wasAvailable = false,
                isAvailable = true,
                hasConnectionRequest = true,
                isConnectedOrConnecting = true
            )
        )
    }
}
