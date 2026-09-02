package expo.modules.foregroundservice

import android.content.pm.ServiceInfo

internal object ForegroundServiceTimeoutPolicy {
    fun isDataSync(fgsType: Int): Boolean {
        return fgsType and ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC != 0
    }
}
