package com.scamshield.companion.data

import android.content.Context

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
        get() = prefs.getString(KEY_TOKEN, null)?.let { Ciphers.token.decrypt(it) }

    val isPaired: Boolean get() = server != null && token != null

    fun save(server: String, token: String, userName: String, locale: String?) {
        prefs.edit()
            .putString(KEY_SERVER, server)
            .putString(KEY_TOKEN, Ciphers.token.encrypt(token))
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
