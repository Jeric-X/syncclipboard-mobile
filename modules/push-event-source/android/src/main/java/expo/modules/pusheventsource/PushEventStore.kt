package expo.modules.pusheventsource

import android.content.Context

object PushEventStore {
    private const val PREFERENCES_NAME = "syncclipboard_push_events"
    private const val TOKEN_KEY = "fcm_token"
    private const val PENDING_PROFILE_HASH_KEY = "pending_profile_hash"

    fun saveToken(context: Context, token: String) {
        preferences(context).edit().putString(TOKEN_KEY, token).apply()
    }

    fun getToken(context: Context): String? {
        return preferences(context).getString(TOKEN_KEY, null)?.takeIf(String::isNotBlank)
    }

    fun savePendingProfileChange(context: Context, hint: PushProfileChangeHint) {
        // Clipboard notifications are latest-value-wins, so one pending hash is sufficient.
        preferences(context).edit().putString(PENDING_PROFILE_HASH_KEY, hint.hash).apply()
    }

    fun consumePendingProfileChange(context: Context): PushProfileChangeHint? {
        val preferences = preferences(context)
        val hash = preferences.getString(PENDING_PROFILE_HASH_KEY, null)
            ?.takeIf(String::isNotBlank)
            ?: return null
        preferences.edit().remove(PENDING_PROFILE_HASH_KEY).apply()
        return PushProfileChangeHint(hash)
    }

    private fun preferences(context: Context) = context.applicationContext.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE
    )
}
