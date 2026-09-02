package expo.modules.pusheventsource

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PushMessageParserTest {
    @Test
    fun parseAcceptsVersionedClipboardChangeHint() {
        val hint = PushMessageParser.parse(mapOf(
            "v" to "1",
            "type" to "clipboard_changed",
            "hash" to " profile-hash "
        ))

        assertEquals(PushProfileChangeHint("profile-hash"), hint)
    }

    @Test
    fun parseIgnoresUnsupportedVersion() {
        assertNull(PushMessageParser.parse(mapOf(
            "v" to "2",
            "type" to "clipboard_changed",
            "hash" to "profile-hash"
        )))
    }

    @Test
    fun parseIgnoresUnsupportedType() {
        assertNull(PushMessageParser.parse(mapOf(
            "v" to "1",
            "type" to "history_changed",
            "hash" to "profile-hash"
        )))
    }

    @Test
    fun parseRequiresNonEmptyHash() {
        assertNull(PushMessageParser.parse(mapOf(
            "v" to "1",
            "type" to "clipboard_changed",
            "hash" to " "
        )))
    }
}
