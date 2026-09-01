package expo.modules.signalrclient

import org.junit.Assert.assertEquals
import org.junit.Test

class ReconnectBackoffPolicyTest {

    @Test
    fun `uses the configured backoff sequence and caps at ten minutes`() {
        val expectedDelays = listOf(
            2_000L,
            5_000L,
            15_000L,
            30_000L,
            60_000L,
            120_000L,
            300_000L,
            600_000L,
            600_000L
        )

        expectedDelays.forEachIndexed { attempt, expected ->
            assertEquals(
                "unexpected delay for attempt $attempt",
                expected,
                ReconnectBackoffPolicy.delayMillis(attempt) { 0.5 }
            )
        }
        assertEquals(600_000L, ReconnectBackoffPolicy.delayMillis(100) { 0.5 })
    }

    @Test
    fun `applies jitter within twenty percent of the base delay`() {
        assertEquals(1_600L, ReconnectBackoffPolicy.delayMillis(0) { 0.0 })
        assertEquals(2_400L, ReconnectBackoffPolicy.delayMillis(0) { 1.0 })
        assertEquals(480_000L, ReconnectBackoffPolicy.delayMillis(7) { 0.0 })
        assertEquals(720_000L, ReconnectBackoffPolicy.delayMillis(7) { 1.0 })
    }

    @Test
    fun `treats a negative attempt as the first attempt`() {
        assertEquals(2_000L, ReconnectBackoffPolicy.delayMillis(-1) { 0.5 })
    }
}
