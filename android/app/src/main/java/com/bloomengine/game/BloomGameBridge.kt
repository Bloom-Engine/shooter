package com.bloomengine.game

import android.view.Surface

/**
 * JNI bridge between the Android Activity and the Bloom Engine native library.
 * Any Bloom Engine game on Android should use this bridge class.
 *
 * The native implementations live in bloom-android (engine/native/android/src/lib.rs).
 */
object BloomGameBridge {
    /** Pass the rendering Surface to the engine (extracts ANativeWindow internally). */
    @JvmStatic external fun nativeSetSurface(surface: Surface)

    /** Run the compiled game's main() function. Call on a background thread. */
    @JvmStatic external fun nativeMain()

    /** Forward a touch event to the engine's input system. */
    @JvmStatic external fun nativeOnTouch(action: Int, x: Double, y: Double, pointerIndex: Int)

    /** Signal the engine to close (sets windowShouldClose = true). */
    /** The surface is going away (background, or finishing): the game thread lets go of it and
     *  waits; a later nativeSetSurface resumes it. From SurfaceHolder.Callback.surfaceDestroyed. */
    @JvmStatic external fun nativeSurfaceLost()

    /** Whether the GPU is in the engine's low tier (SH-069); callable before any surface. */
    @JvmStatic external fun nativeIsLowTier(): Boolean

    @JvmStatic external fun nativeOnDestroy()
}
