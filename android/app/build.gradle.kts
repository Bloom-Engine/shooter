plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.bloomengine.shooter"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.bloomengine.shooter"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"

        ndk {
            abiFilters += "arm64-v8a"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

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
            assets.srcDirs("src/main/assets")
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
}
