package expo.modules.pusheventsource

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.nativeutil.NativeLogger

class PushEventSourceModule : Module() {
    companion object {
        private const val TAG = "PushEventSourceModule"
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val eventListener = object : PushEventDispatcher.Listener {
        override fun onProfileChanged(hint: PushProfileChangeHint) {
            mainHandler.post {
                sendEvent("onProfileChanged", mapOf("hash" to hint.hash))
            }
        }

        override fun onTokenChanged() {
            mainHandler.post {
                sendEvent("onTokenChanged", emptyMap<String, String>())
            }
        }
    }

    override fun definition() = ModuleDefinition {
        Name("PushEventSourceModule")
        Events("onProfileChanged", "onTokenChanged")

        OnCreate {
            PushEventDispatcher.addListener(eventListener)
        }

        Function("isFirebaseConfigured") {
            getFirebaseApp(appContext.reactContext) != null
        }

        AsyncFunction("getToken") { promise: Promise ->
            val context = appContext.reactContext
            if (context == null || getFirebaseApp(context) == null) {
                promise.resolve(null)
                return@AsyncFunction
            }

            PushEventStore.getToken(context)?.let { storedToken ->
                promise.resolve(storedToken)
                return@AsyncFunction
            }

            FirebaseMessaging.getInstance().token
                .addOnSuccessListener { token ->
                    PushEventStore.saveToken(context, token)
                    promise.resolve(token)
                }
                .addOnFailureListener { error ->
                    NativeLogger.w(TAG, "Unable to acquire FCM registration token")
                    NativeLogger.d(TAG, error.javaClass.simpleName)
                    promise.resolve(null)
                }
        }

        Function("consumePendingProfileChangeHint") {
            val context = appContext.reactContext ?: return@Function null
            PushEventStore.consumePendingProfileChange(context)?.let { hint ->
                mapOf("hash" to hint.hash)
            }
        }

        OnDestroy {
            PushEventDispatcher.removeListener(eventListener)
        }
    }

    private fun getFirebaseApp(context: Context?): FirebaseApp? {
        if (context == null) return null
        return try {
            FirebaseApp.getInstance()
        } catch (_: IllegalStateException) {
            FirebaseApp.initializeApp(context.applicationContext)
        }
    }
}
