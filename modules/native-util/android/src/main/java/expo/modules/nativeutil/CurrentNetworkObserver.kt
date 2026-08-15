package expo.modules.nativeutil

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities

/**
 * Observes changes to the app's default network.
 *
 * Callbacks are emitted as invalidation signals only. The JS layer debounces them and reads a
 * fresh snapshot through [CurrentNetworkInfoReader], so no network details are retained here.
 */
internal class CurrentNetworkObserver(
    private val onNetworkChanged: () -> Unit
) {
    private var connectivityManager: ConnectivityManager? = null

    @Volatile
    private var registered = false

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = notifyChanged()

        override fun onLost(network: Network) = notifyChanged()

        override fun onUnavailable() = notifyChanged()

        override fun onCapabilitiesChanged(
            network: Network,
            networkCapabilities: NetworkCapabilities
        ) = notifyChanged()

        override fun onLinkPropertiesChanged(
            network: Network,
            linkProperties: LinkProperties
        ) = notifyChanged()
    }

    @Synchronized
    fun start(context: Context?) {
        if (registered || context == null) return
        val manager = context.applicationContext
            .getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return
        connectivityManager = manager
        registered = true
        try {
            manager.registerDefaultNetworkCallback(callback)
            NativeLogger.d(TAG, "Default network callback registered")
        } catch (error: RuntimeException) {
            registered = false
            connectivityManager = null
            NativeLogger.e(TAG, "Failed to register default network callback", error)
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
            NativeLogger.w(TAG, "Unable to unregister default network callback: ${error.message}")
        } finally {
            connectivityManager = null
        }
    }

    private fun notifyChanged() {
        if (registered) onNetworkChanged()
    }

    private companion object {
        const val TAG = "CurrentNetworkObserver"
    }
}
