package com.jericx.syncclipboardmobile.quicksettings

import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.util.Log

/**
 * Quick Settings Tile for Download functionality
 */
class DownloadTileService : TileService() {
    
    companion object {
        private const val TAG = "DownloadTileService"
    }

    override fun onStartListening() {
        super.onStartListening()
        Log.d(TAG, "Tile started listening")
        
        // Initialize tile state
        qsTile?.apply {
            state = Tile.STATE_INACTIVE
            updateTile()
        }
    }

    override fun onStopListening() {
        super.onStopListening()
        Log.d(TAG, "Tile stopped listening")
    }

    override fun onClick() {
        super.onClick()
        Log.d(TAG, "Quick Settings Tile clicked - Download action triggered")
        
        // Update tile state to active
        qsTile?.apply {
            state = Tile.STATE_ACTIVE
            updateTile()
        }
        
        // Open the main app
        try {
            val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
            if (launchIntent != null) {
                launchIntent.apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    
                    // Add extra to indicate it was launched from tile
                    putExtra("launched_from", "quick_settings_tile")
                    putExtra("tile_action", "download")
                }
                
                startActivity(launchIntent)
                Log.d(TAG, "App launched successfully from Quick Settings Tile")
            } else {
                Log.e(TAG, "Could not get launch intent for package")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error launching app from tile", e)
        }
        
        // Reset tile state after a short delay
        Handler(Looper.getMainLooper()).postDelayed({
            qsTile?.apply {
                state = Tile.STATE_INACTIVE
                updateTile()
            }
        }, 1000)
    }

    override fun onTileAdded() {
        super.onTileAdded()
        Log.d(TAG, "Tile added to Quick Settings")
    }

    override fun onTileRemoved() {
        super.onTileRemoved()
        Log.d(TAG, "Tile removed from Quick Settings")
    }
}
