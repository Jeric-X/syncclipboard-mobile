package expo.modules.pusheventsource

import java.util.concurrent.CopyOnWriteArraySet

object PushEventDispatcher {
    interface Listener {
        fun onProfileChanged(hint: PushProfileChangeHint)
        fun onTokenChanged()
    }

    private val listeners = CopyOnWriteArraySet<Listener>()

    fun addListener(listener: Listener) {
        listeners.add(listener)
    }

    fun removeListener(listener: Listener) {
        listeners.remove(listener)
    }

    fun dispatchProfileChanged(hint: PushProfileChangeHint) {
        listeners.forEach { it.onProfileChanged(hint) }
    }

    fun dispatchTokenChanged() {
        listeners.forEach(Listener::onTokenChanged)
    }
}
