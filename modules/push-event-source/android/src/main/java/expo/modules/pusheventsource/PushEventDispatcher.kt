package expo.modules.pusheventsource

import java.util.concurrent.CopyOnWriteArraySet

object PushEventDispatcher {
    interface Listener {
        /** Returns true only when the hint has an active JS consumer. */
        fun onProfileChanged(hint: PushProfileChangeHint): Boolean
        fun onTokenChanged()
    }

    private val listeners = CopyOnWriteArraySet<Listener>()

    fun addListener(listener: Listener) {
        listeners.add(listener)
    }

    fun removeListener(listener: Listener) {
        listeners.remove(listener)
    }

    fun dispatchProfileChanged(hint: PushProfileChangeHint): Boolean {
        if (listeners.isEmpty()) return false
        var delivered = false
        listeners.forEach { listener ->
            delivered = listener.onProfileChanged(hint) || delivered
        }
        return delivered
    }

    fun dispatchTokenChanged() {
        listeners.forEach(Listener::onTokenChanged)
    }
}
