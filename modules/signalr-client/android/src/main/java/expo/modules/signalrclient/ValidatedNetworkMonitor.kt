package expo.modules.signalrclient

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import expo.modules.nativeutil.NativeLogger

/** Observes whether the app's default network has validated Internet access. */
internal class ValidatedNetworkMonitor(
    private val onAvailabilityChanged: (isValidated: Boolean, reason: String) -> Unit
) {
    private var connectivityManager: ConnectivityManager? = null
    private var lastAvailability: Boolean? = null

    @Volatile
    private var registered = false

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = refreshAvailability("onAvailable")

        override fun onLost(network: Network) = refreshAvailability("onLost")

        override fun onUnavailable() = refreshAvailability("onUnavailable")

        override fun onCapabilitiesChanged(
            network: Network,
            networkCapabilities: NetworkCapabilities
        ) = refreshAvailability("onCapabilitiesChanged")
    }

    @Synchronized
    fun start(context: Context?) {
        if (registered) return
        val manager = context?.applicationContext
            ?.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        if (manager == null) {
            NativeLogger.w(TAG, "ConnectivityManager unavailable; SignalR remains gated")
            onAvailabilityChanged(false, "managerUnavailable")
            return
        }

        connectivityManager = manager
        lastAvailability = null
        registered = true
        try {
            manager.registerDefaultNetworkCallback(callback)
            NativeLogger.d(TAG, "Validated network callback registered")
            refreshAvailability("initial")
        } catch (error: RuntimeException) {
            registered = false
            connectivityManager = null
            NativeLogger.e(TAG, "Failed to register validated network callback", error)
            onAvailabilityChanged(false, "registrationFailed")
        }
    }

    @Synchronized
    fun stop() {
        if (!registered) return
        registered = false
        try {
            connectivityManager?.unregisterNetworkCallback(callback)
        } catch (_: IllegalArgumentException) {
            // The callback may already have been removed with the React context.
        } catch (error: SecurityException) {
            NativeLogger.w(TAG, "Unable to unregister validated network callback: ${error.message}")
        } finally {
            connectivityManager = null
            lastAvailability = null
        }
    }

    @Synchronized
    private fun refreshAvailability(reason: String) {
        if (!registered) return
        val manager = connectivityManager ?: return
        val capabilities = try {
            manager.activeNetwork?.let(manager::getNetworkCapabilities)
        } catch (error: SecurityException) {
            NativeLogger.w(TAG, "Unable to read active network capabilities: ${error.message}")
            null
        }
        val isValidated = ValidatedNetworkPolicy.canConnect(
            hasInternetCapability = capabilities?.hasCapability(
                NetworkCapabilities.NET_CAPABILITY_INTERNET
            ) == true,
            hasValidatedCapability = capabilities?.hasCapability(
                NetworkCapabilities.NET_CAPABILITY_VALIDATED
            ) == true
        )
        if (lastAvailability == isValidated) return

        lastAvailability = isValidated
        NativeLogger.d(TAG, "Validated network availability=$isValidated reason=$reason")
        onAvailabilityChanged(isValidated, reason)
    }

    private companion object {
        const val TAG = "ValidatedNetworkMonitor"
    }
}
