package expo.modules.shizukuclipboard

import org.junit.Assert.*
import org.junit.Test

class ProcessRecoveryGuardTest {
    private var time = 0L
    private val deaths = mutableMapOf<String, () -> Unit>()
    private val delays = mutableListOf<Long>()
    private val queued = mutableListOf<() -> Unit>()
    private var recovered = 0
    private val guard = ProcessRecoveryGuard<String>(
        now = { time },
        link = { token, died -> deaths[token] = died; {} },
        // 故意模拟取消时回调已经出队，仍须由代际检查阻止恢复。
        schedule = { delayMs, callback -> delays.add(delayMs); queued.add(callback); {} }
    )

    @Test fun deathIsDelayedAndRecoveredOnlyOnce() {
        guard.watch("app") { recovered++ }
        deaths.getValue("app")()
        deaths.getValue("app")()
        assertEquals(1, queued.size)
        assertEquals(0, recovered)
        queued[0]()
        queued[0]()
        assertEquals(1, recovered)
    }

    @Test fun disablingCancelsEvenAnAlreadyQueuedRecovery() {
        guard.watch("app") { recovered++ }
        deaths.getValue("app")()
        guard.clear("app")
        queued[0]()
        assertEquals(0, recovered)
    }

    @Test fun replacementCancelsOldDeathAndOldCleanupCannotRemoveNewWatch() {
        guard.watch("old") { recovered++ }
        deaths.getValue("old")()
        guard.watch("new") { recovered++ }
        guard.clear("old")
        queued[0]()
        deaths.getValue("old")()
        assertEquals(0, recovered)
        deaths.getValue("new")()
        queued.last()()
        assertEquals(1, recovered)
    }

    @Test fun sameTokenUpdatesCapabilityWithoutDuplicatingWatch() {
        guard.watch("app") { recovered++ }
        guard.watch("app") { recovered += 100 }
        deaths.getValue("app")()
        queued.last()()
        assertEquals(100, recovered)
    }

    @Test fun crashLoopBudgetSurvivesRebindingAndExpires() {
        repeat(4) { index ->
            val token = "app-$index"
            guard.watch(token) { recovered++ }
            deaths.getValue(token)()
            queued.last()()
        }
        assertEquals(3, recovered)
        time = 600_000
        guard.watch("later") { recovered++ }
        deaths.getValue("later")()
        queued.last()()
        assertEquals(4, recovered)
    }

    @Test fun alreadyDeadRegistrationDoesNotRecover() {
        val failing = ProcessRecoveryGuard<String>({ 0L }, { _, _ -> error("dead binder") }, { _, _ -> {} })
        assertThrows(IllegalStateException::class.java) { failing.watch("dead") { recovered++ } }
        failing.close()
        assertEquals(0, recovered)
    }

    @Test fun successfulRecoveryResetsAttemptsButStaleAcknowledgementDoesNot() {
        repeat(3) { index ->
            val token = "failed-$index"
            guard.watch(token) { recovered++ }
            deaths.getValue(token)()
            queued.last()()
        }
        guard.watch("blocked") { recovered++ }
        guard.ready("failed-2")
        deaths.getValue("blocked")()
        guard.ready("blocked") // 死亡后的迟到确认也不能清零。
        queued.last()()
        assertEquals(3, recovered)
        guard.watch("healthy") { recovered++ }
        guard.ready("healthy")
        deaths.getValue("healthy")()
        queued.last()()
        assertEquals(4, recovered)
    }

    @Test fun retriesWhenStartupNeverRegistersAReplacementAndStopsAtBudget() {
        guard.watch("app") { recovered++ }
        deaths.getValue("app")()
        queued[0]()
        assertEquals(2, queued.size)
        queued[1]()
        assertEquals(3, queued.size)
        queued[2]()
        assertEquals(3, recovered)
        assertEquals(3, queued.size)
        assertEquals(listOf(2_000L, 60_000L, 60_000L), delays)
        queued.forEach { it() }
        assertEquals(3, recovered)
    }

    @Test fun replacementCancelsRetryAfterTheFirstLaunchWithoutResettingBudget() {
        guard.watch("old") { recovered++ }
        deaths.getValue("old")()
        queued[0]()
        assertEquals(2, queued.size)
        val retry = queued[1]
        guard.watch("new") { recovered++ }
        retry()
        assertEquals(1, recovered)
        deaths.getValue("new")()
        queued.last()()
        queued.last()()
        assertEquals(3, recovered)
        val size = queued.size
        queued.last()()
        assertEquals(size, queued.size)
        assertEquals(3, recovered)
    }

    @Test fun revocationDuringSendDoesNotScheduleAnotherAttempt() {
        guard.watch("app") { recovered++; guard.clear("app") }
        deaths.getValue("app")()
        queued[0]()
        assertEquals(1, recovered)
        assertEquals(1, queued.size)
    }

    @Test fun disablingAfterFirstSendCancelsEvenADequeuedRetry() {
        guard.watch("app") { recovered++ }
        deaths.getValue("app")()
        queued[0]()
        val retry = queued[1]
        guard.clear("app")
        retry()
        assertEquals(1, recovered)
        assertEquals(2, queued.size)
    }

    @Test fun readyReplacementCancelsRetryAndRestoresTheFullBudget() {
        guard.watch("old") { recovered++ }
        deaths.getValue("old")()
        queued[0]()
        val retry = queued[1]
        guard.watch("ready") { recovered++ }
        guard.ready("ready")
        retry()
        deaths.getValue("ready")()
        repeat(3) { queued.last()() }
        assertEquals(4, recovered)
        queued.last()()
        assertEquals(4, recovered)
    }
}
