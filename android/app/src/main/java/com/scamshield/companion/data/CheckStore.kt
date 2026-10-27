package com.scamshield.companion.data

import android.content.Context
import com.scamshield.companion.net.ApiJson
import com.scamshield.companion.net.StoredCheck
import org.json.JSONArray

/** The last few checks, so a tapped notification can open its Verdict screen. Private mode. */
class CheckStore(context: Context) {

    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    @Synchronized
    fun save(check: StoredCheck) {
        val ids = ids().filterNot { it == check.checkId }.toMutableList()
        ids.add(0, check.checkId)
        val keep = ids.take(MAX)
        val edit = prefs.edit()
        ids.drop(MAX).forEach { edit.remove(KEY_PREFIX + it) }
        edit.putString(KEY_PREFIX + check.checkId, ApiJson.storedToJson(check))
            .putString(KEY_IDS, JSONArray(keep).toString())
            .commit()
    }

    fun get(checkId: String): StoredCheck? =
        prefs.getString(KEY_PREFIX + checkId, null)?.let { runCatching { ApiJson.storedFromJson(it) }.getOrNull() }

    fun latest(): StoredCheck? = ids().firstNotNullOfOrNull { get(it) }

    fun clear() {
        prefs.edit().clear().commit()
    }

    private fun ids(): List<String> = runCatching {
        val arr = JSONArray(prefs.getString(KEY_IDS, "[]"))
        (0 until arr.length()).map { arr.getString(it) }
    }.getOrDefault(emptyList())

    companion object {
        private const val PREFS = "checks"
        private const val KEY_IDS = "ids"
        private const val KEY_PREFIX = "check_"
        private const val MAX = 20
    }
}
