package com.bloomengine.shooter

import android.app.Activity
import android.os.Bundle
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.WindowManager
import com.bloomengine.game.BloomGameBridge

/**
 * Game Activity for Bloom Shooter.
 *
 * Uses a SurfaceView for Vulkan rendering via wgpu. The game loop runs on a
 * native thread; touch events are forwarded to the engine via BloomGameBridge,
 * which the shooter's input.ts reads through the engine touch FFI (isMobile()
 * is true on Android, so the mobile render profile + on-screen sticks light up
 * automatically — no game-side changes needed).
 *
 * Lifecycle:
 * 1. onCreate: extract assets, set BLOOM_ASSET_PATH, load native lib, SurfaceView
 * 2. surfaceCreated: hand the Surface to the engine, spawn the game thread
 * 3. Game thread runs the compiled TypeScript main() with the game loop
 * 4. surfaceDestroyed / onDestroy: signal the game to close
 */
class BloomActivity : Activity() {

    private lateinit var surfaceView: SurfaceView
    private var nativeThread: Thread? = null
    private var surfaceReady = false
    /** The surface is this fraction of the screen; the display hardware scales it up. */
    private var surfaceScale = 1.0f
    // The fixed surface size and view pixels -> surface pixels, per axis (onCreate).
    private var fixedW = 0
    private var fixedH = 0
    private var touchKx = 1.0
    private var touchKy = 1.0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Fullscreen immersive, keep the screen awake during play.
        @Suppress("DEPRECATION")
        window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Extract game assets from the APK to internal storage.
        extractAssets()

        // Set the asset base path via env var BEFORE loading the native library.
        // The engine's JNI_OnLoad reads BLOOM_ASSET_PATH to resolve relative
        // asset paths like "assets/models/tree.glb".
        val filesDir = getFilesDir().absolutePath
        android.system.Os.setenv("BLOOM_ASSET_PATH", filesDir, true)

        // Load the native library (compiled game + bloom engine).
        System.loadLibrary("bloom_shooter")

        surfaceView = SurfaceView(this)
        surfaceView.isFocusable = true
        surfaceView.isFocusableInTouchMode = true
        surfaceView.setOnTouchListener { _, event ->
            if (!surfaceReady) return@setOnTouchListener false
            forwardTouch(event)
            true
        }
        setContentView(surfaceView)

        // Low tier (SH-069): render into a smaller surface and let the display hardware scale
        // it to the screen, as mobile games do. Every full-screen pass after the 3D scene
        // (upscale, final composite, the 2D overlay) then runs on a fraction of the pixels; on a
        // Pixel 4a they cost ~10 ms a frame at the panel's 2340 x 1080. Touch coordinates are
        // scaled to match in forwardTouch. `--surface-scale 0.5|0.6|0.75|1` in
        // files/launch-args.txt tries another value.
        // Only on a low-tier GPU (the engine decides: BloomGameBridge.nativeIsLowTier); every
        // other phone renders at the screen's own size.
        surfaceScale = launchArg("--surface-scale")?.toFloatOrNull()?.coerceIn(0.4f, 1.0f)
            ?: if (BloomGameBridge.nativeIsLowTier()) 0.6f else 1.0f
        if (surfaceScale < 0.999f) {
            // Sized from the VIEW, once it is laid out, never from the display: on a phone with
            // a camera cutout the view is narrower than the panel (2204 of 2340 px on a Pixel
            // 4a), and a surface of the panel's shape was squeezed into it, which also put
            // every touch up to ~60 px left of what was drawn under it.
            surfaceView.addOnLayoutChangeListener { _, l, t, r, b, _, _, _, _ ->
                val vw = r - l
                val vh = b - t
                if (vw > 0 && vh > 0) {
                    val fw = (vw * surfaceScale).toInt()
                    val fh = (vh * surfaceScale).toInt()
                    if (fw != fixedW || fh != fixedH) {
                        fixedW = fw
                        fixedH = fh
                        touchKx = fw.toDouble() / vw
                        touchKy = fh.toDouble() / vh
                        surfaceView.holder.setFixedSize(fw, fh)
                    }
                }
            }
        }

        surfaceView.holder.addCallback(object : SurfaceHolder.Callback {
            override fun surfaceCreated(holder: SurfaceHolder) {
                surfaceReady = true
                // Pass Surface to engine — it extracts ANativeWindow internally.
                BloomGameBridge.nativeSetSurface(holder.surface)

                // Spawn the game thread once. A surface created again (back from the
                // background) resumes the thread that is already running on it.
                if (nativeThread == null) {
                    nativeThread = Thread {
                        BloomGameBridge.nativeMain()
                    }.apply {
                        name = "bloom-game"
                        isDaemon = true
                        start()
                    }
                }
            }

            override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
                // Engine handles resize via getScreenWidth/Height.
            }

            override fun surfaceDestroyed(holder: SurfaceHolder) {
                surfaceReady = false
                // Not nativeOnDestroy: losing the surface (home button, app switcher) is not the
                // end of the game. With nativeOnDestroy here the game loop kept drawing into no
                // surface and panicked every frame ("headless renderer always owns a
                // headless_target").
                BloomGameBridge.nativeSurfaceLost()
            }
        })
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (!surfaceReady) return super.onTouchEvent(event)
        forwardTouch(event)
        return true
    }

    /** Forward a MotionEvent to the engine's touch system (action: 0=down 1=up 2=move). */
    private fun forwardTouch(event: MotionEvent) {
        val pointerIndex = event.actionIndex
        val action = when (event.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> 0
            MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP -> 1
            MotionEvent.ACTION_MOVE -> 2
            MotionEvent.ACTION_CANCEL -> 3
            else -> return
        }
        // View pixels -> surface pixels (the surface may be smaller than the view: onCreate).
        val kx = touchKx
        val ky = touchKy
        // The engine's touch slot is the pointer ID, never the pointer index: an index shifts
        // when another finger lifts (thumb on the stick lifts, the FIRE finger becomes index
        // 0), so the release went to the wrong slot, a slot stayed "down" for good, and the
        // game read the next tap on FIRE as a camera drag of that stale finger.
        if (action == 2) {
            for (i in 0 until event.pointerCount) {
                BloomGameBridge.nativeOnTouch(
                    action, event.getX(i) * kx, event.getY(i) * ky, event.getPointerId(i)
                )
            }
        } else {
            BloomGameBridge.nativeOnTouch(
                action, event.getX(pointerIndex) * kx, event.getY(pointerIndex) * ky,
                event.getPointerId(pointerIndex)
            )
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        BloomGameBridge.nativeOnDestroy()
    }

    /**
     * Extract the game's assets/ tree from the APK to internal storage. Files
     * land under filesDir/assets/ to match the relative paths in the game code
     * (e.g. "assets/worlds/arena_02.world.json").
     */
    /** The value after `name` in filesDir/launch-args.txt (the game reads the same file). */
    private fun launchArg(name: String): String? {
        val f = java.io.File(filesDir, "launch-args.txt")
        if (!f.exists()) return null
        val parts = f.readText().trim().split(Regex("\\s+"))
        val i = parts.indexOf(name)
        return if (i >= 0 && i + 1 < parts.size) parts[i + 1] else null
    }

    private fun extractAssets() {
        val targetBase = filesDir.absolutePath
        // A file that already exists is skipped below, and `adb install -r` or a store update
        // keeps filesDir: without this stamp an updated APK ran on the FIRST install's assets
        // (2026-11-15: 4K models from an older build got the game killed for memory on a Pixel 4a).
        // A new APK (lastUpdateTime changes on every install) wipes the tree and extracts afresh;
        // that also removes files a newer build no longer ships. Saves outside assets/ are kept.
        val stamp = java.io.File(targetBase, "assets.stamp")
        @Suppress("DEPRECATION")
        val installed = packageManager.getPackageInfo(packageName, 0).lastUpdateTime.toString()
        val current = if (stamp.exists()) stamp.readText() else ""
        if (current != installed) {
            java.io.File(targetBase, "assets").deleteRecursively()
            extractAssetsRecursive("assets", targetBase)
            stamp.writeText(installed)
            android.util.Log.d("BloomExtract", "assets extracted for install $installed")
        } else {
            extractAssetsRecursive("assets", targetBase)
        }
    }

    private fun extractAssetsRecursive(assetPath: String, targetBase: String) {
        val assetManager = assets
        val entries = assetManager.list(assetPath) ?: return

        if (entries.isEmpty()) {
            val targetFile = java.io.File("$targetBase/$assetPath")
            if (targetFile.exists() && targetFile.length() > 0) return // already extracted
            targetFile.parentFile?.mkdirs()
            try {
                val inputStream = java.io.BufferedInputStream(assetManager.open(assetPath))
                val outputStream = java.io.BufferedOutputStream(java.io.FileOutputStream(targetFile))
                val buf = ByteArray(65536)
                var bytesRead = inputStream.read(buf)
                var total = 0
                while (bytesRead > 0) {
                    outputStream.write(buf, 0, bytesRead)
                    total += bytesRead
                    bytesRead = inputStream.read(buf)
                }
                outputStream.flush()
                outputStream.close()
                inputStream.close()
                android.util.Log.d("BloomExtract", "$assetPath -> $total bytes")
            } catch (e: Exception) {
                android.util.Log.e("BloomExtract", "FAIL $assetPath: ${e.message}")
            }
        } else {
            for (entry in entries) {
                extractAssetsRecursive("$assetPath/$entry", targetBase)
            }
        }
    }
}
