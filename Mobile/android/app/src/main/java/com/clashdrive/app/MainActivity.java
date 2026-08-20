package com.clashdrive.app;

import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // IMPORTANT: register BEFORE super.onCreate — the bridge is created
        // inside load() (super), and the plugin headers the JS receives are
        // generated there. A later registerPlugin is a no-op: the plugin
        // would never appear in Capacitor.Plugins.
        registerPlugin(ImmersiveModePlugin.class);
        registerPlugin(NativeVideoPlayerPlugin.class);
        super.onCreate(savedInstanceState);

        // Edge-to-edge from launch: the window covers the entire screen
        // (including this ROM's display cutout, top=70px). If the window does
        // NOT cover it, the ROM paints a fixed white strip (ScreenDecorOverlay)
        // over the cutout area — visible when hiding the bars (immersive).
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        boolean debuggable = (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (debuggable) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        // Transparent system bars: the app content shows through behind them
        // (header/dock paint their own area); only the gesture pill remains.
        // JS controls the icons (light/dark) according to the app theme.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setStatusBarColor(android.graphics.Color.TRANSPARENT);
            getWindow().setNavigationBarColor(android.graphics.Color.TRANSPARENT);
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }
        // The window background (visible in the strips the ROM clips from the
        // WebView) = the theme color, not the launch splash.
        getWindow().setBackgroundDrawableResource(R.color.window_background);

        // The bridge's CoordinatorLayout applies the system insets to the
        // WebView (top=70 + bottom=42 on this ROM): the content falls short
        // and does not draw behind the bars. Consuming the insets at the root
        // → WebView = full screen → the app draws behind the transparent
        // status bar (see-through).
        View content = getWindow().getDecorView().findViewById(android.R.id.content);
        content.setOnApplyWindowInsetsListener((v, insets) -> android.view.WindowInsets.CONSUMED);

        // Some WebViews/ROMs re-show the bars when the window gains focus or
        // when SystemUI changes its visibility (e.g. after a transient swipe
        // reveal). If immersive mode is active, the hidden state is re-applied
        // immediately.
        View decor = getWindow().getDecorView();
        decor.setOnSystemUiVisibilityChangeListener(flags -> {
            if (ImmersiveModePlugin.isHidden()) {
                boolean barsVisible = (flags & View.SYSTEM_UI_FLAG_FULLSCREEN) == 0;
                if (barsVisible) {
                    ImmersiveModePlugin.applyHidden(decor, getWindow());
                }
            }
        });
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && ImmersiveModePlugin.isHidden()) {
            ImmersiveModePlugin.applyHidden(getWindow().getDecorView(), getWindow());
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        // Android restores the system bars when returning from the background;
        // re-apply the hidden state.
        if (ImmersiveModePlugin.isHidden()) {
            ImmersiveModePlugin.applyHidden(getWindow().getDecorView(), getWindow());
        }
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // The activity is not recreated on uiMode changes; re-paint the bars
        // according to the viewer's current state.
        if (ImmersiveModePlugin.isPreviewMode()) {
            ImmersiveModePlugin.applyPreview(getWindow().getDecorView(), getWindow());
        }
    }
}