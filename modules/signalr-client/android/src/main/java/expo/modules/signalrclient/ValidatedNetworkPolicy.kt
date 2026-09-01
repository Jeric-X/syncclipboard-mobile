package expo.modules.signalrclient

internal enum class ValidatedNetworkAction {
    NONE,
    DISCONNECT,
    RECONNECT
}

/** Determines whether the active network is suitable for a SignalR connection. */
internal object ValidatedNetworkPolicy {
    fun canConnect(
        hasInternetCapability: Boolean,
        hasValidatedCapability: Boolean
    ): Boolean = hasInternetCapability && hasValidatedCapability

    fun transitionAction(
        wasValidated: Boolean,
        isValidated: Boolean,
        hasConnectionRequest: Boolean,
        isConnectedOrConnecting: Boolean
    ): ValidatedNetworkAction {
        if (wasValidated == isValidated) return ValidatedNetworkAction.NONE
        if (!isValidated) return ValidatedNetworkAction.DISCONNECT
        return if (hasConnectionRequest && !isConnectedOrConnecting) {
            ValidatedNetworkAction.RECONNECT
        } else {
            ValidatedNetworkAction.NONE
        }
    }
}
