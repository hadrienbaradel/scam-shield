package com.scamshield.companion.data

import android.content.Context
import android.content.SharedPreferences
import com.scamshield.companion.net.ApiJson
import com.scamshield.companion.net.StoredCheck
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.math.abs

/**
 * The last few checks, so a tapped notification can open its Verdict screen.
 *
 * Private-mode SharedPreferences. Each entry (sender, body, verdict) is sealed with the
 * Keystore content key; only check ids and save times are stored in clear. At most
 * [CheckRetention.MAX_ENTRIES] entries are kept, and anything older than 7 days is
 * deleted on every read and write.
 */
class CheckStore(context: Context, private val now: () -> Long = System::currentTimeMillis) {

    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun save(check: StoredCheck) {
        synchronized(LOCK) {
            val t = now()
            val (kept, dropped) = CheckRetention.prune(CheckRetention.upsert(index(), check.checkId, t), t)
            val edit = prefs.edit()
            dropLegacy(edit)
            dropped.forEach { edit.remove(KEY_ENTRY + it.id) }
            if (kept.any { it.id == check.checkId }) {
                edit.putString(KEY_ENTRY + check.checkId, Ciphers.content.encrypt(ApiJson.storedToJson(check)))
            }
            edit.putString(KEY_INDEX, CheckRetention.serialize(kept)).commit()
        }
    }

    fun get(checkId: String): StoredCheck? {
        synchronized(LOCK) {
            if (pruned().none { it.id == checkId }) return null
            return read(checkId)
        }
    }

    fun latest(): StoredCheck? {
        synchronized(LOCK) {
            return pruned().firstNotNullOfOrNull { read(it.id) }
        }
    }

    fun remove(checkId: String) {
        synchronized(LOCK) {
            val kept = pruned().filterNot { it.id == checkId }
            prefs.edit().remove(KEY_ENTRY + checkId).putString(KEY_INDEX, CheckRetention.serialize(kept)).commit()
        }
    }

    fun clear() {
        synchronized(LOCK) { prefs.edit().clear().commit() }
    }

    /** Index after expiring old entries; deletes what expired (and any legacy plaintext). */
    private fun pruned(): List<CheckRetention.Entry> {
        val all = index()
        val (kept, dropped) = CheckRetention.prune(all, now())
        if (kept.size != all.size || hasLegacy()) {
            val edit = prefs.edit()
            dropLegacy(edit)
            dropped.forEach { edit.remove(KEY_ENTRY + it.id) }
            edit.putString(KEY_INDEX, CheckRetention.serialize(kept)).apply()
        }
        return kept
    }

    /** Decrypt one entry. An unreadable entry (e.g. key lost) is deleted. */
    private fun read(checkId: String): StoredCheck? {
        val sealed = prefs.getString(KEY_ENTRY + checkId, null) ?: return null
        val check = Ciphers.content.decrypt(sealed)?.let { runCatching { ApiJson.storedFromJson(it) }.getOrNull() }
        if (check == null) {
            val kept = index().filterNot { it.id == checkId }
            prefs.edit().remove(KEY_ENTRY + checkId).putString(KEY_INDEX, CheckRetention.serialize(kept)).apply()
        }
        return check
    }

    private fun index(): List<CheckRetention.Entry> = CheckRetention.parse(prefs.getString(KEY_INDEX, null))

    // Earlier builds stored plaintext entries under "ids" / "check_<id>"; delete them.
    private fun hasLegacy(): Boolean = prefs.contains(LEGACY_IDS)

    private fun dropLegacy(edit: SharedPreferences.Editor) {
        if (!hasLegacy()) return
        edit.remove(LEGACY_IDS)
        prefs.all.keys.filter { it.startsWith(LEGACY_PREFIX) }.forEach { edit.remove(it) }
    }

    companion object {
        private const val PREFS = "checks"
        private const val KEY_INDEX = "index"
        private const val KEY_ENTRY = "entry_"
        private const val LEGACY_IDS = "ids"
        private const val LEGACY_PREFIX = "check_"
        private val LOCK = Any()
    }
}

/** Retention rules for [CheckStore]: newest first, capped, expired after 7 days. Pure logic. */
internal object CheckRetention {
    const val MAX_ENTRIES = 20
    val MAX_AGE_MS: Long = TimeUnit.DAYS.toMillis(7)

    data class Entry(val id: String, val savedAt: Long)

    /** Moves (or adds) [id] to the front with a fresh save time. */
    fun upsert(entries: List<Entry>, id: String, now: Long): List<Entry> =
        listOf(Entry(id, now)) + entries.filterNot { it.id == id }

    /**
     * Splits [entries] (newest first) into (kept, dropped). Dropped: older than 7 days,
     * beyond the 20-entry cap, or dated more than 7 days in the future (clock changes),
     * so nothing can outlive the limit.
     */
    fun prune(entries: List<Entry>, now: Long): Pair<List<Entry>, List<Entry>> {
        val fresh = entries.distinctBy { it.id }.filter { abs(now - it.savedAt) <= MAX_AGE_MS }
        val kept = fresh.take(MAX_ENTRIES)
        val keptIds = kept.mapTo(HashSet()) { it.id }
        return kept to entries.filterNot { it.id in keptIds }.distinctBy { it.id }
    }

    fun serialize(entries: List<Entry>): String = JSONArray().apply {
        entries.forEach { put(JSONObject().put("id", it.id).put("savedAt", it.savedAt)) }
    }.toString()

    /** Unparseable or missing data reads as an empty index. */
    fun parse(json: String?): List<Entry> {
        if (json == null) return emptyList()
        return runCatching {
            val arr = JSONArray(json)
            (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                val id = o.optString("id").takeIf { it.isNotBlank() } ?: return@mapNotNull null
                if (!o.has("savedAt")) return@mapNotNull null
                Entry(id, o.optLong("savedAt"))
            }
        }.getOrDefault(emptyList())
    }
}
