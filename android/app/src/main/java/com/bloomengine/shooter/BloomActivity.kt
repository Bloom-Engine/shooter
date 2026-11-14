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

        surfaceView.holder.addCallback(object : SurfaceHolder.Callback {
            override fun surfaceCreated(holder: SurfaceHolder) {
                surfaceReady = true
                // Pass Surface to engine — it extracts ANativeWindow internally.
                BloomGameBridge.nativeSetSurface(holder.surface)

                // Spawn the game thread.
                nativeThread = Thread {
                    BloomGameBridge.nativeMain()
                }.apply {
                    name = "bloom-game"
                    isDaemon = true
                    start()
                }
            }

            override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
                // Engine handles resize via getScreenWidth/Height.
            }

            override fun surfaceDestroyed(holder: SurfaceHolder) {
                surfaceReady = false
                BloomGameBridge.nativeOnDestroy()
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
            else -> return
        }
        if (action == 2) {
            for (i in 0 until event.pointerCount) {
                BloomGameBridge.nativeOnTouch(action, event.getX(i).toDouble(), event.getY(i).toDouble(), i)
            }
        } else {
            BloomGameBridge.nativeOnTouch(
                action, event.getX(pointerIndex).toDouble(), event.getY(pointerIndex).toDouble(), pointerIndex
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
    private fun extractAssets() {
        val targetBase = filesDir.absolutePath
        extractAssetsRecursive("assets", targetBase)
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
