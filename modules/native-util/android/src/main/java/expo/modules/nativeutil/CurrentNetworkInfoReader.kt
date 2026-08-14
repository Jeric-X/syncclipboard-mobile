package expo.modules.nativeutil

import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiInfo
import android.net.wifi.WifiManager
import android.os.Build

/** Reads a snapshot of the system's current default network. */
internal object CurrentNetworkInfoReader {
    fun read(context: Context?): Map<String, Any?> {
        if (context == null) return unavailableSnapshot()

        val connectivity =
            context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = connectivity.activeNetwork
        val capabilities = network?.let(connectivity::getNetworkCapabilities)
        val linkProperties = network?.let(connectivity::getLinkProperties)
        val networkType = getNetworkType(capabilities)
        val ssidPermissionGranted = hasSsidPermission(context)
        val locationServicesEnabled = NetworkSettingsHelper.isLocationServicesEnabled(context)

        return mapOf(
            "isConnected" to (capabilities != null),
            "isInternetReachable" to capabilities?.hasCapability(
                NetworkCapabilities.NET_CAPABILITY_VALIDATED
            ),
            "type" to networkType,
            "ssid" to readSsid(
                context,
                networkType,
                capabilities,
                ssidPermissionGranted && locationServicesEnabled
            ),
            "ssidPermissionGranted" to ssidPermissionGranted,
            "locationServicesEnabled" to locationServicesEnabled,
            "ipAddresses" to linkProperties
                ?.linkAddresses
                ?.mapNotNull { linkAddress ->
                    val address = linkAddress.address
                    if (
                        address.isAnyLocalAddress ||
                        address.isLoopbackAddress ||
                        address.isLinkLocalAddress ||
                        address.isMulticastAddress
                    ) {
                        null
                    } else {
                        address.hostAddress?.substringBefore('%')
                    }
                }
                ?.distinct()
                .orEmpty()
        )
    }

    private fun unavailableSnapshot(): Map<String, Any?> = mapOf(
        "isConnected" to false,
        "isInternetReachable" to null,
        "type" to "unknown",
        "ssid" to null,
        "ssidPermissionGranted" to false,
        "locationServicesEnabled" to false,
        "ipAddresses" to emptyList<String>()
    )

    private fun getNetworkType(capabilities: NetworkCapabilities?): String = when {
        capabilities == null -> "none"
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
        else -> "other"
    }

    private fun hasSsidPermission(context: Context): Boolean {
        val fineLocationGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            context.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        return fineLocationGranted
    }

    private fun readSsid(
        context: Context,
        networkType: String,
        capabilities: NetworkCapabilities?,
        permissionGranted: Boolean
    ): String? {
        if (networkType != "wifi" || !permissionGranted) return null

        return try {
            val capabilityInfo = capabilities?.transportInfo as? WifiInfo
            @Suppress("DEPRECATION")
            val connectionInfo =
                (context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager)
                    .connectionInfo

            listOfNotNull(capabilityInfo, connectionInfo).firstNotNullOfOrNull { wifiInfo ->
                @Suppress("DEPRECATION")
                wifiInfo.ssid
                    ?.takeUnless { it.isBlank() || it == WifiManager.UNKNOWN_SSID }
                    ?.removeSurrounding("\"")
            }
        } catch (_: SecurityException) {
            NativeLogger.w("CurrentNetworkInfoReader", "Wi-Fi SSID permission unavailable")
            null
        }
    }
}
