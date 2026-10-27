package com.scamshield.companion.net

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** Server said 401: the device token was revoked. Caller clears it and returns to pairing. */
class UnauthorizedException : IOException("Device token rejected (401)")

/** Any other non-2xx answer. */
class ApiException(val status: Int, val serverMessage: String?) : IOException("HTTP $status${serverMessage?.let { ": $it" } ?: ""}")

/**
 * Minimal blocking client for the device API. Call from a background thread.
 * HttpURLConnection + org.json (both in the platform) keep the APK free of HTTP deps.
 */
class ApiClient(baseUrl: String, private val token: String? = null) {

    private val base = baseUrl.trim().trimEnd('/')

    fun pair(code: String, deviceName: String): PairResult {
        val body = JSONObject().put("code", code).put("name", deviceName)
        return ApiJson.parsePair(request("POST", "/api/devices/pair", body, authenticated = false))
    }

    fun check(from: String, body: String, receivedAt: String): CheckResult {
        val payload = JSONObject().put("from", from).put("body", body).put("receivedAt", receivedAt)
        return ApiJson.parseCheck(request("POST", "/api/devices/check", payload))
    }

    fun ask(checkId: String): List<String> =
        ApiJson.parseSentTo(request("POST", "/api/devices/ask", JSONObject().put("checkId", checkId)))

    fun answers(since: String): List<GuardianAnswer> =
        ApiJson.parseAnswers(request("GET", "/api/devices/answers?since=" + URLEncoder.encode(since, "UTF-8"), null))

    private fun request(method: String, path: String, body: JSONObject?, authenticated: Boolean = true): String {
        val conn = URL(base + path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = CONNECT_TIMEOUT_MS
            conn.readTimeout = READ_TIMEOUT_MS
            conn.useCaches = false
            conn.setRequestProperty("Accept", "application/json")
            if (authenticated) {
                val t = token ?: throw UnauthorizedException()
                conn.setRequestProperty("Authorization", "Bearer $t")
            }
            if (body != null) {
                val bytes = body.toString().toByteArray(Charsets.UTF_8)
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                conn.setFixedLengthStreamingMode(bytes.size)
                conn.outputStream.use { it.write(bytes) }
            }
            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (status == 401 && authenticated) throw UnauthorizedException()
            if (status !in 200..299) throw ApiException(status, ApiJson.errorMessage(text))
            return text
        } finally {
            conn.disconnect()
        }
    }

    companion object {
        const val CONNECT_TIMEOUT_MS = 10_000
        // The server may call an LLM to write the explanation.
        const val READ_TIMEOUT_MS = 45_000
    }
}
