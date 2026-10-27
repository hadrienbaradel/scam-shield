package com.scamshield.companion.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import com.scamshield.companion.prescreen.PreScreeners

/**
 * Receives incoming SMS, joins multipart PDUs, runs the on-device pre-screen and
 * queues only risky texts for a server check. Everything else never leaves the phone.
 */
class SmsReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent)?.filterNotNull().orEmpty()
        if (parts.isEmpty()) return

        // One broadcast carries all PDUs of a multipart text; group by sender to be safe.
        parts.groupBy { it.displayOriginatingAddress ?: it.originatingAddress ?: "" }
            .forEach { (from, pdus) ->
                val body = pdus.joinToString(separator = "") { it.displayMessageBody ?: it.messageBody ?: "" }
                if (body.isBlank()) return@forEach
                // Device clock at receipt. The PDU's service-centre timestamp is unreliable
                // (timezone/DST errors seen on the emulator and on real networks).
                val timestamp = System.currentTimeMillis()

                val screen = PreScreeners.current.assess(from, body)
                if (!screen.shouldSend) {
                    Log.d(TAG, "SMS kept on device (no risk signals)")
                    return@forEach
                }
                Log.i(TAG, "SMS flagged on device: ${screen.signals}; queueing server check")
                CheckSmsWorker.enqueue(context, from, body, timestamp, screen.signals)
            }
    }

    private companion object {
        const val TAG = "ScamShieldSms"
    }
}
