package expo.modules.pusheventsource

data class PushProfileChangeHint(val hash: String)

object PushMessageParser {
    private const val SUPPORTED_VERSION = "1"
    private const val PROFILE_CHANGED_TYPE = "clipboard_changed"

    fun parse(data: Map<String, String>): PushProfileChangeHint? {
        if (data["v"] != SUPPORTED_VERSION || data["type"] != PROFILE_CHANGED_TYPE) {
            return null
        }

        val hash = data["hash"]?.trim()?.takeIf(String::isNotEmpty) ?: return null
        return PushProfileChangeHint(hash)
    }
}
