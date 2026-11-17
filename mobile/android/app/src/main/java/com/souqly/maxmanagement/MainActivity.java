package com.souqly.maxmanagement;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.window.OnBackInvokedDispatcher;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/** MAX Management: the web app (maxsouqly.netlify.app) in a full-screen WebView. */
public class MainActivity extends Activity {
    static final String HOME = "https://maxsouqly.netlify.app/";
    static final String HOST = "maxsouqly.netlify.app";
    private static final int FILE_REQUEST = 41;

    private WebView web;
    private WebView printView; // kept alive while the system print dialog runs
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF131110);
        web = new WebView(this);
        web.setBackgroundColor(0xFF131110);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        // Android 15+ draws behind the status / navigation bars: keep the page inside them (and above the keyboard)
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets b = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(b.left, b.top, b.right, b.bottom);
            } else {
                v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        if (Build.VERSION.SDK_INT >= 33) {
            // the back gesture: go back in the app's history, else leave
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        }

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false); // target=_blank opens in the same view
        // behave like an app, not a browser: the page fills the screen exactly, no zooming,
        // and the phone's font-size setting does not stretch the layout
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        s.setUserAgentString(s.getUserAgentString() + " MaxManagementApp/1.0 (Android)");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(new Bridge(), "MaxNative");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        if (state != null) web.restoreState(state);
        else load(getIntent());
    }

    private void load(Intent intent) {
        Uri data = intent != null ? intent.getData() : null;
        web.loadUrl(data != null && HOST.equals(data.getHost()) ? data.toString() : HOME);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent.getData() != null) load(intent);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    private void goBack() {
        if (web.canGoBack()) web.goBack();
        else moveTaskToBack(true);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        goBack(); // Android 12 and older
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        if (request == FILE_REQUEST) {
            if (fileCallback != null) fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
            return;
        }
        super.onActivityResult(request, result, data);
    }

    static boolean appLink(Uri u) {
        String h = u.getHost() == null ? "" : u.getHost();
        return h.equals("wa.me") || h.endsWith("whatsapp.com") || h.equals("maps.app.goo.gl") || h.startsWith("maps.google.")
            || (h.endsWith("google.com") && u.getPath() != null && u.getPath().startsWith("/maps")) || h.endsWith("waze.com");
    }

    static boolean ours(Uri u) {
        return u != null && "https".equals(u.getScheme()) && HOST.equals(u.getHost());
    }

    private void openOutside(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
            // nothing on the phone can open it
        }
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            String scheme = u.getScheme();
            if (ours(u) || "file".equals(scheme) || "about".equals(scheme) || "data".equals(scheme) || "blob".equals(scheme)) return false;
            // web pages stay inside the app; only calls, WhatsApp, maps and e-mail go to their own apps
            if (("https".equals(scheme) || "http".equals(scheme)) && !appLink(u)) return false;
            openOutside(u);
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
            if (req.isForMainFrame() && ours(req.getUrl())) {
                view.loadUrl("file:///android_asset/offline.html?to=" + Uri.encode(req.getUrl().toString()));
            }
        }
    }

    private class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            try {
                Intent pick = params.createIntent();
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                startActivityForResult(Intent.createChooser(pick, null), FILE_REQUEST);
                return true;
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
        }
    }

    /** Called from the web app (src/lib/native.ts). Only the MAX site may use it. */
    private class Bridge {
        @JavascriptInterface
        public void print(final String html, final String title) {
            runOnUiThread(() -> {
                if (!ours(Uri.parse(String.valueOf(web.getUrl())))) return;
                doPrint(html, title);
            });
        }

        @JavascriptInterface
        public void saveFile(final String name, final String mime, final String base64) {
            runOnUiThread(() -> {
                if (!ours(Uri.parse(String.valueOf(web.getUrl())))) return;
                doSave(name, mime, base64);
            });
        }
    }

    private void doPrint(String html, final String title) {
        final WebView pv = new WebView(this);
        pv.getSettings().setJavaScriptEnabled(false);
        pv.setWebViewClient(new WebViewClient() {
            private boolean done;

            @Override
            public void onPageFinished(WebView view, String url) {
                if (done) return;
                done = true;
                // give web fonts and images a moment
                view.postDelayed(() -> {
                    PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
                    String job = title == null || title.isEmpty() ? "MAX" : title;
                    pm.print(job, view.createPrintDocumentAdapter(job), new PrintAttributes.Builder().build());
                }, 700);
            }
        });
        printView = pv;
        pv.loadDataWithBaseURL(HOME, html, "text/html", "utf-8", null);
    }

    private void doSave(String name, String mime, String base64) {
        String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
        byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                v.put(MediaStore.Downloads.MIME_TYPE, mime);
                v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new IllegalStateException("no uri");
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    if (out == null) throw new IllegalStateException("no stream");
                    out.write(bytes);
                }
                Toast.makeText(this, "تم الحفظ في التنزيلات · נשמר בהורדות\n" + safe, Toast.LENGTH_LONG).show();
                share(uri, mime);
            } else {
                File dir = new File(getCacheDir(), "shared");
                if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("no dir");
                File f = new File(dir, safe);
                try (FileOutputStream out = new FileOutputStream(f)) {
                    out.write(bytes);
                }
                share(FileShareProvider.uriFor(f), mime);
            }
        } catch (Exception e) {
            Toast.makeText(this, "تعذر حفظ الملف · שמירת הקובץ נכשלה", Toast.LENGTH_LONG).show();
        }
    }

    private void share(Uri uri, String mime) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType(mime);
        send.putExtra(Intent.EXTRA_STREAM, uri);
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivity(Intent.createChooser(send, null));
        } catch (ActivityNotFoundException ignored) {
            // saved anyway
        }
    }

    @Override
    protected void onDestroy() {
        if (printView != null) printView.destroy();
        web.destroy();
        super.onDestroy();
    }
}
