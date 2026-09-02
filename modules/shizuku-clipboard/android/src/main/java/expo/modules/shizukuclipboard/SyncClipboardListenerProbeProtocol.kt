package expo.modules.shizukuclipboard

/** Private Binder handshake used to identify the SyncClipboard system listener without app identity heuristics. */
object SyncClipboardListenerProbeProtocol {
    const val LISTENER_DESCRIPTOR = "android.content.IOnPrimaryClipChangedListener"
    const val TRANSACTION_CODE = 0x00534351
    const val VERSION = 1
    const val REQUEST_MAGIC = 0x53434C50
    const val RESPONSE_MAGIC = 0x53434C52
    private const val NONCE_MASK = 0x53434C50524F4245L

    fun responseNonce(requestNonce: Long): Long = requestNonce xor NONCE_MASK

    fun isValidResponse(
        responseMagic: Int,
        responseVersion: Int,
        responseNonce: Long,
        requestNonce: Long,
    ): Boolean =
        responseMagic == RESPONSE_MAGIC &&
            responseVersion == VERSION &&
            responseNonce == responseNonce(requestNonce)
}
