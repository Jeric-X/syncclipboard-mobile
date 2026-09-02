package expo.modules.foregroundservice

import android.content.pm.ServiceInfo
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ForegroundServiceTimeoutPolicyTest {
    @Test
    fun `recognizes dataSync in a foreground service type mask`() {
        assertTrue(
            ForegroundServiceTimeoutPolicy.isDataSync(
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        )
        assertTrue(
            ForegroundServiceTimeoutPolicy.isDataSync(
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
            )
        )
        assertFalse(
            ForegroundServiceTimeoutPolicy.isDataSync(
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
            )
        )
    }

    @Test
    fun `service declares the Android 15 timeout callback`() {
        val callback = SyncForegroundService::class.java.getDeclaredMethod(
            "onTimeout",
            Int::class.javaPrimitiveType,
            Int::class.javaPrimitiveType
        )

        assertNotNull(callback)
    }
}
