package com.scamshield.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.scamshield.companion.R

@Composable
fun HomeScreen(
    userName: String?,
    permissionsGranted: Boolean,
    askedOnce: Boolean,
    hasLastCheck: Boolean,
    onGrant: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenLast: () -> Unit,
    onUnpair: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Palette.paper)
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(Sizes.gutter),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Surface(color = if (permissionsGranted) Palette.safe else Palette.careful, shape = RoundedCornerShape(20.dp), modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(Sizes.gutter)) {
                val title = if (userName.isNullOrBlank()) stringResource(R.string.home_protected_noname)
                else stringResource(R.string.home_protected, userName)
                Text(
                    text = if (permissionsGranted) title else stringResource(R.string.home_perm_needed),
                    fontSize = if (permissionsGranted) Sizes.headline else Sizes.title,
                    fontWeight = FontWeight.Bold,
                    color = if (permissionsGranted) Palette.paper else Palette.ink,
                )
            }
        }

        if (!permissionsGranted) {
            BigButton(stringResource(R.string.home_perm_button), onGrant)
            if (askedOnce) {
                Text(stringResource(R.string.home_perm_settings_hint), fontSize = Sizes.body, color = Palette.ink)
                BigOutlinedButton(stringResource(R.string.home_open_settings), onOpenSettings)
            }
        }

        Text(stringResource(R.string.home_explain), fontSize = Sizes.body, color = Palette.ink)

        if (hasLastCheck) BigButton(stringResource(R.string.home_last_warning), onOpenLast)

        Spacer(Modifier.height(24.dp))
        BigOutlinedButton(stringResource(R.string.home_unpair), onUnpair, color = Palette.ink)
    }
}
