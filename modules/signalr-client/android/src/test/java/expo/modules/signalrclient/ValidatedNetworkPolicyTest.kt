package expo.modules.signalrclient

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ValidatedNetworkPolicyTest {

    @Test
    fun `allows SignalR only when internet and validation capabilities are present`() {
        assertTrue(
            ValidatedNetworkPolicy.canConnect(
                hasInternetCapability = true,
                hasValidatedCapability = true
            )
        )
        assertFalse(
            ValidatedNetworkPolicy.canConnect(
                hasInternetCapability = true,
                hasValidatedCapability = false
            )
        )
        assertFalse(
            ValidatedNetworkPolicy.canConnect(
                hasInternetCapability = false,
                hasValidatedCapability = true
            )
        )
        assertFalse(
            ValidatedNetworkPolicy.canConnect(
                hasInternetCapability = false,
                hasValidatedCapability = false
            )
        )
    }

    @Test
    fun `disconnects when a validated network is lost`() {
        assertEquals(
            ValidatedNetworkAction.DISCONNECT,
            ValidatedNetworkPolicy.transitionAction(
                wasValidated = true,
                isValidated = false,
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
                wasValidated = false,
                isValidated = true,
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
                wasValidated = true,
                isValidated = true,
                hasConnectionRequest = true,
                isConnectedOrConnecting = false
            )
        )
        assertEquals(
            ValidatedNetworkAction.NONE,
            ValidatedNetworkPolicy.transitionAction(
                wasValidated = false,
                isValidated = true,
                hasConnectionRequest = false,
                isConnectedOrConnecting = false
            )
        )
        assertEquals(
            ValidatedNetworkAction.NONE,
            ValidatedNetworkPolicy.transitionAction(
                wasValidated = false,
                isValidated = true,
                hasConnectionRequest = true,
                isConnectedOrConnecting = true
            )
        )
    }
}
