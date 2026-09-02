package expo.modules.pusheventsource

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PushEventDispatcherTest {
    @Test
    fun `reports whether an active JS consumer received the hint`() {
        val inactive = listener(deliversProfile = false)
        val active = listener(deliversProfile = true)
        PushEventDispatcher.addListener(inactive)
        PushEventDispatcher.addListener(active)
        try {
            assertTrue(
                PushEventDispatcher.dispatchProfileChanged(PushProfileChangeHint("remote-hash"))
            )
        } finally {
            PushEventDispatcher.removeListener(inactive)
            PushEventDispatcher.removeListener(active)
        }

        assertFalse(
            PushEventDispatcher.dispatchProfileChanged(PushProfileChangeHint("remote-hash"))
        )
    }

    private fun listener(deliversProfile: Boolean) = object : PushEventDispatcher.Listener {
        override fun onProfileChanged(hint: PushProfileChangeHint): Boolean = deliversProfile
        override fun onTokenChanged() = Unit
    }
}
