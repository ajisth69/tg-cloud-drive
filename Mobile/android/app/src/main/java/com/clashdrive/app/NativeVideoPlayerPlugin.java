package com.clashdrive.app;

import android.content.Intent;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * NativeVideoPlayer — opens a native player (ExoPlayer/Media3) in full
 * screen for a local file.
 *
 * Usage from JS:
 *   await Capacitor.Plugins.NativeVideoPlayer.open({ path: "/data/.../file.mkv", title: "name" })
 *
 * `path` must be a real file path on the device (the WebView first downloads
 * the file with @capacitor/filesystem and passes the absolute path). ExoPlayer
 * decodes in hardware (MediaCodec) any container/codec supported by the device
 * (MKV, AVI, HEVC, etc.), bypassing the JS decode (OGV.js).
 */
@CapacitorPlugin(name = "NativeVideoPlayer")
public class NativeVideoPlayerPlugin extends Plugin {

    @PluginMethod
    public void open(PluginCall call) {
        String path = call.getString("path");
        String title = call.getString("title", "");

        if (path == null || path.isEmpty()) {
            call.reject("path is required");
            return;
        }

        Intent intent = new Intent(getContext(), PlayerActivity.class);
        intent.putExtra(PlayerActivity.EXTRA_PATH, path);
        intent.putExtra(PlayerActivity.EXTRA_TITLE, title);
        getActivity().startActivity(intent);

        call.resolve();
    }
}