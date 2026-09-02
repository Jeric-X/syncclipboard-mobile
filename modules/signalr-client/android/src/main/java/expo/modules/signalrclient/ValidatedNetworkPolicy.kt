package expo.modules.signalrclient

internal enum class ValidatedNetworkAction {
    NONE,
    DISCONNECT,
    RECONNECT
}

/**
 * Gates retries only on the presence of an active network.
 *
 * Android's VALIDATED capability means public-Internet validation, so it is deliberately not
 * required: a local-only Wi-Fi network can still reach a configured LAN SyncClipboard server.
 * The SignalR connection attempt remains the authoritative reachability probe.
 */
internal object ValidatedNetworkPolicy {
    fun canConnect(hasActiveNetwork: Boolean): Boolean = hasActiveNetwork

    fun transitionAction(
        wasAvailable: Boolean,
        isAvailable: Boolean,
        hasConnectionRequest: Boolean,
        isConnectedOrConnecting: Boolean
    ): ValidatedNetworkAction {
        if (wasAvailable == isAvailable) return ValidatedNetworkAction.NONE
        if (!isAvailable) return ValidatedNetworkAction.DISCONNECT
        return if (hasConnectionRequest && !isConnectedOrConnecting) {
            ValidatedNetworkAction.RECONNECT
        } else {
            ValidatedNetworkAction.NONE
        }
    }
}
