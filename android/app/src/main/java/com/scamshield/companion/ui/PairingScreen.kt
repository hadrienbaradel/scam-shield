package com.scamshield.companion.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import com.scamshield.companion.R

data class PairingUiState(
    val busy: Boolean = false,
    /** String resource id of the error, or null. */
    val errorRes: Int? = null,
    val serverDetail: String? = null,
)

@Composable
fun PairingScreen(
    initialServer: String,
    state: PairingUiState,
    onPair: (server: String, code: String) -> Unit,
    onQrScanned: (raw: String?) -> Unit,
) {
    var server by rememberSaveable { mutableStateOf(initialServer) }
    var code by rememberSaveable { mutableStateOf("") }
    val scanPrompt = stringResource(R.string.pair_scan_prompt)
    val scanLauncher = rememberLauncherForActivityResult(ScanContract()) { result ->
        if (result.contents != null) onQrScanned(result.contents)
    }

    val fieldText = TextStyle(fontSize = Sizes.body)
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Palette.paper)
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(Sizes.gutter),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Text(stringResource(R.string.pair_title), fontSize = Sizes.headline, fontWeight = FontWeight.Bold, color = Palette.ink)
        Text(stringResource(R.string.pair_intro), fontSize = Sizes.body, color = Palette.ink)

        OutlinedTextField(
            value = code,
            onValueChange = { code = it },
            label = { Text(stringResource(R.string.pair_code_label), fontSize = Sizes.small) },
            textStyle = TextStyle(fontSize = Sizes.title, fontWeight = FontWeight.Bold),
            singleLine = true,
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.Characters,
                keyboardType = KeyboardType.Ascii,
                autoCorrectEnabled = false,
                imeAction = ImeAction.Go,
            ),
            keyboardActions = KeyboardActions(onGo = { if (!state.busy) onPair(server, code) }),
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = "pairing-code" },
        )

        OutlinedTextField(
            value = server,
            onValueChange = { server = it },
            label = { Text(stringResource(R.string.pair_server_label), fontSize = Sizes.small) },
            textStyle = fieldText,
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false, imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = "server-url" },
        )

        state.errorRes?.let {
            Text(stringResource(it), fontSize = Sizes.body, fontWeight = FontWeight.Bold, color = Palette.errorText)
        }
        state.serverDetail?.let { Text(it, fontSize = Sizes.small, color = Palette.ink) }

        BigButton(
            text = stringResource(if (state.busy) R.string.pair_busy else R.string.pair_button),
            onClick = { onPair(server, code) },
            enabled = !state.busy,
        )
        BigOutlinedButton(
            text = stringResource(R.string.pair_scan),
            onClick = {
                scanLauncher.launch(
                    ScanOptions()
                        .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                        .setPrompt(scanPrompt)
                        .setBeepEnabled(false)
                        .setOrientationLocked(false)
                )
            },
            enabled = !state.busy,
        )
    }
}
