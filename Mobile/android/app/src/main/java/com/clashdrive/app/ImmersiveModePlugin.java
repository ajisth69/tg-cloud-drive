package com.clashdrive.app;

import android.graphics.Color;
import android.os.Build;
import android.util.Log;
import android.view.View;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * ImmersiveMode — system bar control for the media viewer.
 *
 * THREE STATES (anti-flash, no whites):
 *   1. preview()   → viewer open (not immersive): opaque BLACK bars with
 *                    light icons. The viewer's dark header blends with the
 *                    status bar — no light block on top.
 *   2. hide()      → immersive: edge-to-edge + transparent bars +
 *                    WindowInsetsController.hide() (sticky with swipe).
 *                    Colors prepared BEFORE hiding → no intermediate frame
 *                    shows white.
 *   3. restore()   → close the viewer: returns the app theme's light colors
 *                    (dashboard).
 *
 * ROM QUIRK (Motorola, targetSdk 35):
 *   - windowOptOutEdgeToEdgeEnforcement + shortEdges: when hiding the bars,
 *     the ROM clips the WebView at the display cutout inset (top=70px) and
 *     paints that strip with a fixed WHITE ScreenDecorOverlay (follows
 *     neither the theme nor the uimode). Fix: in immersive mode the WebView
 *     is shifted up (setTranslationY) to cover the strip; in the other
 *     states it returns to its place. The dashboard is untouched.
 *
 * Note: @capacitor/status-bar and @capacitor-community/navigation-bar are NOT
 * used: their hide() use legacy flags that Android 15+ (targetSdk 35) ignores,
 * and without edge-to-edge they force a WebView resize → white flash.
 */
@CapacitorPlugin(name = "ImmersiveMode")
public class ImmersiveModePlugin extends Plugin {

    private static final String TAG = "ImmersiveMode";
    private static boolean hidden = false;
    private static boolean previewMode = false;

    public static boolean isHidden() {
        return hidden;
    }

    public static boolean isPreviewMode() {
        return previewMode;
    }

    /* ── State 1: viewer open (transparent, visible bars) ──
       Only the gesture pill is visible; the app background (dark preview)
       shows through behind the status/nav bar. Light icons. */
    public static void applyPreview(View decor, Window window) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarColor(Color.TRANSPARENT);
            window.setNavigationBarColor(Color.TRANSPARENT);
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        // The WINDOW background (not the decor, which the WebView covers) is
        // what shows in the strips the ROM clips → this paints the viewer's
        // status/nav bar area (dark, blending with the header).
        window.setBackgroundDrawableResource(R.color.window_background_preview);

        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, decor);
        controller.show(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);

        Log.i(TAG, "applyPreview: transparent bars, visible");
    }

    /* ── State 2: immersive (hidden bars, edge-to-edge) ── */
    public static void applyHidden(View decor, Window window) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarColor(Color.TRANSPARENT);
            window.setNavigationBarColor(Color.TRANSPARENT);
        }
        window.setBackgroundDrawableResource(R.color.window_background_preview);
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, decor);
        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);

        Log.i(TAG, "applyHidden: bars hidden");
    }

    /* ── State 3: close the viewer (transparent bars, app theme) ──
       The app paints the background color; JS controls the icons (dark/light)
       via useTheme → StatusBar.setStyle / SystemBars.setStyle, not the system
       R.bool, to respect the app's manual theme. */
    public static void applyRestore(View decor, Window window) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarColor(Color.TRANSPARENT);
            window.setNavigationBarColor(Color.TRANSPARENT);
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        window.setBackgroundDrawableResource(R.color.window_background);

        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, decor);
        controller.show(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);

        Log.i(TAG, "applyRestore: transparent bars restored");
    }

    @PluginMethod
    public void getInsets(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            android.graphics.Insets insets = android.graphics.Insets.NONE;
            android.view.WindowInsets root = getActivity().getWindow().getDecorView().getRootWindowInsets();
            if (root != null) {
                insets = root.getInsets(
                        android.view.WindowInsets.Type.systemBars() |
                        android.view.WindowInsets.Type.displayCutout());
            }
            // Returns the insets in physical px: JS converts them to CSS px
            // (devicePixelRatio) and defines --safe-area-inset-* for the layout
            // (env() = 0 in this WebView, unreliable).
            com.getcapacitor.JSObject ret = new com.getcapacitor.JSObject();
            ret.put("top", insets.top);
            ret.put("bottom", insets.bottom);
            ret.put("left", insets.left);
            ret.put("right", insets.right);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void preview(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            hidden = false;
            previewMode = true;
            applyPreview(getActivity().getWindow().getDecorView(), getActivity().getWindow());
        });
        call.resolve();
    }

    @PluginMethod
    public void hide(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            hidden = true;
            View decor = getActivity().getWindow().getDecorView();
            Window window = getActivity().getWindow();
            applyHidden(decor, window);
            // Re-apply: some WebViews/ROMs re-show the bars when redrawing or
            // gaining focus; counteract them in a cascade.
            long[] delays = {100L, 400L, 1000L};
            for (long delay : delays) {
                decor.postDelayed(() -> {
                    if (hidden) applyHidden(decor, window);
                }, delay);
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void show(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            hidden = false;
            // Leaving immersive mode returns to the viewer (preview state):
            // black bars, never light ones.
            applyPreview(getActivity().getWindow().getDecorView(), getActivity().getWindow());
        });
        call.resolve();
    }

    @PluginMethod
    public void restore(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            hidden = false;
            previewMode = false;
            applyRestore(getActivity().getWindow().getDecorView(), getActivity().getWindow());
        });
        call.resolve();
    }
}
