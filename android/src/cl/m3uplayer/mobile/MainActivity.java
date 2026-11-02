package cl.m3uplayer.mobile;

import android.app.Activity;
import android.app.UiModeManager;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.webkit.*;
import android.widget.FrameLayout;
import java.io.ByteArrayInputStream;
import java.net.URLConnection;

public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private WebView web;
    private FrameLayout root;
    private View fullscreen;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private ValueCallback<Uri[]> fileCallback;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().setStatusBarColor(0xff141421);
        getWindow().setNavigationBarColor(0xff141421);
        root = new FrameLayout(this);
        root.setBackgroundColor(0xff141421);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(0, 0, 0, 0);
            return insets;
        });
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        immersive();
        getWindow().getDecorView().setOnSystemUiVisibilityChangeListener(visibility -> {
            if ((visibility & View.SYSTEM_UI_FLAG_FULLSCREEN) == 0) immersive();
        });
        WebSettings settings = web.getSettings();
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        web.addJavascriptInterface(new Object() {
            @JavascriptInterface public void setLiveMode(boolean live) {
                runOnUiThread(() -> updateOrientation(live));
            }
        }, "AndroidApp");
        updateOrientation(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        // Some supplied IPTV streams use HTTP even when the interface is HTTPS.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!HOST.equals(uri.getHost())) return null;
                String name = uri.getPath();
                if (name == null || !name.startsWith("/assets/") || name.contains("..")) return missing();
                try {
                    String mime = URLConnection.guessContentTypeFromName(name);
                    if (name.endsWith(".js")) mime = "application/javascript";
                    if (name.endsWith(".css")) mime = "text/css";
                    return new WebResourceResponse(mime == null ? "application/octet-stream" : mime,
                        "UTF-8", getAssets().open(name.substring(8)));
                } catch (Exception e) { return missing(); }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && HOST.equals(uri.getHost())) return false;
                if ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                try { startActivityForResult(intent, 100); }
                catch (Exception e) { fileCallback.onReceiveValue(null); fileCallback = null; }
                return true;
            }
            @Override public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullscreen != null) { callback.onCustomViewHidden(); return; }
                fullscreen = view;
                fullscreenCallback = callback;
                web.setVisibility(View.GONE);
                root.addView(view, new FrameLayout.LayoutParams(-1, -1));
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            }
            @Override public void onHideCustomView() { closeFullscreen(); }
        });
        if (state == null) web.loadUrl("https://" + HOST + "/assets/index.html");
        else web.restoreState(state);
    }
    private WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null,
            new ByteArrayInputStream(new byte[0]));
    }
    private void updateOrientation(boolean live) {
        if (live) {
            InputMethodManager keyboard = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (keyboard != null) keyboard.hideSoftInputFromWindow(web.getWindowToken(), 0);
        }
        UiModeManager mode = (UiModeManager) getSystemService(UI_MODE_SERVICE);
        boolean television = mode != null && mode.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
        setRequestedOrientation(live || television ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
    }
    private void closeFullscreen() {
        if (fullscreen == null) return;
        root.removeView(fullscreen);
        fullscreen = null;
        web.setVisibility(View.VISIBLE);
        immersive();
        if (fullscreenCallback != null) fullscreenCallback.onCustomViewHidden();
        fullscreenCallback = null;
    }
    @Override public void onBackPressed() {
        if (fullscreen != null) { closeFullscreen(); return; }
        web.evaluateJavascript("(window.playerBack ? window.playerBack() : false)", handled -> {
            if (!"true".equals(handled)) {
                if (web.canGoBack()) web.goBack(); else finish();
            }
        });
    }
    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }
    @Override public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (focused) immersive();
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 100 && fileCallback != null) {
            fileCallback.onReceiveValue(result == RESULT_OK && data != null ? new Uri[]{data.getData()} : null);
            fileCallback = null;
        }
    }
    @Override protected void onSaveInstanceState(Bundle state) { super.onSaveInstanceState(state); web.saveState(state); }
    @Override protected void onPause() { web.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override protected void onDestroy() {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        web.destroy();
        super.onDestroy();
    }
}
