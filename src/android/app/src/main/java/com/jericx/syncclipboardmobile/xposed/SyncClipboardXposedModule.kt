package com.jericx.syncclipboardmobile.xposed

import android.util.Log
import io.github.libxposed.api.XposedModule
import io.github.libxposed.api.XposedModuleInterface.ModuleLoadedParam
import io.github.libxposed.api.XposedModuleInterface.SystemServerStartingParam

/** Optional modern libxposed entry point. Clipboard hooks are added in later commits. */
class SyncClipboardXposedModule : XposedModule() {
    override fun onModuleLoaded(param: ModuleLoadedParam) {
        log(Log.INFO, TAG, "Module loaded in ${param.processName}; no hooks installed")
    }

    override fun onSystemServerStarting(param: SystemServerStartingParam) {
        log(Log.INFO, TAG, "system_server ready; no clipboard hooks installed")
    }

    private companion object {
        const val TAG = "SyncClipboardXposed"
    }
}
