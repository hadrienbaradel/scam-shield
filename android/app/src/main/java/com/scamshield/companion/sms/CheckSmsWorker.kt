package com.scamshield.companion.sms

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.scamshield.companion.R
import com.scamshield.companion.data.CheckStore
import com.scamshield.companion.data.Ciphers
import com.scamshield.companion.data.Session
import com.scamshield.companion.net.ApiClient
import com.scamshield.companion.net.ApiException
import com.scamshield.companion.net.Reason
import com.scamshield.companion.net.StoredCheck
import com.scamshield.companion.net.UnauthorizedException
import com.scamshield.companion.net.Verdict
import com.scamshield.companion.notify.Notifier
import com.scamshield.companion.prescreen.Signal
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONException
import java.io.IOException
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * Sends one flagged text to the server off the main thread and notifies the result.
 *
 * Sender and body arrive sealed with the Keystore content key, so WorkManager's database
 * never holds them in clear. If the server cannot be reached, the local warning is shown
 * once and the check is retried with exponential backoff; a later success replaces that
 * warning with the real verdict (same notification slot per text).
 */
class CheckSmsWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val ctx = applicationContext
        val store = CheckStore(ctx)
        // The work id is stable across retries, so it names this text.
        val key = "sms-$id"
        val localId = "local-$id"
        val receivedAt = inputData.getString(KEY_RECEIVED_AT) ?: nowIso()
        val signals = inputData.getStringArray(KEY_SIGNALS).orEmpty()
            .mapNotNull { runCatching { Signal.valueOf(it) }.getOrNull() }
            .toSet()

        val from = inputData.getString(KEY_FROM_SEALED)?.let { Ciphers.content.decrypt(it) }
        val body = inputData.getString(KEY_BODY_SEALED)?.let { Ciphers.content.decrypt(it) }

        /** Local warning, at most once per text even across retries. */
        fun warnOnce() {
            if (store.get(localId) != null) return
            val check = localCheck(ctx, localId, from.orEmpty(), body, receivedAt, signals)
            store.save(check)
            Notifier.showFallback(ctx, check, key)
        }

        if (from == null || body == null) {
            Log.w(TAG, "Queued text unreadable (content key missing?); showing local warning")
            warnOnce()
            return@withContext Result.failure()
        }

        val session = Session(ctx)
        val server = session.server
        val token = session.token
        if (server == null || token == null) {
            Log.w(TAG, "Not paired; showing local warning")
            warnOnce()
            return@withContext Result.success()
        }

        try {
            val result = ApiClient(server, token).check(from, body, receivedAt)
            val stored = StoredCheck(result.checkId, from, body, receivedAt, result.verdict, result.guardians, local = false)
            store.save(stored)
            store.remove(localId)
            if (result.verdict.verdict == "safe") {
                Log.i(TAG, "Server verdict safe; no notification (attempt ${runAttemptCount + 1})")
                Notifier.cancel(ctx, key)
            } else {
                Log.i(TAG, "Server verdict ${result.verdict.verdict}; notifying (attempt ${runAttemptCount + 1})")
                Notifier.showVerdict(ctx, stored, key)
            }
            Result.success()
        } catch (e: UnauthorizedException) {
            Log.w(TAG, "Token revoked; clearing and showing local warning")
            session.clear()
            warnOnce()
            Result.failure()
        } catch (e: IOException) {
            failed(e, ::warnOnce)
        } catch (e: JSONException) {
            failed(e, ::warnOnce)
        }
    }

    /** Server unreachable or bad answer: warn locally now, then retry or give up. */
    private fun failed(e: Exception, warnOnce: () -> Unit): Result {
        warnOnce()
        return when (CheckRetry.afterFailure(runAttemptCount, CheckRetry.isTransient(e))) {
            CheckRetry.Step.RETRY -> {
                Log.w(TAG, "Check failed (${e.javaClass.simpleName}); retry ${runAttemptCount + 1} of ${CheckRetry.MAX_ATTEMPTS - 1}")
                Result.retry()
            }
            CheckRetry.Step.GIVE_UP -> {
                Log.w(TAG, "Check failed (${e.javaClass.simpleName}) after ${runAttemptCount + 1} attempt(s); keeping local warning")
                Result.failure()
            }
        }
    }

    /** Needed only when the expedited request runs as a foreground service (API < 31). */
    override suspend fun getForegroundInfo(): ForegroundInfo =
        ForegroundInfo(Notifier.STATUS_NOTIFICATION_ID, Notifier.statusNotification(applicationContext))

    companion object {
        private const val TAG = "ScamShieldCheck"
        private const val KEY_FROM_SEALED = "from_enc"
        private const val KEY_BODY_SEALED = "body_enc"
        private const val KEY_RECEIVED_AT = "receivedAt"
        private const val KEY_SIGNALS = "signals"

        /**
         * WorkManager Data is capped at 10 KB. Sealed size is about 4/3 × UTF-8 bytes + 40,
         * so 1,600 chars (≤ 4,800 bytes even for 3-byte scripts) stays near 6.5 KB.
         * Concatenated SMS rarely exceed ~1,500 chars.
         */
        internal const val MAX_BODY_CHARS = 1600

        fun enqueue(context: Context, from: String, body: String, receivedAtMillis: Long, signals: Set<Signal>) {
            val data = workDataOf(
                KEY_FROM_SEALED to Ciphers.content.encrypt(from),
                KEY_BODY_SEALED to Ciphers.content.encrypt(body.take(MAX_BODY_CHARS)),
                KEY_RECEIVED_AT to Instant.ofEpochMilli(receivedAtMillis).truncatedTo(ChronoUnit.SECONDS).toString(),
                KEY_SIGNALS to signals.map { it.name }.toTypedArray(),
            )
            // No network constraint on purpose: the first attempt must run at once so the
            // local warning appears immediately when offline.
            val request = OneTimeWorkRequestBuilder<CheckSmsWorker>()
                .setInputData(data)
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, CheckRetry.INITIAL_BACKOFF_SECONDS, TimeUnit.SECONDS)
                .addTag("sms-check")
                .build()
            WorkManager.getInstance(context).enqueue(request)
        }

        fun nowIso(): String = Instant.now().truncatedTo(ChronoUnit.SECONDS).toString()

        /** Offline verdict built from the on-device signals, in the phone's language. */
        fun localCheck(
            ctx: Context,
            checkId: String,
            from: String,
            body: String?,
            receivedAt: String,
            signals: Set<Signal>,
        ): StoredCheck {
            val reasons = signals.map { Reason(ctx.getString(reasonRes(it)), null) }.take(3)
            val lang = if (Locale.getDefault().language == "fr") "fr" else "en"
            val verdict = Verdict(
                verdict = "be_careful",
                confidence = 0.0,
                headline = ctx.getString(R.string.fallback_headline),
                reasons = reasons,
                action = "ask",
                actionText = ctx.getString(R.string.fallback_action),
                realCompanySays = null,
                escalateToGuardian = false,
                guardianSummary = null,
                language = lang,
            )
            return StoredCheck(checkId, from, body, receivedAt, verdict, emptyList(), local = true)
        }

        private fun reasonRes(s: Signal): Int = when (s) {
            Signal.LINK -> R.string.reason_link
            Signal.URGENCY -> R.string.reason_urgency
            Signal.GIFT_CARD -> R.string.reason_gift_card
            Signal.CRYPTO -> R.string.reason_crypto
            Signal.CODE_ASK -> R.string.reason_code
            Signal.MONEY_ASK -> R.string.reason_money
            Signal.NEW_NUMBER -> R.string.reason_new_number
            Signal.FAMILY_EMERGENCY -> R.string.reason_family_emergency
        }
    }
}

/** When a failed server check is retried. Pure logic, unit-tested. */
internal object CheckRetry {
    /** Total attempts, counting the first one (WorkManager runAttemptCount 0..5). */
    const val MAX_ATTEMPTS = 6
    const val INITIAL_BACKOFF_SECONDS = 30L

    enum class Step { RETRY, GIVE_UP }

    /**
     * Worth retrying: network errors, timeouts, 5xx, 408/429, and unparseable bodies
     * (captive portals, proxies). Not: 401 (token revoked) or other 4xx (retrying won't help).
     */
    fun isTransient(e: Exception): Boolean = when (e) {
        is UnauthorizedException -> false
        is ApiException -> e.status >= 500 || e.status == 408 || e.status == 429
        is IOException, is JSONException -> true
        else -> false
    }

    fun afterFailure(runAttemptCount: Int, transient: Boolean): Step =
        if (transient && runAttemptCount + 1 < MAX_ATTEMPTS) Step.RETRY else Step.GIVE_UP
}
