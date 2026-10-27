package com.scamshield.companion.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Locks the parsers to the device API contract. */
class ApiJsonTest {

    private val checkResponse = """
        {"checkId":"7d1c","verdict":{"verdict":"scam","confidence":0.92,
         "headline":"STOP. This looks like a scam.",
         "reasons":[{"text":"The link is not usps.com","evidence":"link"},{"text":"It asks for a small fee","evidence":"money"}],
         "action":"delete","action_text":"Delete it. USPS never texts for fees.",
         "real_company_says":"USPS will never text you asking for a payment.",
         "escalate_to_guardian":true,"guardian_summary":null,"language":"en"},
         "guardians":[{"id":"g1","name":"Thomas"}]}
    """.trimIndent()

    @Test fun parses_check_response() {
        val r = ApiJson.parseCheck(checkResponse)
        assertEquals("7d1c", r.checkId)
        assertEquals("scam", r.verdict.verdict)
        assertEquals(0.92, r.verdict.confidence, 1e-9)
        assertEquals(2, r.verdict.reasons.size)
        assertEquals("link", r.verdict.reasons[0].evidence)
        assertEquals("Delete it. USPS never texts for fees.", r.verdict.actionText)
        assertEquals("USPS will never text you asking for a payment.", r.verdict.realCompanySays)
        assertTrue(r.verdict.escalateToGuardian)
        assertNull(r.verdict.guardianSummary)
        assertEquals(listOf(Guardian("g1", "Thomas")), r.guardians)
    }

    @Test fun null_real_company_says_is_null_not_the_string_null() {
        val r = ApiJson.parseCheck(checkResponse.replace("\"USPS will never text you asking for a payment.\"", "null"))
        assertNull(r.verdict.realCompanySays)
    }

    @Test fun unknown_verdict_defaults_to_be_careful_and_fr_language() {
        val v = ApiJson.parseCheck(checkResponse.replace("\"scam\"", "\"weird\"").replace("\"en\"", "\"fr\"")).verdict
        assertEquals("be_careful", v.verdict)
        assertEquals("fr", v.language)
    }

    @Test fun stored_check_round_trips() {
        val r = ApiJson.parseCheck(checkResponse)
        val stored = StoredCheck(r.checkId, "+15551234", "body", "2026-10-27T14:00:00Z", r.verdict, r.guardians, local = false)
        assertEquals(stored, ApiJson.storedFromJson(ApiJson.storedToJson(stored)))
    }

    @Test fun parses_pair_ask_answers_and_errors() {
        val p = ApiJson.parsePair("""{"token":"tok","userName":"Linda","locale":"en-US"}""")
        assertEquals(PairResult("tok", "Linda", "en-US"), p)
        assertEquals(listOf("Thomas"), ApiJson.parseSentTo("""{"sentTo":["Thomas"]}"""))
        val a = ApiJson.parseAnswers("""{"answers":[{"checkId":"c1","guardianName":"Thomas","answer":"call_me","answeredAt":"2026-10-27T14:05:00Z"}]}""")
        assertEquals(GuardianAnswer("c1", "Thomas", "call_me", "2026-10-27T14:05:00Z"), a.single())
        assertEquals("Invalid code", ApiJson.errorMessage("""{"error":"Invalid code"}"""))
        assertNull(ApiJson.errorMessage("not json"))
    }

    @Test fun parses_qr_payload_and_normalizes() {
        val p = PairingPayload.parse("""{"v":1,"server":"http://192.168.1.20:3000/","code":"abcd 1234"}""")
        assertEquals(PairingPayload("http://192.168.1.20:3000", "ABCD1234"), p)
        assertNull(PairingPayload.parse("ABCD1234"))
        assertNull(PairingPayload.parse("""{"v":2,"server":"x","code":"y"}"""))
        assertEquals("https://scamshield.example", PairingPayload.normalizeServer(" scamshield.example/ "))
        assertFalse(PairingPayload.normalizeServer("http://10.0.2.2:3000").startsWith("https"))
    }
}
