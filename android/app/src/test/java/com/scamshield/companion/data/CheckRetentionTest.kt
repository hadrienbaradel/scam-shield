package com.scamshield.companion.data

import com.scamshield.companion.data.CheckRetention.Entry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.TimeUnit

class CheckRetentionTest {

    private val now = 1_800_000_000_000L
    private val day = TimeUnit.DAYS.toMillis(1)

    @Test fun keeps_entries_up_to_seven_days_old() {
        val entries = listOf(Entry("a", now), Entry("b", now - 7 * day))
        val (kept, dropped) = CheckRetention.prune(entries, now)
        assertEquals(entries, kept)
        assertTrue(dropped.isEmpty())
    }

    @Test fun drops_entries_older_than_seven_days() {
        val (kept, dropped) = CheckRetention.prune(
            listOf(Entry("new", now - day), Entry("old", now - 7 * day - 1), Entry("older", now - 30 * day)),
            now,
        )
        assertEquals(listOf("new"), kept.map { it.id })
        assertEquals(listOf("old", "older"), dropped.map { it.id })
    }

    @Test fun drops_entries_dated_far_in_the_future() {
        val (kept, dropped) = CheckRetention.prune(listOf(Entry("skewed", now + 8 * day), Entry("ok", now)), now)
        assertEquals(listOf("ok"), kept.map { it.id })
        assertEquals(listOf("skewed"), dropped.map { it.id })
    }

    @Test fun caps_at_twenty_newest() {
        val entries = (0 until 25).map { Entry("c$it", now - it * 1000L) }
        val (kept, dropped) = CheckRetention.prune(entries, now)
        assertEquals(CheckRetention.MAX_ENTRIES, kept.size)
        assertEquals("c0", kept.first().id)
        assertEquals((20 until 25).map { "c$it" }, dropped.map { it.id })
    }

    @Test fun upsert_moves_existing_id_to_front_with_new_time() {
        val entries = listOf(Entry("a", now - 2 * day), Entry("b", now - day))
        assertEquals(listOf(Entry("b", now), Entry("a", now - 2 * day)), CheckRetention.upsert(entries, "b", now))
    }

    @Test fun twenty_first_save_evicts_the_oldest() {
        val full = (0 until 20).map { Entry("c$it", now - (it + 1) * 1000L) }
        val (kept, dropped) = CheckRetention.prune(CheckRetention.upsert(full, "fresh", now), now)
        assertEquals("fresh", kept.first().id)
        assertEquals(20, kept.size)
        assertEquals(listOf("c19"), dropped.map { it.id })
    }

    @Test fun index_round_trips_and_tolerates_garbage() {
        val entries = listOf(Entry("7d1c", now), Entry("local-x", now - day))
        assertEquals(entries, CheckRetention.parse(CheckRetention.serialize(entries)))
        assertEquals(emptyList<Entry>(), CheckRetention.parse(null))
        assertEquals(emptyList<Entry>(), CheckRetention.parse("not json"))
        // The legacy index (plain id strings, no timestamps) is not trusted.
        assertEquals(emptyList<Entry>(), CheckRetention.parse("""["a","b"]"""))
    }
}
