package expo.modules.pusheventsource

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import expo.modules.nativeutil.NativeLogger

class SyncClipboardFirebaseMessagingService : FirebaseMessagingService() {
    companion object {
        private const val TAG = "SyncClipboardFCM"
    }

    override fun onNewToken(token: String) {
        PushEventStore.saveToken(applicationContext, token)
        PushEventDispatcher.dispatchTokenChanged()
        NativeLogger.i(TAG, "FCM registration token changed")
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val hint = PushMessageParser.parse(message.data)
        if (hint == null) {
            NativeLogger.w(TAG, "Ignoring unsupported or malformed FCM data message")
            return
        }

        PushEventStore.savePendingProfileChange(applicationContext, hint)
        PushEventDispatcher.dispatchProfileChanged(hint)
        NativeLogger.d(TAG, "FCM clipboard change hint received")
    }
}
