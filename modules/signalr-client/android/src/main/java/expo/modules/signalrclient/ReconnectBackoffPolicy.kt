package expo.modules.signalrclient

import kotlin.math.roundToLong
import kotlin.random.Random

/** SignalR 重连退避策略；输入 attempt 从 0 开始。 */
internal object ReconnectBackoffPolicy {
    private val baseDelaysMs = longArrayOf(
        2_000L,
        5_000L,
        15_000L,
        30_000L,
        60_000L,
        120_000L,
        300_000L,
        600_000L
    )

    private const val MIN_JITTER_FACTOR = 0.8
    private const val JITTER_RANGE = 0.4

    fun delayMillis(
        attempt: Int,
        randomUnit: () -> Double = { Random.nextDouble() }
    ): Long {
        val index = attempt.coerceAtLeast(0).coerceAtMost(baseDelaysMs.lastIndex)
        val jitterFactor = MIN_JITTER_FACTOR + randomUnit().coerceIn(0.0, 1.0) * JITTER_RANGE
        return (baseDelaysMs[index] * jitterFactor).roundToLong()
    }
}
