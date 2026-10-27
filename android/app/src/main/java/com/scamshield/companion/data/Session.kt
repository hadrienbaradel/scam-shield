package com.scamshield.companion.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Pairing state. Private-mode SharedPreferences; the device token itself is
 * encrypted with an AES-256-GCM key that lives in the Android Keystore, so it is
 * unreadable even from a file-level copy of the app's data.
 */
class Session(context: Context) {

    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    val server: String? get() = prefs.getString(KEY_SERVER, null)
    val userName: String? get() = prefs.getString(KEY_USER, null)
    val locale: String? get() = prefs.getString(KEY_LOCALE, null)

    val token: String?
        get() = prefs.getString(KEY_TOKEN, null)?.let { TokenCipher.decrypt(it) }

    val isPaired: Boolean get() = server != null && token != null

    fun save(server: String, token: String, userName: String, locale: String?) {
        prefs.edit()
            .putString(KEY_SERVER, server)
            .putString(KEY_TOKEN, TokenCipher.encrypt(token))
            .putString(KEY_USER, userName)
            .putString(KEY_LOCALE, locale)
            .apply()
    }

    /** Forget the token (revoked or unpaired). Keeps the last server URL to prefill pairing. */
    fun clear() {
        prefs.edit().remove(KEY_TOKEN).remove(KEY_USER).remove(KEY_LOCALE).commit()
    }

    companion object {
        private const val PREFS = "session"
        private const val KEY_SERVER = "server"
        private const val KEY_TOKEN = "token_enc"
        private const val KEY_USER = "user_name"
        private const val KEY_LOCALE = "locale"
    }
}

internal object TokenCipher {
    private const val ALIAS = "scamshield_device_token"
    private const val TRANSFORM = "AES/GCM/NoPadding"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }

    fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val ct = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return b64(cipher.iv) + ":" + b64(ct)
    }

    fun decrypt(stored: String): String? = runCatching {
        val (iv, ct) = stored.split(":", limit = 2).map { Base64.decode(it, Base64.NO_WRAP) }
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
        String(cipher.doFinal(ct), Charsets.UTF_8)
    }.getOrNull()

    private fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)
}
