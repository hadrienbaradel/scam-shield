package com.scamshield.companion.notify

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.scamshield.companion.R
import com.scamshield.companion.VerdictActivity
import com.scamshield.companion.net.StoredCheck

object Notifier {
    const val CHANNEL_ALERTS = "scam_alerts"
    const val CHANNEL_STATUS = "scam_status"
    const val STATUS_NOTIFICATION_ID = 1
    /** Alerts are posted as (tag = per-text key, id = this), so one text owns one slot. */
    private const val ALERT_NOTIFICATION_ID = 2

    fun ensureChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ALERTS, context.getString(R.string.channel_alerts_name), NotificationManager.IMPORTANCE_HIGH).apply {
                description = context.getString(R.string.channel_alerts_desc)
                enableVibration(true)
                lockscreenVisibility = Notification.VISIBILITY_PRIVATE
            }
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_STATUS, context.getString(R.string.channel_status_name), NotificationManager.IMPORTANCE_MIN)
        )
    }

    /**
     * Server verdict. Callers must not pass "safe" verdicts (use [cancel] instead).
     * [key] identifies the text: the same key replaces that text's earlier fallback alert.
     */
    fun showVerdict(context: Context, check: StoredCheck, key: String = check.checkId) {
        val v = check.verdict
        val text = v.actionText.ifBlank { v.reasons.firstOrNull()?.text.orEmpty() }
        post(context, key, check.checkId, v.headline, text, colorFor(context, v.verdict))
    }

    /** Server unreachable / not paired: local warning in the phone's language. */
    fun showFallback(context: Context, check: StoredCheck, key: String = check.checkId) {
        post(
            context,
            key,
            check.checkId,
            context.getString(R.string.fallback_title),
            context.getString(R.string.fallback_notification),
            colorFor(context, "be_careful"),
        )
    }

    /** Removes the alert for one text (e.g. its fallback, once the server says it is safe). */
    fun cancel(context: Context, key: String) {
        NotificationManagerCompat.from(context).cancel(key, ALERT_NOTIFICATION_ID)
    }

    fun statusNotification(context: Context): Notification =
        NotificationCompat.Builder(context, CHANNEL_STATUS)
            .setSmallIcon(R.drawable.ic_stat_shield)
            .setContentTitle(context.getString(R.string.checking_text))
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .build()

    private fun post(context: Context, key: String, checkId: String, title: String, text: String, color: Int) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return

        val open = Intent(context, VerdictActivity::class.java)
            .putExtra(VerdictActivity.EXTRA_CHECK_ID, checkId)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val pending = PendingIntent.getActivity(
            // Same request code per text, so FLAG_UPDATE_CURRENT repoints it at the new check.
            context, key.hashCode(), open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        // Lock screen shows only a neutral line; the headline appears once unlocked.
        val publicVersion = NotificationCompat.Builder(context, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_stat_shield)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(context.getString(R.string.notification_public))
            .setColor(color)
            .build()

        val n = NotificationCompat.Builder(context, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_stat_shield)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setColor(color)
            .setColorized(false)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
        NotificationManagerCompat.from(context).notify(key, ALERT_NOTIFICATION_ID, n)
    }

    fun colorFor(context: Context, verdict: String): Int = ContextCompat.getColor(
        context,
        when (verdict) {
            "scam" -> R.color.verdict_scam
            "safe" -> R.color.verdict_safe
            else -> R.color.verdict_careful
        },
    )
}
