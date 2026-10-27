package com.scamshield.companion.prescreen

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RegexPreScreenerTest {

    private val screener: PreScreener = RegexPreScreener()

    private fun assess(body: String) = screener.assess("+15551234", body)

    private fun assertSends(body: String, vararg expected: Signal) {
        val result = assess(body)
        assertTrue("expected send for: $body (signals=${result.signals})", result.shouldSend)
        for (s in expected) assertTrue("expected $s for: $body (got ${result.signals})", s in result.signals)
    }

    private fun assertStaysOnPhone(body: String) {
        val result = assess(body)
        assertFalse("expected NO send for: $body (signals=${result.signals})", result.shouldSend)
        assertTrue(result.signals.isEmpty())
    }

    // --- The three acceptance samples -------------------------------------------------

    @Test fun usps_link_and_payment_is_sent() =
        assertSends("USPS: package on hold, pay \$1.99 https://usps-redeliver.test", Signal.LINK, Signal.MONEY_ASK)

    @Test fun family_greeting_stays_on_phone() = assertStaysOnPhone("Hi Grandma, see you Sunday!")

    @Test fun french_new_number_money_ask_is_sent() =
        assertSends("Mamie, j'ai changé de numéro, peux-tu m'envoyer 200 € ?", Signal.MONEY_ASK, Signal.NEW_NUMBER)

    // --- Links ---------------------------------------------------------------------------

    @Test fun bare_domain_is_a_link() = assertSends("Your toll is unpaid. Settle at usps-redeliver.top/pay", Signal.LINK)

    @Test fun bare_domain_uppercase_is_a_link() = assertSends("ACTION REQUIRED: AMAZON-REFUND.SUPPORT", Signal.LINK)

    @Test fun shortener_is_a_link() = assertSends("Votre colis: bit.ly/3xYz", Signal.LINK)

    @Test fun www_prefix_is_a_link() = assertSends("see www.example.org for details", Signal.LINK)

    @Test fun http_url_is_a_link() = assertSends("Chronopost: http://chrono-colis.info/fr", Signal.LINK)

    @Test fun email_address_is_not_a_link() = assertStaysOnPhone("Write to anne.martin@gmail.com when you can")

    @Test fun decimals_and_times_are_not_links() = assertStaysOnPhone("Lunch at 12.30, it costs 9.50 each")

    @Test fun missing_space_after_period_is_not_a_link() = assertStaysOnPhone("Thanks.See you soon.Love you")

    @Test fun lookalike_tld_prefix_is_not_a_link() = assertStaysOnPhone("Thanks.Community dinner tonight")

    // --- Risk regexes, EN and FR ----------------------------------------------------------

    @Test fun urgency_en() = assertSends("Your account will be locked. Call now.", Signal.URGENCY)

    @Test fun urgency_within_hours() = assertSends("Respond within 24 hours to avoid closure", Signal.URGENCY)

    @Test fun urgency_fr() = assertSends("Votre compte sera bloqué dans 3 jours", Signal.URGENCY)

    @Test fun urgency_fr_uppercase_accent() = assertSends("RÉPONDEZ IMMÉDIATEMENT", Signal.URGENCY)

    @Test fun gift_card_en() = assertSends("Buy 3 Apple gift cards for me, I'll explain later", Signal.GIFT_CARD)

    @Test fun gift_card_fr() = assertSends("Achète des cartes cadeaux Transcash stp", Signal.GIFT_CARD)

    @Test fun crypto() = assertSends("Deposit the cash at the Bitcoin ATM on Main St", Signal.CRYPTO)

    @Test fun code_ask_en() = assertSends("Please send me the code you received", Signal.CODE_ASK)

    @Test fun code_ask_fr() = assertSends("Renvoyez-moi le code reçu par SMS", Signal.CODE_ASK)

    @Test fun money_ask_en() = assertSends("Can you wire 500 dollars to my friend", Signal.MONEY_ASK)

    @Test fun new_number_en() = assertSends("Hi mom, this is my new number", Signal.NEW_NUMBER)

    @Test fun new_number_fr_without_accents() = assertSends("Coucou c'est moi, j'ai change de numero", Signal.NEW_NUMBER)

    // --- Money verbs added after review ---------------------------------------------------

    @Test fun money_ask_fr_regler() = assertSends("Peux-tu régler 890 euros au réparateur ?", Signal.MONEY_ASK)

    @Test fun money_ask_fr_virer_without_accents() = assertSends("Tu peux me virer 300 € ce soir", Signal.MONEY_ASK)

    @Test fun money_ask_fr_rembourser() = assertSends("Il faut rembourser 450 euros avant lundi", Signal.MONEY_ASK)

    @Test fun money_ask_en_cover_and_lend() {
        assertSends("Can you cover \$300 for the repair?", Signal.MONEY_ASK)
        assertSends("Could you lend me 200 dollars until Friday", Signal.MONEY_ASK)
    }

    @Test fun added_money_verbs_need_a_whole_word() =
        assertStaysOnPhone("Check the calendar, the ticket is 20 dollars")

    // --- Family emergency (grandparent scam) ------------------------------------------------

    @Test fun family_emergency_fr_broken_phone_money_is_sent() = assertSends(
        "Bonjour Mamie, mon téléphone est cassé. Peux-tu régler 890 euros au réparateur ? Je te rembourse demain.",
        Signal.FAMILY_EMERGENCY,
        Signal.MONEY_ASK,
    )

    @Test fun family_visit_fr_stays_on_phone() = assertStaysOnPhone("Mamie, on arrive dimanche à midi, bisous")

    @Test fun family_emergency_en_jail_is_sent() =
        assertSends("Grandma I'm in jail, I need \$2,000 for bail, don't tell mom", Signal.FAMILY_EMERGENCY)

    @Test fun family_lunch_en_stays_on_phone() = assertStaysOnPhone("Hi Mom, lunch Sunday?")

    @Test fun family_emergency_fr_without_accents_and_uppercase() =
        assertSends("GRAND-MERE je suis a l'HOPITAL, appelle ce numero", Signal.FAMILY_EMERGENCY)

    @Test fun family_word_inside_another_word_does_not_count() =
        assertStaysOnPhone("The moment the hospital opens, call Damon")

    // --- Benign texts stay on the phone ---------------------------------------------------

    @Test fun benign_texts_stay_on_phone() {
        listOf(
            "Call me when you land",
            "Bisous, à dimanche !",
            "Your appointment with Dr. Lee is tomorrow at 10.15",
            "Don't forget your pills",
            "I paid for lunch, you get the next one",
        ).forEach(::assertStaysOnPhone)
    }

    @Test fun signals_are_empty_when_not_sending() {
        val r = assess("See you at church")
        assertEquals(PreScreen(shouldSend = false, signals = emptySet()), r)
    }

    @Test fun screener_is_replaceable() {
        val previous = PreScreeners.current
        try {
            PreScreeners.current = object : PreScreener {
                override fun assess(from: String, body: String) = PreScreen(true, setOf(Signal.URGENCY))
            }
            assertTrue(PreScreeners.current.assess("x", "hello").shouldSend)
        } finally {
            PreScreeners.current = previous
        }
    }
}
