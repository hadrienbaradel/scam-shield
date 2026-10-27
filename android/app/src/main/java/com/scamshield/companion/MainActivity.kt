package com.scamshield.companion

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.scamshield.companion.data.CheckStore
import com.scamshield.companion.data.Session
import com.scamshield.companion.net.ApiClient
import com.scamshield.companion.net.ApiException
import com.scamshield.companion.net.PairingPayload
import com.scamshield.companion.ui.HomeScreen
import com.scamshield.companion.ui.PairingScreen
import com.scamshield.companion.ui.PairingUiState
import com.scamshield.companion.ui.ScamShieldTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {

    private lateinit var session: Session
    private lateinit var store: CheckStore

    private var paired by mutableStateOf(false)
    private var userName by mutableStateOf<String?>(null)
    private var pairing by mutableStateOf(PairingUiState())
    private var permissionsGranted by mutableStateOf(false)
    private var askedOnce by mutableStateOf(false)
    private var hasLastCheck by mutableStateOf(false)

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            askedOnce = true
            refresh()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        session = Session(this)
        store = CheckStore(this)
        refresh()

        setContent {
            ScamShieldTheme {
                if (paired) {
                    HomeScreen(
                        userName = userName,
                        permissionsGranted = permissionsGranted,
                        askedOnce = askedOnce,
                        hasLastCheck = hasLastCheck,
                        onGrant = ::requestPermissions,
                        onOpenSettings = ::openAppSettings,
                        onOpenLast = ::openLastCheck,
                        onUnpair = ::unpair,
                    )
                } else {
                    PairingScreen(
                        initialServer = session.server ?: DEFAULT_SERVER,
                        state = pairing,
                        onPair = ::pair,
                        onQrScanned = ::onQrScanned,
                    )
                }
            }
        }
        handleDebugAutoPair(intent)
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleDebugAutoPair(intent)
    }

    private fun refresh() {
        paired = session.isPaired
        userName = session.userName
        permissionsGranted = requiredPermissions().all {
            ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
        }
        hasLastCheck = store.latest() != null
    }

    private fun requiredPermissions(): List<String> = buildList {
        add(Manifest.permission.RECEIVE_SMS)
        if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
    }

    private fun requestPermissions() = permissionLauncher.launch(requiredPermissions().toTypedArray())

    private fun pair(serverInput: String, codeInput: String) {
        // A pasted QR payload in the code field works too.
        val payload = PairingPayload.parse(codeInput)
        val server = payload?.server ?: PairingPayload.normalizeServer(serverInput)
        val code = payload?.code ?: PairingPayload.normalizeCode(codeInput)
        if (code.isEmpty()) {
            pairing = PairingUiState(errorRes = R.string.pair_error_empty)
            return
        }
        pairing = PairingUiState(busy = true)
        lifecycleScope.launch {
            pairing = try {
                val result = withContext(Dispatchers.IO) { ApiClient(server).pair(code, deviceName()) }
                session.save(server, result.token, result.userName, result.locale)
                Log.i(TAG, "Paired with $server")
                refresh()
                if (!permissionsGranted) requestPermissions()
                PairingUiState()
            } catch (e: ApiException) {
                Log.w(TAG, "Pairing rejected: ${e.message}")
                PairingUiState(
                    errorRes = if (e.status in 400..499) R.string.pair_error_code else R.string.pair_error_network,
                    serverDetail = e.serverMessage,
                )
            } catch (e: Exception) {
                Log.w(TAG, "Pairing failed: $e")
                PairingUiState(errorRes = R.string.pair_error_network)
            }
        }
    }

    private fun onQrScanned(raw: String?) {
        val payload = PairingPayload.parse(raw)
        if (payload == null) {
            pairing = PairingUiState(errorRes = R.string.pair_error_qr)
            return
        }
        pair(payload.server, payload.code)
    }

    private fun openLastCheck() {
        store.latest()?.let { startActivity(VerdictActivity.intent(this, it.checkId)) }
    }

    private fun openAppSettings() {
        startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
    }

    private fun unpair() {
        session.clear()
        store.clear()
        refresh()
    }

    /**
     * Debug-only test hook (compiled out of release logic via BuildConfig.DEBUG):
     *   adb shell am start -n com.scamshield.companion/.MainActivity \
     *     --es debug_server http://10.0.2.2:3000 --es debug_code TEST1234
     */
    private fun handleDebugAutoPair(intent: Intent?) {
        if (!BuildConfig.DEBUG || intent == null) return
        val server = intent.getStringExtra(EXTRA_DEBUG_SERVER) ?: return
        val code = intent.getStringExtra(EXTRA_DEBUG_CODE) ?: return
        intent.removeExtra(EXTRA_DEBUG_SERVER)
        intent.removeExtra(EXTRA_DEBUG_CODE)
        Log.i(TAG, "Debug auto-pair requested")
        pair(server, code)
    }

    private fun deviceName(): String {
        val maker = Build.MANUFACTURER.orEmpty().replaceFirstChar { it.uppercase() }
        val model = Build.MODEL.orEmpty()
        return if (model.startsWith(maker, ignoreCase = true)) model else "$maker $model".trim()
    }

    companion object {
        private const val TAG = "ScamShield"
        const val DEFAULT_SERVER = "http://10.0.2.2:3000"
        const val EXTRA_DEBUG_SERVER = "debug_server"
        const val EXTRA_DEBUG_CODE = "debug_code"
    }
}
