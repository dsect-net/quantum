package net.dsect.quantum;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import net.dsect.quantum.updater.UpdaterPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // App-local plugins are not auto-discovered; register explicitly.
        registerPlugin(UpdaterPlugin.class);
    }
}
