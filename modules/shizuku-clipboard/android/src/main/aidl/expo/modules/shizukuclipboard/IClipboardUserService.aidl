package expo.modules.shizukuclipboard;

import expo.modules.shizukuclipboard.IClipboardChangedCallback;

interface IClipboardUserService {
    String getPrimaryClipText() = 1;
    boolean hasPrimaryClipText() = 2;
    boolean hasPrimaryClipImage() = 3;
    String getPrimaryClipImageUri() = 4;
    void init(IBinder callerToken) = 5;
    boolean setClipboardChangedCallback(IClipboardChangedCallback callback) = 6;
    void clearClipboardChangedCallback() = 7;
    boolean isClipboardServiceHealthy() = 8;
    void destroy() = 16777114;
}
