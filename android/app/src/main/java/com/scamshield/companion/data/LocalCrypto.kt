package com.scamshield.companion.data

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * AES-GCM sealing of short strings as "base64(iv):base64(ciphertext+tag)".
 *
 * Pure JVM (java.util.Base64, javax.crypto) so it can be unit-tested with a software
 * key; on the phone the key comes from the Android Keystore ([KeystoreKeys]). The
 * format matches what the device-token cipher always wrote, so existing pairings
 * still decrypt.
 */
class AesGcmSealer(private val key: () -> SecretKey) {

    fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORM)
        // No IV passed: the provider picks a fresh random one (the Keystore requires this).
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val ct = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return B64E.encodeToString(cipher.iv) + ":" + B64E.encodeToString(ct)
    }

    /** Null when the value is malformed, tampered with, or sealed under another key. */
    fun decrypt(sealed: String): String? = runCatching {
        val parts = sealed.split(":", limit = 2)
        require(parts.size == 2)
        val iv = B64D.decode(parts[0])
        val ct = B64D.decode(parts[1])
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, iv))
        String(cipher.doFinal(ct), Charsets.UTF_8)
    }.getOrNull()

    private companion object {
        const val TRANSFORM = "AES/GCM/NoPadding"
        const val TAG_BITS = 128
        val B64E: Base64.Encoder = Base64.getEncoder()
        val B64D: Base64.Decoder = Base64.getDecoder()
    }
}

/** AES-256-GCM keys that are generated in, and never leave, the Android Keystore. */
internal object KeystoreKeys {

    /** Synchronized so two threads cannot race to create (and overwrite) the same alias. */
    @Synchronized
    fun aes(alias: String): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }
}

internal object Ciphers {
    /** Device token (alias unchanged since the first release). */
    val token = AesGcmSealer { KeystoreKeys.aes("scamshield_device_token") }

    /** SMS sender and body at rest: WorkManager input data and the check store. */
    val content = AesGcmSealer { KeystoreKeys.aes("scamshield_sms_content") }
}
