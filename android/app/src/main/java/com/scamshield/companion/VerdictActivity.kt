package com.scamshield.companion

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.scamshield.companion.data.CheckStore
import com.scamshield.companion.data.Session
import com.scamshield.companion.net.ApiClient
import com.scamshield.companion.net.GuardianAnswer
import com.scamshield.companion.net.StoredCheck
import com.scamshield.companion.net.UnauthorizedException
import com.scamshield.companion.ui.AskState
import com.scamshield.companion.ui.InLanguage
import com.scamshield.companion.ui.ScamShieldTheme
import com.scamshield.companion.ui.VerdictScreen
import com.scamshield.companion.ui.inLanguage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.Locale

/** One verdict, one decision. Opened from a Scam alert notification. */
class VerdictActivity : ComponentActivity(), TextToSpeech.OnInitListener {

    private lateinit var session: Session
    private lateinit var store: CheckStore

    private var check by mutableStateOf<StoredCheck?>(null)
    private var answer by mutableStateOf<GuardianAnswer?>(null)
    private var askState by mutableStateOf<AskState>(AskState.Idle)
    private var speaking by mutableStateOf(false)
    private var ttsMessage by mutableStateOf<String?>(null)

    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var speakWhenReady = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        session = Session(this)
        store = CheckStore(this)
        if (!load(intent)) {
            finish()
            return
        }
        tts = TextToSpeech(this, this)

        setContent {
            ScamShieldTheme {
                val current = check
                if (current != null) {
                    InLanguage(current.verdict.language) {
                        VerdictScreen(
                            check = current,
                            answer = answer,
                            askState = askState,
                            speaking = speaking,
                            ttsMessage = ttsMessage,
                            onRead = ::toggleReadAloud,
                            onAsk = ::askTrustedPerson,
                            onOk = ::finish,
                        )
                    }
                }
            }
        }

        // Poll for the guardian's answer every 10 s, only while the screen is visible.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) { pollAnswers() }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (load(intent)) {
            answer = null
            askState = AskState.Idle
            ttsMessage = null
            stopSpeaking()
        }
    }

    override fun onDestroy() {
        tts?.stop()
        tts?.shutdown()
        tts = null
        super.onDestroy()
    }

    private fun load(intent: Intent?): Boolean {
        val id = intent?.getStringExtra(EXTRA_CHECK_ID) ?: return false
        val loaded = store.get(id) ?: return false
        check = loaded
        return true
    }

    private fun localized(): Context = inLanguage(check?.verdict?.language ?: "en")

    // --- Guardian ------------------------------------------------------------------------

    private fun askTrustedPerson() {
        val c = check ?: return
        val server = session.server
        val token = session.token
        if (c.local) return
        if (server == null || token == null) return backToPairing()
        askState = AskState.Sending
        lifecycleScope.launch {
            askState = try {
                AskState.Sent(withContext(Dispatchers.IO) { ApiClient(server, token).ask(c.checkId) })
            } catch (e: UnauthorizedException) {
                backToPairing()
                return@launch
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "ask failed: $e")
                AskState.Failed
            }
        }
    }

    private suspend fun pollAnswers() {
        while (true) {
            val c = check ?: return
            if (c.local) return
            val server = session.server
            val token = session.token
            if (server == null || token == null) return backToPairing()
            try {
                val answers = withContext(Dispatchers.IO) { ApiClient(server, token).answers(sinceFor(c)) }
                answers.filter { it.checkId == c.checkId }
                    .maxByOrNull { it.answeredAt }
                    ?.let { if (it != answer) answer = it }
            } catch (e: UnauthorizedException) {
                return backToPairing()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.d(TAG, "answers poll failed: $e")
            }
            delay(POLL_INTERVAL_MS)
        }
    }

    private fun sinceFor(c: StoredCheck): String {
        val received = runCatching { Instant.parse(c.receivedAt) }.getOrDefault(Instant.now())
        // Answers are filtered by checkId, so a generous window is harmless and survives clock skew.
        return received.minus(1, ChronoUnit.DAYS).truncatedTo(ChronoUnit.SECONDS).toString()
    }

    private fun backToPairing() {
        Log.w(TAG, "Token revoked (401); returning to pairing")
        session.clear()
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        finish()
    }

    // --- Read aloud ----------------------------------------------------------------------

    override fun onInit(status: Int) {
        ttsReady = status == TextToSpeech.SUCCESS
        if (!ttsReady) {
            if (speakWhenReady) ttsMessage = localized().getString(R.string.tts_unavailable)
            return
        }
        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = Unit
            override fun onDone(utteranceId: String?) = runOnUiThread { speaking = false }
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) = runOnUiThread { speaking = false }
        })
        if (speakWhenReady) speak()
    }

    private fun toggleReadAloud() {
        if (speaking) return stopSpeaking()
        if (!ttsReady) {
            speakWhenReady = true
            return
        }
        speak()
    }

    private fun stopSpeaking() {
        tts?.stop()
        speaking = false
    }

    private fun speak() {
        speakWhenReady = false
        val c = check ?: return
        val engine = tts ?: return
        val res = localized()
        val locale = if (c.verdict.language == "fr") Locale.FRANCE else Locale.US
        val lang = engine.setLanguage(locale)
        if (lang == TextToSpeech.LANG_MISSING_DATA || lang == TextToSpeech.LANG_NOT_SUPPORTED) {
            ttsMessage = res.getString(R.string.tts_unavailable)
            return
        }
        engine.setSpeechRate(0.9f)
        val text = buildString {
            answer?.let { append(answerSentence(res, it)).append(". ") }
            append(c.verdict.headline).append(". ")
            c.verdict.reasons.take(3).forEach { append(it.text).append(". ") }
            append(c.verdict.actionText).append(". ")
            c.verdict.realCompanySays?.let { append(res.getString(R.string.real_company_says)).append(' ').append(it) }
        }
        ttsMessage = null
        speaking = engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "verdict") == TextToSpeech.SUCCESS
    }

    private fun answerSentence(res: Context, a: GuardianAnswer): String = when (a.answer) {
        "scam" -> res.getString(R.string.answer_scam, a.guardianName)
        "real" -> res.getString(R.string.answer_real, a.guardianName)
        else -> res.getString(R.string.answer_call_me, a.guardianName)
    }

    companion object {
        const val EXTRA_CHECK_ID = "checkId"
        private const val TAG = "ScamShieldVerdict"
        private const val POLL_INTERVAL_MS = 10_000L

        fun intent(context: Context, checkId: String): Intent =
            Intent(context, VerdictActivity::class.java).putExtra(EXTRA_CHECK_ID, checkId)
    }
}
