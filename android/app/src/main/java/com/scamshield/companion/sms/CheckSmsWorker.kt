package com.scamshield.companion.sms

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.scamshield.companion.R
import com.scamshield.companion.data.CheckStore
import com.scamshield.companion.data.Session
import com.scamshield.companion.net.ApiClient
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
import java.util.UUID

/** Sends one flagged text to the server off the main thread and notifies the result. */
class CheckSmsWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val ctx = applicationContext
        val from = inputData.getString(KEY_FROM).orEmpty()
        val body = inputData.getString(KEY_BODY) ?: return@withContext Result.success()
        val receivedAt = inputData.getString(KEY_RECEIVED_AT) ?: nowIso()
        val signals = inputData.getStringArray(KEY_SIGNALS).orEmpty()
            .mapNotNull { runCatching { Signal.valueOf(it) }.getOrNull() }
            .toSet()

        val session = Session(ctx)
        val server = session.server
        val token = session.token
        if (server == null || token == null) {
            Log.w(TAG, "Not paired; showing local warning")
            fallback(ctx, from, body, receivedAt, signals)
            return@withContext Result.success()
        }

        try {
            val result = ApiClient(server, token).check(from, body, receivedAt)
            val stored = StoredCheck(result.checkId, from, body, receivedAt, result.verdict, result.guardians, local = false)
            CheckStore(ctx).save(stored)
            if (result.verdict.verdict == "safe") {
                Log.i(TAG, "Server verdict safe; no notification")
            } else {
                Log.i(TAG, "Server verdict ${result.verdict.verdict}; notifying")
                Notifier.showVerdict(ctx, stored)
            }
        } catch (e: UnauthorizedException) {
            Log.w(TAG, "Token revoked; clearing and showing local warning")
            session.clear()
            fallback(ctx, from, body, receivedAt, signals)
        } catch (e: IOException) {
            Log.w(TAG, "Server unreachable (${e.message}); showing local warning")
            fallback(ctx, from, body, receivedAt, signals)
        } catch (e: JSONException) {
            Log.w(TAG, "Bad server response (${e.message}); showing local warning")
            fallback(ctx, from, body, receivedAt, signals)
        }
        Result.success()
    }

    /** Needed only when the expedited request runs as a foreground service (API < 31). */
    override suspend fun getForegroundInfo(): ForegroundInfo =
        ForegroundInfo(Notifier.STATUS_NOTIFICATION_ID, Notifier.statusNotification(applicationContext))

    private fun fallback(ctx: Context, from: String, body: String, receivedAt: String, signals: Set<Signal>) {
        val check = localCheck(ctx, from, body, receivedAt, signals)
        CheckStore(ctx).save(check)
        Notifier.showFallback(ctx, check)
    }

    companion object {
        private const val TAG = "ScamShieldCheck"
        private const val KEY_FROM = "from"
        private const val KEY_BODY = "body"
        private const val KEY_RECEIVED_AT = "receivedAt"
        private const val KEY_SIGNALS = "signals"
        // WorkManager Data is capped at 10 KB; real SMS are far shorter.
        private const val MAX_BODY_CHARS = 3000

        fun enqueue(context: Context, from: String, body: String, receivedAtMillis: Long, signals: Set<Signal>) {
            val data = workDataOf(
                KEY_FROM to from,
                KEY_BODY to body.take(MAX_BODY_CHARS),
                KEY_RECEIVED_AT to Instant.ofEpochMilli(receivedAtMillis).truncatedTo(ChronoUnit.SECONDS).toString(),
                KEY_SIGNALS to signals.map { it.name }.toTypedArray(),
            )
            val request = OneTimeWorkRequestBuilder<CheckSmsWorker>()
                .setInputData(data)
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .addTag("sms-check")
                .build()
            WorkManager.getInstance(context).enqueue(request)
        }

        fun nowIso(): String = Instant.now().truncatedTo(ChronoUnit.SECONDS).toString()

        /** Offline verdict built from the on-device signals, in the phone's language. */
        fun localCheck(ctx: Context, from: String, body: String?, receivedAt: String, signals: Set<Signal>): StoredCheck {
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
            return StoredCheck("local-" + UUID.randomUUID(), from, body, receivedAt, verdict, emptyList(), local = true)
        }

        private fun reasonRes(s: Signal): Int = when (s) {
            Signal.LINK -> R.string.reason_link
            Signal.URGENCY -> R.string.reason_urgency
            Signal.GIFT_CARD -> R.string.reason_gift_card
            Signal.CRYPTO -> R.string.reason_crypto
            Signal.CODE_ASK -> R.string.reason_code
            Signal.MONEY_ASK -> R.string.reason_money
            Signal.NEW_NUMBER -> R.string.reason_new_number
        }
    }
}
