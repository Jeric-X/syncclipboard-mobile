package expo.modules.pusheventsource

import android.content.Context
import android.content.Intent
import android.os.Bundle
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import expo.modules.nativeutil.NativeLogger

/** Runs a short HTTP-authoritative clipboard refresh when FCM starts a cold process. */
class PushClipboardHeadlessTaskService : HeadlessJsTaskService() {
    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
        val extras: Bundle = intent?.extras ?: return null
        if (extras.getString(EXTRA_HASH).isNullOrBlank()) return null
        return HeadlessJsTaskConfig(TASK_NAME, Arguments.fromBundle(extras), TASK_TIMEOUT_MS, true)
    }

    override fun onHeadlessJsTaskFinish(taskId: Int) {
        NativeLogger.d(TAG, "Authoritative headless refresh finished")
        stopSelf()
    }

    companion object {
        private const val TAG = "PushClipboardHeadless"
        private const val TASK_NAME = "PushClipboardRefreshTask"
        private const val EXTRA_HASH = "hash"
        private const val TASK_TIMEOUT_MS = 30_000L

        fun start(context: Context, hint: PushProfileChangeHint) {
            try {
                HeadlessJsTaskService.acquireWakeLockNow(context)
                context.startService(
                    Intent(context, PushClipboardHeadlessTaskService::class.java).apply {
                        putExtra(EXTRA_HASH, hint.hash)
                    }
                )
            } catch (error: RuntimeException) {
                NativeLogger.e(
                    TAG,
                    "Unable to start authoritative headless refresh: ${error.javaClass.simpleName}",
                    error
                )
            }
        }
    }
}
