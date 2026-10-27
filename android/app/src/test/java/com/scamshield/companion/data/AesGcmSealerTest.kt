package com.scamshield.companion.data

import com.scamshield.companion.sms.CheckSmsWorker
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/** The sealing used for the device token, queued SMS and stored checks (software key on the JVM). */
class AesGcmSealerTest {

    private fun newKey(): SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

    private val key = newKey()
    private val sealer = AesGcmSealer { key }

    private val sms = "Bonjour Mamie, mon téléphone est cassé. Peux-tu régler 890 euros ? 🙏"

    @Test fun round_trips_unicode() = assertEquals(sms, sealer.decrypt(sealer.encrypt(sms)))

    @Test fun round_trips_empty_sender() = assertEquals("", sealer.decrypt(sealer.encrypt("")))

    @Test fun sealed_value_hides_the_plaintext() {
        val sealed = sealer.encrypt(sms)
        assertFalse(sealed.contains("Mamie"))
        assertFalse(sealed.contains("890"))
        val (iv, ct) = sealed.split(":").map { Base64.getDecoder().decode(it) }
        assertEquals(12, iv.size)
        assertFalse(String(ct, Charsets.ISO_8859_1).contains("Mamie"))
    }

    @Test fun fresh_iv_each_time() = assertNotEquals(sealer.encrypt(sms), sealer.encrypt(sms))

    @Test fun tampering_is_detected() {
        val (iv, ct) = sealer.encrypt(sms).split(":")
        val bytes = Base64.getDecoder().decode(ct)
        bytes[0] = (bytes[0].toInt() xor 1).toByte()
        assertNull(sealer.decrypt(iv + ":" + Base64.getEncoder().encodeToString(bytes)))
    }

    @Test fun other_key_cannot_open() {
        val other = newKey()
        assertNull(AesGcmSealer { other }.decrypt(sealer.encrypt(sms)))
    }

    @Test fun malformed_input_is_null_not_a_crash() {
        assertNull(sealer.decrypt(""))
        assertNull(sealer.decrypt("no-colon"))
        assertNull(sealer.decrypt("!!!:???"))
    }

    @Test fun longest_queued_body_fits_workmanager_data_limit() {
        // Worst case for size: 3-byte UTF-8 characters at the truncation limit.
        val sealed = sealer.encrypt("中".repeat(CheckSmsWorker.MAX_BODY_CHARS))
        assertTrue("sealed body is ${sealed.length} chars", sealed.length < 8 * 1024)
    }
}
