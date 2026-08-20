package com.clashdrive.app;

import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

/**
 * PlayerActivity — full-screen native video player.
 *
 * Builds the UI in code (without XML layouts) to avoid touching resources:
 * PlayerView with ExoPlayer's classic controls, keep screen on, and
 * hidden system bars (sticky immersive).
 */
public class PlayerActivity extends AppCompatActivity {

    public static final String EXTRA_PATH = "clashdrive.extra.PATH";
    public static final String EXTRA_TITLE = "clashdrive.extra.TITLE";

    private ExoPlayer player;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        PlayerView playerView = new PlayerView(this);
        playerView.setBackgroundColor(0xFF000000);
        playerView.setControllerShowTimeoutMs(3000);
        playerView.setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING);

        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT);
        setContentView(playerView, params);

        player = new ExoPlayer.Builder(this).build();
        playerView.setPlayer(player);

        player.addListener(new Player.Listener() {
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                // Fullscreen immersive while playing; restore bars on pause.
                int flags = View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
                if (isPlaying) {
                    getWindow().getDecorView().setSystemUiVisibility(flags);
                } else {
                    getWindow().getDecorView().setSystemUiVisibility(0);
                }
            }
        });

        String path = getIntent().getStringExtra(EXTRA_PATH);
        if (path == null || path.isEmpty()) {
            finish();
            return;
        }

        player.setMediaItem(MediaItem.fromUri(Uri.fromFile(new java.io.File(path))));
        player.prepare();
        player.setPlayWhenReady(true);
    }

    @Override
    protected void onDestroy() {
        if (player != null) {
            player.release();
            player = null;
        }
        super.onDestroy();
    }
}