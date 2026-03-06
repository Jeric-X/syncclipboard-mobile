package com.jericx.syncclipboardmobile.shortcut

import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import androidx.core.content.res.ResourcesCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class ShortcutModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "ShortcutModule"

    /**
     * Request a pinned shortcut on the home screen.
     *
     * @param shortcutId  Unique id for the shortcut (deduplication key)
     * @param label       Short label shown under the icon
     * @param url         Deep-link URL to launch when the shortcut is tapped
     * @param iconResName Drawable resource name (without extension, e.g. "ic_tile_download")
     * @param bgColorHex  Hex color string for the icon background (e.g. "#1976D2")
     */
    @ReactMethod
    fun requestPinShortcut(
        shortcutId: String,
        label: String,
        url: String,
        iconResName: String,
        bgColorHex: String,
        promise: Promise
    ) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                promise.reject("UNSUPPORTED", "Pinned shortcuts require Android 8.0 (API 26) or higher")
                return
            }

            val shortcutManager =
                reactApplicationContext.getSystemService(ShortcutManager::class.java)

            if (shortcutManager == null || !shortcutManager.isRequestPinShortcutSupported) {
                promise.reject("UNSUPPORTED", "The current launcher does not support pinned shortcuts")
                return
            }

            // Build the intent that will be fired when the shortcut is tapped
            val launchIntent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                setPackage(reactApplicationContext.packageName)
                // Flags mirror the Quick Settings Tile behaviour
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
                addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            }

            val icon = buildIcon(iconResName, bgColorHex)

            val shortcutInfo = ShortcutInfo.Builder(reactApplicationContext, shortcutId)
                .setShortLabel(label)
                .setLongLabel(label)
                .setIcon(icon)
                .setIntent(launchIntent)
                .build()

            shortcutManager.requestPinShortcut(shortcutInfo, null)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message ?: "Unknown error", e)
        }
    }

    /**
     * Draws a circular background filled with [bgColorHex] and overlays the
     * named drawable (tinted white) at 60 % of the bitmap size.
     *
     * Using a Bitmap avoids launcher-specific layer-list / adaptive-icon
     * rendering issues that cause plain vector icons to appear white-on-white.
     */
    private fun buildIcon(iconResName: String, bgColorHex: String): Icon {
        val density = reactApplicationContext.resources.displayMetrics.density
        // Adaptive icon spec: 108 dp total, 72 dp safe zone (18 dp bleed on each side)
        val size = (108 * density + 0.5f).toInt()

        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)

        // 1) Colored circle background filling the full adaptive canvas
        val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = try {
                Color.parseColor(bgColorHex)
            } catch (_: IllegalArgumentException) {
                Color.parseColor("#007AFF")
            }
        }
        val radius = size / 2f
        canvas.drawCircle(radius, radius, radius, bgPaint)

        // 2) Foreground icon (white), confined to the 72 dp safe zone
        //    Safe zone starts at 18/108 ≈ 16.67 % from each edge; add extra
        //    padding so the icon doesn't touch the safe-zone boundary.
        val iconResId = reactApplicationContext.resources.getIdentifier(
            iconResName, "drawable", reactApplicationContext.packageName
        )
        if (iconResId != 0) {
            val drawable = ResourcesCompat.getDrawable(
                reactApplicationContext.resources, iconResId, null
            )
            drawable?.let {
                // 33 % total pad keeps the icon well within the 72 dp safe zone
                val pad = (size * 0.33f).toInt()
                it.setBounds(pad, pad, size - pad, size - pad)
                it.setTint(Color.WHITE)
                it.draw(canvas)
            }
        }

        return Icon.createWithAdaptiveBitmap(bitmap)
    }
}

