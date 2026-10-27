package com.scamshield.companion

import android.app.Application
import com.scamshield.companion.notify.Notifier

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifier.ensureChannels(this)
    }
}
