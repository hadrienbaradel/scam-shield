package com.scamshield.companion.net

import org.json.JSONArray
import org.json.JSONObject

data class Reason(val text: String, val evidence: String?)

data class Verdict(
    /** "scam" | "be_careful" | "safe". Unknown values are coerced to "be_careful". */
    val verdict: String,
    val confidence: Double,
    val headline: String,
    val reasons: List<Reason>,
    val action: String,
    val actionText: String,
    val realCompanySays: String?,
    val escalateToGuardian: Boolean,
    val guardianSummary: String?,
    /** "en" | "fr" */
    val language: String,
)

data class Guardian(val id: String, val name: String)

data class PairResult(val token: String, val userName: String, val locale: String?)

data class CheckResult(val checkId: String, val verdict: Verdict, val guardians: List<Guardian>)

data class GuardianAnswer(
    val checkId: String,
    val guardianName: String,
    /** "scam" | "real" | "call_me" */
    val answer: String,
    val answeredAt: String,
)

/** A check kept on the phone so the Verdict screen can show it. [local] = offline fallback. */
data class StoredCheck(
    val checkId: String,
    val from: String,
    val body: String?,
    val receivedAt: String,
    val verdict: Verdict,
    val guardians: List<Guardian>,
    val local: Boolean,
)

/** JSON mapping for the device API contract (snake_case inside `verdict`). */
object ApiJson {
    private val VERDICTS = setOf("scam", "be_careful", "safe")

    fun JSONObject.stringOrNull(key: String): String? =
        if (!has(key) || isNull(key)) null else optString(key).takeIf { it.isNotBlank() }

    fun parsePair(json: String): PairResult {
        val o = JSONObject(json)
        return PairResult(
            token = o.getString("token"),
            userName = o.optString("userName", ""),
            locale = o.stringOrNull("locale"),
        )
    }

    fun parseVerdict(o: JSONObject): Verdict {
        val raw = o.optString("verdict", "be_careful").lowercase()
        val reasons = o.optJSONArray("reasons") ?: JSONArray()
        return Verdict(
            verdict = if (raw in VERDICTS) raw else "be_careful",
            confidence = o.optDouble("confidence", 0.0).takeUnless { it.isNaN() } ?: 0.0,
            headline = o.optString("headline", ""),
            reasons = (0 until reasons.length()).mapNotNull { i ->
                when (val r = reasons.opt(i)) {
                    is JSONObject -> r.stringOrNull("text")?.let { Reason(it, r.stringOrNull("evidence")) }
                    is String -> Reason(r, null)
                    else -> null
                }
            },
            action = o.optString("action", ""),
            actionText = o.optString("action_text", ""),
            realCompanySays = o.stringOrNull("real_company_says"),
            escalateToGuardian = o.optBoolean("escalate_to_guardian", false),
            guardianSummary = o.stringOrNull("guardian_summary"),
            language = if (o.optString("language", "en").lowercase().startsWith("fr")) "fr" else "en",
        )
    }

    fun parseGuardians(arr: JSONArray?): List<Guardian> {
        if (arr == null) return emptyList()
        return (0 until arr.length()).mapNotNull { i ->
            arr.optJSONObject(i)?.let { Guardian(it.optString("id", ""), it.optString("name", "")) }
        }
    }

    fun parseCheck(json: String): CheckResult {
        val o = JSONObject(json)
        return CheckResult(
            checkId = o.getString("checkId"),
            verdict = parseVerdict(o.getJSONObject("verdict")),
            guardians = parseGuardians(o.optJSONArray("guardians")),
        )
    }

    fun parseSentTo(json: String): List<String> {
        val arr = JSONObject(json).optJSONArray("sentTo") ?: return emptyList()
        return (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
    }

    fun parseAnswers(json: String): List<GuardianAnswer> {
        val arr = JSONObject(json).optJSONArray("answers") ?: return emptyList()
        return (0 until arr.length()).mapNotNull { i ->
            val a = arr.optJSONObject(i) ?: return@mapNotNull null
            GuardianAnswer(
                checkId = a.optString("checkId"),
                guardianName = a.optString("guardianName"),
                answer = a.optString("answer"),
                answeredAt = a.optString("answeredAt"),
            )
        }
    }

    fun errorMessage(json: String): String? =
        runCatching { JSONObject(json).stringOrNull("error") }.getOrNull()

    // --- Local persistence (same shape as the API so one parser serves both) -----------

    fun verdictToJson(v: Verdict): JSONObject = JSONObject()
        .put("verdict", v.verdict)
        .put("confidence", v.confidence)
        .put("headline", v.headline)
        .put("reasons", JSONArray().apply {
            v.reasons.forEach { put(JSONObject().put("text", it.text).put("evidence", it.evidence ?: JSONObject.NULL)) }
        })
        .put("action", v.action)
        .put("action_text", v.actionText)
        .put("real_company_says", v.realCompanySays ?: JSONObject.NULL)
        .put("escalate_to_guardian", v.escalateToGuardian)
        .put("guardian_summary", v.guardianSummary ?: JSONObject.NULL)
        .put("language", v.language)

    fun storedToJson(c: StoredCheck): String = JSONObject()
        .put("checkId", c.checkId)
        .put("from", c.from)
        .put("body", c.body ?: JSONObject.NULL)
        .put("receivedAt", c.receivedAt)
        .put("verdict", verdictToJson(c.verdict))
        .put("guardians", JSONArray().apply { c.guardians.forEach { put(JSONObject().put("id", it.id).put("name", it.name)) } })
        .put("local", c.local)
        .toString()

    fun storedFromJson(json: String): StoredCheck {
        val o = JSONObject(json)
        return StoredCheck(
            checkId = o.getString("checkId"),
            from = o.optString("from"),
            body = o.stringOrNull("body"),
            receivedAt = o.optString("receivedAt"),
            verdict = parseVerdict(o.getJSONObject("verdict")),
            guardians = parseGuardians(o.optJSONArray("guardians")),
            local = o.optBoolean("local", false),
        )
    }
}

/** Pairing QR payload: {"v":1,"server":"http://…","code":"ABCD1234"}. */
data class PairingPayload(val server: String, val code: String) {
    companion object {
        fun parse(raw: String?): PairingPayload? {
            val text = raw?.trim() ?: return null
            if (!text.startsWith("{")) return null
            return runCatching {
                val o = JSONObject(text)
                if (o.optInt("v", 1) != 1) return null
                val server = o.optString("server").trim()
                val code = o.optString("code").trim()
                if (server.isEmpty() || code.isEmpty()) null else PairingPayload(normalizeServer(server), normalizeCode(code))
            }.getOrNull()
        }

        /** Trim, drop trailing slashes, default to https:// when no scheme is given. */
        fun normalizeServer(input: String): String {
            val s = input.trim().trimEnd('/')
            return if (s.startsWith("http://", ignoreCase = true) || s.startsWith("https://", ignoreCase = true)) s
            else "https://$s"
        }

        /** Codes are shown uppercase; tolerate spaces and lowercase typing. */
        fun normalizeCode(input: String): String = input.filterNot { it.isWhitespace() }.uppercase()
    }
}
