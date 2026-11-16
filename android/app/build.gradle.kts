plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.bloomengine.shooter"
    // Google Play: new apps and updates must target API 36 (Android 16) since 2026-08-31.
    compileSdk = 36

    defaultConfig {
        applicationId = "com.bloomengine.shooter"
        minSdk = 24
        targetSdk = 36
        // Play needs a higher versionCode for every upload: build-android.sh passes
        // -PversionCode / -PversionName (see docs/RELEASE.md, Google Play).
        versionCode = (project.findProperty("versionCode") as String?)?.toInt() ?: 1
        versionName = (project.findProperty("versionName") as String?) ?: "1.0.0"

        ndk {
            abiFilters += "arm64-v8a"
        }
    }

    // The Play upload key lives outside the repository (keystore file and passwords come from
    // the environment; tools/build-android.sh --bundle reads them from the login keychain).
    // Google re-signs for users (Play App Signing), so this key only proves an upload is ours.
    signingConfigs {
        create("upload") {
            val ks = System.getenv("BLOOM_UPLOAD_KEYSTORE")
            if (ks != null) {
                storeFile = file(ks)
                storePassword = System.getenv("BLOOM_UPLOAD_STORE_PASSWORD")
                keyAlias = System.getenv("BLOOM_UPLOAD_KEY_ALIAS") ?: "upload"
                keyPassword = System.getenv("BLOOM_UPLOAD_KEY_PASSWORD")
                    ?: System.getenv("BLOOM_UPLOAD_STORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (System.getenv("BLOOM_UPLOAD_KEYSTORE") != null) {
                signingConfig = signingConfigs.getByName("upload")
            }
        }
    }

    // The assets ship as the install-time asset pack `gamedata` in the Play bundle.
    assetPacks += listOf(":gamedata")

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    androidResources {
        // Leave the game's binary assets uncompressed so the engine reads them
        // straight from the extracted files. Covers the shooter's full asset
        // spread: models, shaders, worlds, textures, audio, HDR.
        noCompress += listOf(
            "glb", "wgsl", "json", "png", "jpg", "hdr",
            "wav", "ogg", "mp3", "bin", "ktx2", "ttf"
        )
    }

    sourceSets {
        getByName("main") {
            jniLibs.srcDirs("src/main/jniLibs")
            // build-android.sh stages the assets in the asset pack's folder. A debug APK (no
            // asset packs outside a bundle) takes them from there itself; the Play bundle
            // (-PplayBundle) leaves them to the pack, or every file would ship twice.
            if (project.hasProperty("playBundle")) {
                assets.setSrcDirs(listOf("src/main/assets"))
            } else {
                assets.setSrcDirs(listOf("src/main/assets", "../gamedata/src/main/assets"))
            }
        }
    }
}

// No dependencies. androidx.core was here unused, and Play's pre-review scan read its code (the
// account-service map in ContextCompat, the e-mail pattern in PatternsCompat) as the app sending
// e-mail addresses off the device: "Invalid data safety declaration" on 1.0.0 (2026-11-16).
dependencies {
}
