package com.scamshield.companion.prescreen

/**
 * On-device gate deciding whether an incoming text may leave the phone.
 *
 * Only texts that look risky are sent to the server; everything else stays on the
 * device. The regex implementation below is the default. An on-device model
 * ("Muse Glimmer", runtime TBD) can replace it by implementing this interface and
 * assigning it to [PreScreeners.current].
 */
interface PreScreener {
    fun assess(from: String, body: String): PreScreen
}

enum class Signal { LINK, URGENCY, GIFT_CARD, CRYPTO, CODE_ASK, MONEY_ASK, NEW_NUMBER }

data class PreScreen(
    /** True when the text should be sent to the server for a full check. */
    val shouldSend: Boolean,
    /** Why it was flagged, in detection order. Empty when [shouldSend] is false. */
    val signals: Set<Signal>,
)

object PreScreeners {
    @Volatile
    var current: PreScreener = RegexPreScreener()
}

/**
 * Regex pre-screen. The risk patterns are ported from the server detector
 * (lib/detector.js), case-insensitive. Kotlin/JVM adds UNICODE_CASE with
 * IGNORE_CASE, so accented French words match in any case.
 */
class RegexPreScreener : PreScreener {

    override fun assess(from: String, body: String): PreScreen {
        val signals = linkedSetOf<Signal>()
        if (containsLink(body)) signals += Signal.LINK
        for ((signal, regex) in RISK_PATTERNS) {
            if (regex.containsMatchIn(body)) signals += signal
        }
        return PreScreen(shouldSend = signals.isNotEmpty(), signals = signals)
    }

    companion object {
        private fun ci(pattern: String) = Regex(pattern, RegexOption.IGNORE_CASE)

        val URGENCY = ci(
            """(urgent|immediately|act now|within \d+ (hours|days)|final notice|suspended|will be (closed|locked)|legal action|arrest|pay today|avoid (fees|penalty)|dans \d+ jours|immédiatement|suspendu|sera bloqué)"""
        )
        val GIFT_CARD = ci("""(gift ?cards?|apple gift|google play card|transcash|pcs coupon|cartes? cadeaux?)""")
        val CRYPTO = ci("""(bitcoin|crypto|btc|bitcoin atm|crypto atm)""")
        val CODE_ASK = ci(
            """(verification code|one-time code|security code|send (me|back) the code|code you (received|got)|code de (vérification|validation)|renvoyez.*code)"""
        )
        val MONEY_ASK = ci(
            """(send|pay|buy|transfer|wire|envoyer|payer|acheter|transférer).{0,40}(\$|€|£|\d+\s*(dollars|euros|usd|eur))"""
        )
        // Server pattern plus the French past-tense form ("j'ai changé de numéro"),
        // accent-tolerant because many people type without accents.
        val NEW_NUMBER = ci("""(changed my number|new number|nouveau numéro|chang[eé] de num[eé]ro)""")

        private val RISK_PATTERNS = listOf(
            Signal.URGENCY to URGENCY,
            Signal.GIFT_CARD to GIFT_CARD,
            Signal.CRYPTO to CRYPTO,
            Signal.CODE_ASK to CODE_ASK,
            Signal.MONEY_ASK to MONEY_ASK,
            Signal.NEW_NUMBER to NEW_NUMBER,
        )

        /** Explicit links: any scheme-prefixed http(s) URL, or www.-prefixed host. */
        val URL = ci("""(https?://\S+|\bwww\.[a-z0-9-]+\.\S+)""")

        // TLDs common in real links and in SMS phishing. Deliberately excludes short
        // TLDs that are also everyday words typed without a space after a period
        // ("thanks.me", "ok.so", "ready.to"), to avoid shipping harmless texts.
        private const val TLDS =
            "com|net|org|info|biz|io|co|us|uk|ca|fr|de|eu|es|nl|ch|be|ru|cn|au|br|mx|" +
                "top|xyz|online|site|club|shop|store|app|link|live|icu|vip|cc|ly|gl|gd|" +
                "tk|ml|ga|cf|gq|pw|buzz|rest|cyou|sbs|bond|support|help|services|digital|" +
                "click|world|website|space|tech|cloud|page|pro|mobi|ws|su|asia|" +
                "cfd|lol|monster|quest|ink|gov|tv|ai|dev|email|delivery|express|" +
                "finance|bank|claims|refund|tax"

        /**
         * Bare domains such as "usps-redeliver.top" or "bit.ly/x". Not preceded by a
         * word char, "@", "." or "-" (so e-mail addresses and decimals are ignored).
         */
        val BARE_DOMAIN = ci(
            """(?<![\w@.-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:$TLDS)(?![\w-])"""
        )

        fun containsLink(body: String): Boolean =
            URL.containsMatchIn(body) || BARE_DOMAIN.containsMatchIn(body)
    }
}
