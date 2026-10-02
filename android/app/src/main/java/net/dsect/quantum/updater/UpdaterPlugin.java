package net.dsect.quantum.updater;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * UpdaterNative — downloads a Quantum APK via the system DownloadManager
 * and hands it to the Android package installer.
 *
 * The APK lands in the app's private cache dir (FileProvider already
 * declared in AndroidManifest.xml with a cache-path), so no storage
 * permission is needed. Requires REQUEST_INSTALL_PACKAGES in the manifest.
 */
@CapacitorPlugin(name = "UpdaterNative")
public class UpdaterPlugin extends Plugin {

    private static final String APK_FILE_NAME = "quantum-update.apk";

    private File apkFile() {
        File dir = new File(getContext().getCacheDir(), "updates");
        if (!dir.exists()) {
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        }
        return new File(dir, APK_FILE_NAME);
    }

    @PluginMethod
    public void downloadUpdate(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Missing download URL");
            return;
        }
        try {
            // Remove any stale partial download from a previous attempt.
            File apk = apkFile();
            if (apk.exists()) {
                //noinspection ResultOfMethodCallIgnored
                apk.delete();
            }
            DownloadManager dm =
                    (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            req.setTitle("Quantum update");
            req.setDescription("Downloading Quantum update…");
            req.setNotificationVisibility(
                    DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationUri(Uri.fromFile(apk));
            req.setAllowedOverMetered(true);
            req.setAllowedOverRoaming(false);
            long id = dm.enqueue(req);
            JSObject ret = new JSObject();
            ret.put("downloadId", String.valueOf(id));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Download failed to start: " + e.getMessage());
        }
    }

    @PluginMethod
    public void getDownloadProgress(PluginCall call) {
        String idStr = call.getString("downloadId");
        long id;
        try {
            id = Long.parseLong(idStr);
        } catch (Exception e) {
            call.reject("Invalid download id");
            return;
        }
        DownloadManager dm =
                (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        DownloadManager.Query q = new DownloadManager.Query().setFilterById(id);
        android.database.Cursor c = null;
        try {
            c = dm.query(q);
            if (c == null || !c.moveToFirst()) {
                call.reject("Download not found");
                return;
            }
            int statusIdx = c.getColumnIndex(DownloadManager.COLUMN_STATUS);
            int downloadedIdx = c.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR);
            int totalIdx = c.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES);
            int status = c.getInt(statusIdx);
            long downloaded = c.getLong(downloadedIdx);
            long total = c.getLong(totalIdx);

            String statusName;
            switch (status) {
                case DownloadManager.STATUS_PENDING:
                    statusName = "pending";
                    break;
                case DownloadManager.STATUS_RUNNING:
                    statusName = "running";
                    break;
                case DownloadManager.STATUS_PAUSED:
                    statusName = "paused";
                    break;
                case DownloadManager.STATUS_SUCCESSFUL:
                    statusName = "complete";
                    break;
                case DownloadManager.STATUS_FAILED:
                default:
                    statusName = "failed";
                    break;
            }
            JSObject ret = new JSObject();
            ret.put("status", statusName);
            ret.put("bytesDownloaded", downloaded);
            ret.put("bytesTotal", total);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Progress query failed: " + e.getMessage());
        } finally {
            if (c != null) c.close();
        }
    }

    @PluginMethod
    public void canInstallPackages(PluginCall call) {
        boolean granted = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            granted = getContext().getPackageManager().canRequestPackageInstalls();
        }
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    @PluginMethod
    public void openUnknownSourcesSettings(PluginCall call) {
        // Android 8+: the per-app "Allow from this source" / "Install
        // unknown apps" page. The user flips it on and comes back.
        Intent intent =
                new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void installUpdate(PluginCall call) {
        File apk = apkFile();
        if (!apk.exists()) {
            call.reject("Downloaded update not found — please download again.");
            return;
        }
        try {
            Context ctx = getContext();
            Uri uri =
                    FileProvider.getUriForFile(
                            ctx, ctx.getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            ctx.startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("started", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not launch installer: " + e.getMessage());
        }
    }
}
