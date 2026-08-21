package expo.modules.shizukuclipboard;

import expo.modules.shizukuclipboard.IClipboardChangedCallback;

interface IClipboardUserService {
    String getPrimaryClipText() = 1;
    boolean hasPrimaryClipText() = 2;
    boolean hasPrimaryClipImage() = 3;
    String getPrimaryClipImageUri() = 4;
    boolean setClipboardChangedCallback(IBinder callerToken, IClipboardChangedCallback callback) = 6;
    void clearClipboardChangedCallback(IBinder callerToken) = 7;
    boolean isClipboardServiceHealthy() = 8;
    void destroy() = 16777114;
}
