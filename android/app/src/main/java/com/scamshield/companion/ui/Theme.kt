package com.scamshield.companion.ui

import android.content.Context
import android.content.res.Configuration
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.Locale

// Senior-first sizes: headline >= 28sp, body >= 20sp, buttons >= 64dp.
object Sizes {
    val headline = 32.sp
    val title = 28.sp
    val body = 22.sp
    val small = 20.sp
    val button = 22.sp
    val buttonHeight = 72.dp
    val gutter = 20.dp
}

object Palette {
    val blue = Color(0xFF0D47A1)
    val scam = Color(0xFFB71C1C)
    val careful = Color(0xFFFFB300)
    val safe = Color(0xFF1B5E20)
    val ink = Color(0xFF000000)
    val paper = Color(0xFFFFFFFF)
    val errorText = Color(0xFFB71C1C)
}

@Composable
fun ScamShieldTheme(content: @Composable () -> Unit) {
    // Material's default line heights are fixed sp values sized for 14-16sp text; with
    // 22-32sp text they make lines overlap. Unspecified = the font's natural spacing,
    // which scales with size. (Not em: Material lerps these styles against sp ones in
    // the text-field label animation, and Em/Sp arithmetic throws.)
    val base = Typography()
    val roomy = TextUnit.Unspecified
    MaterialTheme(
        typography = base.copy(
            bodyLarge = base.bodyLarge.copy(lineHeight = roomy),
            bodyMedium = base.bodyMedium.copy(lineHeight = roomy),
            labelLarge = base.labelLarge.copy(lineHeight = roomy),
        ),
        colorScheme = lightColorScheme(
            primary = Palette.blue,
            onPrimary = Palette.paper,
            background = Palette.paper,
            onBackground = Palette.ink,
            surface = Palette.paper,
            onSurface = Palette.ink,
            error = Palette.errorText,
        ),
        content = content,
    )
}

@Composable
fun BigButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    container: Color = Palette.blue,
    content: Color = Palette.paper,
    enabled: Boolean = true,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.fillMaxWidth().heightIn(min = Sizes.buttonHeight),
        shape = RoundedCornerShape(16.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = container,
            contentColor = content,
            disabledContainerColor = container.copy(alpha = 0.6f),
            disabledContentColor = content,
        ),
    ) {
        Text(text, fontSize = Sizes.button, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, modifier = Modifier.padding(vertical = 8.dp))
    }
}

@Composable
fun BigOutlinedButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    color: Color = Palette.blue,
    enabled: Boolean = true,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.fillMaxWidth().heightIn(min = Sizes.buttonHeight),
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(3.dp, color),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = color),
    ) {
        Text(text, fontSize = Sizes.button, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, modifier = Modifier.padding(vertical = 8.dp))
    }
}

/** Resolve string resources in [language] ("fr" or else English) regardless of the phone locale. */
fun Context.inLanguage(language: String): Context {
    val config = Configuration(resources.configuration)
    config.setLocale(if (language == "fr") Locale.FRENCH else Locale.US)
    return createConfigurationContext(config)
}

@Composable
fun InLanguage(language: String, content: @Composable () -> Unit) {
    val base = LocalContext.current
    val localized = remember(base, language) { base.inLanguage(language) }
    CompositionLocalProvider(LocalContext provides localized, content = content)
}
