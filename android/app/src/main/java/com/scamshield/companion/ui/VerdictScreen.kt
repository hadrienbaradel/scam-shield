package com.scamshield.companion.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.scamshield.companion.R
import com.scamshield.companion.net.GuardianAnswer
import com.scamshield.companion.net.StoredCheck

sealed interface AskState {
    data object Idle : AskState
    data object Sending : AskState
    data class Sent(val names: List<String>) : AskState
    data object Failed : AskState
}

private data class VerdictColors(val background: Color, val content: Color, val labelRes: Int)

private fun colorsFor(verdict: String) = when (verdict) {
    "scam" -> VerdictColors(Palette.scam, Palette.paper, R.string.label_scam)
    "safe" -> VerdictColors(Palette.safe, Palette.paper, R.string.label_safe)
    else -> VerdictColors(Palette.careful, Palette.ink, R.string.label_careful)
}

@Composable
fun guardianAnswerText(answer: GuardianAnswer): String = when (answer.answer) {
    "scam" -> stringResource(R.string.answer_scam, answer.guardianName)
    "real" -> stringResource(R.string.answer_real, answer.guardianName)
    else -> stringResource(R.string.answer_call_me, answer.guardianName)
}

@Composable
fun joinNames(names: List<String>): String {
    val and = stringResource(R.string.names_and)
    return when (names.size) {
        0 -> ""
        1 -> names[0]
        else -> names.dropLast(1).joinToString(", ") + " $and " + names.last()
    }
}

@Composable
fun VerdictScreen(
    check: StoredCheck,
    answer: GuardianAnswer?,
    askState: AskState,
    speaking: Boolean,
    ttsMessage: String?,
    onRead: () -> Unit,
    onAsk: () -> Unit,
    onOk: () -> Unit,
) {
    val v = check.verdict
    val c = colorsFor(v.verdict)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(c.background)
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(Sizes.gutter),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        // The guardian's answer is the decision that matters most once it arrives.
        if (answer != null) {
            Surface(color = Palette.paper, shape = RoundedCornerShape(20.dp), border = BorderStroke(4.dp, Palette.ink), modifier = Modifier.fillMaxWidth()) {
                Text(
                    guardianAnswerText(answer),
                    fontSize = Sizes.headline,
                    fontWeight = FontWeight.Bold,
                    color = Palette.ink,
                    modifier = Modifier.padding(Sizes.gutter),
                )
            }
        }

        Text(stringResource(c.labelRes), fontSize = Sizes.body, fontWeight = FontWeight.Black, color = c.content)
        Text(
            v.headline,
            fontSize = Sizes.headline,
            lineHeight = Sizes.headline * 1.2f,
            fontWeight = FontWeight.Bold,
            color = c.content,
            modifier = Modifier.semantics { heading() },
        )

        v.reasons.take(3).forEach { reason ->
            Text("•  " + reason.text, fontSize = Sizes.body, lineHeight = Sizes.body * 1.3f, color = c.content)
        }

        if (v.actionText.isNotBlank()) {
            Surface(color = Palette.paper, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
                Text(v.actionText, fontSize = Sizes.body, fontWeight = FontWeight.Bold, color = Palette.ink, modifier = Modifier.padding(16.dp))
            }
        }

        v.realCompanySays?.let { said ->
            Text(stringResource(R.string.real_company_says), fontSize = Sizes.body, fontWeight = FontWeight.Bold, color = c.content)
            Text(said, fontSize = Sizes.body, color = c.content)
        }

        BigButton(
            text = stringResource(if (speaking) R.string.btn_stop_reading else R.string.btn_read),
            onClick = onRead,
            container = Palette.paper,
            content = Palette.ink,
        )
        ttsMessage?.let { Text(it, fontSize = Sizes.small, color = c.content) }

        if (!check.local) {
            when (askState) {
                AskState.Idle, AskState.Failed -> BigButton(stringResource(R.string.btn_ask), onAsk, container = Palette.paper, content = Palette.ink)
                AskState.Sending -> BigButton(stringResource(R.string.ask_sending), {}, container = Palette.paper, content = Palette.ink, enabled = false)
                is AskState.Sent -> Surface(color = Palette.paper, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            if (askState.names.isEmpty()) stringResource(R.string.ask_none)
                            else stringResource(R.string.ask_sent, joinNames(askState.names)),
                            fontSize = Sizes.title,
                            fontWeight = FontWeight.Bold,
                            color = Palette.ink,
                        )
                        if (askState.names.isNotEmpty() && answer == null) {
                            Text(stringResource(R.string.ask_waiting), fontSize = Sizes.body, color = Palette.ink)
                        }
                    }
                }
            }
            if (askState == AskState.Failed) {
                Text(stringResource(R.string.ask_error), fontSize = Sizes.body, fontWeight = FontWeight.Bold, color = c.content)
            }
        }

        BigOutlinedButton(stringResource(R.string.btn_ok), onOk, color = c.content)

        // Which text this is about, kept small and last.
        if (check.from.isNotBlank()) {
            Text(stringResource(R.string.verdict_from, check.from), fontSize = Sizes.small, fontWeight = FontWeight.Bold, color = c.content)
        }
        check.body?.let {
            Text(it, fontSize = Sizes.small, color = c.content, maxLines = 6, overflow = TextOverflow.Ellipsis)
        }
    }
}
