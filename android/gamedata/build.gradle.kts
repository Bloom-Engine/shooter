// The game's assets as a Play install-time asset pack (Google Play's base module is capped at
// 200 MB; the assets are ~480 MB). Play installs the pack together with the app and its files
// appear in the app's AssetManager under the same paths, so BloomActivity's extraction is
// unchanged. Only the release bundle uses it: tools/build-android.sh --bundle copies the
// assets here instead of into app/src/main/assets (the debug APK keeps them in the app).
plugins {
    id("com.android.asset-pack")
}

assetPack {
    packName.set("gamedata")
    dynamicDelivery {
        deliveryType.set("install-time")
    }
}
