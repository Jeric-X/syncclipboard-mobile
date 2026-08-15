# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

## Instruction File Synchronization

`CLAUDE.md` and `AGENTS.md` describe the same repository-level rules for different coding
agents. Any change to repository guidance must update both files in the same change and keep
their instructions semantically equivalent. Do not modify only one of these files.

## Common Commands

```bash
npm install                        # Install dependencies
npm run prebuild                   # Generate native Android/iOS projects
npm run android                    # Build & run on Android device/emulator
npm run ios                        # Run on iOS (if supported)
npm run build:apk                  # Build release APK (android/gradlew assembleRelease)
npm run plugin:build               # Compile Expo config plugins (TypeScript in plugins/)
npm run type-check                 # tsc --noEmit
npm run lint                       # ESLint (TS/TSX/JS/JSX)
npm run lint:fix                   # ESLint auto-fix
npm run format-docs                # Prettier for JSON/Markdown
npm run test                       # Run all Jest tests
npm run test:watch                 # Jest watch mode
npm run test:coverage              # Jest with coverage
npx jest <file> --no-coverage      # Run a single test file (e.g., src/__tests__/xxx.test.ts)
```

## Architecture Overview

This is a React Native clipboard synchronization app built with **Expo SDK 55**, using React Native 0.83 and React 19. It syncs clipboard content (text, images, files) between devices via SyncClipboard Server, WebDAV, or S3 backends.

**Current status: Android-only. iOS support is planned for the future.**

All code should be written with cross-platform portability in mind (see [Cross-Platform Design Principles](#cross-platform-design-principles) below). When writing code, consider iOS compatibility but do **not** implement iOS-specific features or native modules right now — just avoid patterns that would make iOS support unnecessarily difficult later.

### Three Entry Points

`index.ts` registers three separate RN roots, each serving a distinct purpose:

| Registration     | Component                    | Purpose                                                                              |
| ---------------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| `main`           | `App.tsx`                    | Full app UI with bottom tab navigation (Home / History / Settings)                   |
| `quickAction`    | `src/QuickActionApp.tsx`     | Transparent overlay for quick-settings tiles, share menu, and text selection actions |
| `serviceRestart` | `src/ServiceRestartApp.tsx`  | Brief "service restored" screen shown when Android restarts the process              |
| Headless         | `src/tasks/SmsUploadTask.ts` | Background SMS verification code upload (no UI)                                      |

`App.tsx` handles cold/hot start deep link routing: parses `syncclipboard://` URLs to determine whether to show the main UI or an overlay (share receive, quick upload/download).

### State Management

**Zustand** stores in `src/stores/`:

- `useSettingsStore` — central app config (servers, sync settings, clipboard access methods, UI preferences). Persisted via `ConfigService` → `AsyncStorage`.
- `useLocalClipboardStore` — current local clipboard content
- `useHistoryStore` — clipboard history items
- `useMessageStore` / `useErrorStore` — toast messages and errors (UI-only, not persisted)
- `useClipboardSyncServiceStore` (in `src/serviceState/`) — sync operation state (progress, remote content, upload/download flags)

### Service Layer

Key singletons, typically accessed via `getInstance()` or module-level exports:

- **`ConfigService`** (`src/services/ConfigService.ts`) — the single source of truth for persisted app configuration. Reads/writes `AsyncStorage`. Has a subscriber pattern for change notification.
- **`ClientFactory`** (`src/services/ClientFactory.ts`) — creates the appropriate API client from the active server config. Supports three backends:
  - `SyncClipboardClient` — custom server (HTTP + optional SignalR)
  - `WebDAVClient` — WebDAV storage
  - `S3Client` — S3-compatible object storage
    Clients implement `ISyncClipboardAPI` (in `src/api/clients/APIClient.ts`), which uses `axios` + `AuthService`.
- **`BackgroundRuntimeState`** (`src/services/BackgroundRuntimeState.ts`) — non-persisted boolean flag (`isTempDisabled`) for temporarily disabling background tasks. Decoupled from Zustand to avoid circular dependency between `LongRunningTaskManager` and `settingsStore`.
- **`ClipboardMonitor`** (`src/services/clipboard/ClipboardMonitor.ts`) — polls the system clipboard for changes using `native-timer` (not `setInterval`, to survive background). Detects changes via hash comparison. Accepts background-running checkers.
- **`RemoteClipboardMonitor`** (`src/services/sync/RemoteClipboardMonitor.ts`) — monitors the remote clipboard. Uses SignalR for SyncClipboard servers, polling for WebDAV/S3. Has deduplication via `DedupedOperation` and content hash tracking.
- **`ClipboardSyncService`** (`src/services/sync/ClipboardSyncService.ts`) — wires together local clipboard monitoring, remote monitoring, and history sync. Subscribes to clipboard changes, remote changes, history changes, and transfer queue events.

### LongRunningTask Framework

`src/longRunningTask/LongRunningTaskManager.ts` is the central lifecycle manager for all background tasks. Each task implements `ILongRunningTask` (`src/longRunningTask/LongRunningTask.ts`):

- `start()` / `stop()` — idempotent
- `isRunning()` — query state
- `onConfigChanged()` — react to config changes while running
- `onBackground()` / `onForeground()` — react to app state transitions

**Registered tasks** (in `LongRunningTaskManager.ts`, at module level):

| Task                         | keepAlive? | Purpose                                         |
| ---------------------------- | ---------- | ----------------------------------------------- |
| `foregroundServiceTask`      | No         | Manages Android foreground service notification |
| `clipboardSyncTask`          | No         | Registers callbacks in ClipboardSyncService     |
| `heartbeatTask`              | No         | Periodic SignalR ping for SyncClipboard servers |
| `smsForwardingTask`          | Yes        | SMS forwarding hook                             |
| `clipboardMonitorTask`       | Yes        | Clipboard polling lifecycle                     |
| `remoteClipboardMonitorTask` | Yes        | Remote monitor lifecycle (SignalR/polling)      |
| `historyTrackerTask`         | Yes        | Local history change tracking                   |
| `historySyncTask`            | Yes        | History record sync with server                 |
| `networkAutoSwitchTask`      | Yes        | Selects servers from network changes            |

**keepAlive** tasks ignore the "background tasks" master toggle and always run. Non-keepAlive tasks are stopped when the user disables background tasks or when the app is backgrounded with temp-disabled state.

### Clipboard Access Fallback Chain

`src/utils/clipboardProxy.ts` wraps clipboard access with a priority chain:

1. **Shizuku** (`modules/shizuku-clipboard/`) — system-level clipboard access via Shizuku API (no root needed if Shizuku is running)
2. **Overlay** (`modules/clipboard-overlay/`) — 1px floating window that briefly focuses to read clipboard in background
3. **expo-clipboard** — default Expo clipboard API (works in foreground only)

The overlay has a 10-second idle timeout (managed via `native-timer`) to auto-hide and save resources.

### Native Modules (`modules/`)

Workspace packages, each is an Expo module with its own `package.json`. Currently all modules have Android native code only; iOS stubs should be added when iOS development begins.

| Module               | Platform            | Purpose                                                                                                                                                |
| -------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `signalr-client`     | Cross-platform (JS) | Wraps `@microsoft/signalr` JavaScript client, manages connection lifecycle                                                                             |
| `native-util`        | Android             | Native file operations (hash calculation, file copy, APK install). iOS: equivalent file APIs likely already exist in expo-file-system                  |
| `native-timer`       | Android             | Reliable background timers (survives doze mode). iOS: may not be needed (iOS timers behave differently in background)                                  |
| `clipboard-overlay`  | Android-only        | Floating overlay window to read clipboard in Android background. iOS: no equivalent needed (iOS clipboard access in background is handled differently) |
| `shizuku-clipboard`  | Android-only        | Shizuku API clipboard access. iOS: not applicable                                                                                                      |
| `sms-forwarder`      | Android-only        | SMS broadcast receiver + verification code extraction. iOS: not applicable (iOS doesn't allow SMS interception)                                        |
| `foreground-service` | Android-only        | Android foreground service notification. iOS: use background modes / BGTaskScheduler equivalent                                                        |
| `shortcut`           | Android             | Dynamic app shortcuts and quick-settings tiles. iOS: use `expo-quick-actions` for home screen quick actions                                            |

### Expo Config Plugins (`plugins/`)

TypeScript files compiled to `plugins/build/` via `npm run plugin:build`. Listed in `app.json` `plugins` array. These modify `AndroidManifest.xml`, `build.gradle`, and resource files to add quick-settings tiles, share targets, process-text actions, foreground service permissions, Shizuku provider, and SMS receivers.

All plugins currently target Android exclusively (using Expo's `withAndroidManifest`, `withAndroidBuildGradle`, etc. modifiers). When iOS support is added, corresponding `withIos*` modifiers should be added to relevant plugins.

### Key Data Types (`src/types/`)

- `ServerConfig` (`api.ts`) — defines a backend server (type: `syncclipboard|webdav|s3`, url, credentials, S3-specific fields)
- `ClipboardContent` (`clipboard.ts`) — unified clipboard content (type, text, fileUri, hashes, etc.)
- `HistoryItem` (`clipboard.ts`) — clipboard history entry with sync state, version, soft-delete
- `AppConfig` (`storage.ts`) — full persisted app configuration
- `ProfileDto` (`api.ts`) — server-side clipboard profile model (matches backend DTO)

### Navigation

Bottom tab navigator (Home / History / Settings) in `src/navigation/AppNavigator.tsx`. The `settingsStore` exposes many typed setter methods (e.g., `setEnableClipboardOverlay`, `setEnableShizukuClipboard`, `setEnableSmsForwarding`).

### i18n and Theming

- **i18n**: `react-i18next` with `zh` and `en` locales in `src/i18n/locales/`. Language detection via `expo-localization`.
- **Theme**: Light/dark/auto via `ThemeContext`. Colors defined in `src/theme/colors.ts`. The `createTheme()` factory resolves `auto` mode against system color scheme.

## Cross-Platform Design Principles

**The app is currently Android-only, but iOS support is planned.** When writing any code (JS/TS or native), follow these principles to keep the iOS path open without implementing iOS functionality today.

### In TypeScript/JavaScript

- **Use `Platform.OS` for branching, never `Platform.select` with an "android-only" fallback that would crash on iOS.** Prefer this pattern:

  ```typescript
  // ✅ Good — iOS gets a clean no-op or early return, Android logic is self-contained
  if (Platform.OS !== 'android') return;
  // Android-specific code here

  // ✅ Good — explicit default
  const value = Platform.select({
    android: () => doAndroidThing(),
    default: () => fallbackForOtherPlatforms(),
  })();

  // ❌ Avoid — iOS falls into `default` which may error
  const result = Platform.select({ android: androidSpecificValue });
  ```

- **Never use `import { ... } from 'react-native'` APIs that are Android-only without a platform guard.** (e.g., `ToastAndroid`, `BackHandler.exitApp()`).
- **Dependency injection / strategy pattern** — when a feature fundamentally requires different implementations per platform (e.g., clipboard access), define a common interface in shared code and inject the platform-specific implementation. The `clipboardProxy.ts` fallback chain is a good example: it already has Shizuku → Overlay → expo-clipboard, and iOS can slot into this chain naturally.
- **Keep iOS as a silent no-op target** — new features that cannot work on iOS today should still compile and run without crashing. The app should at minimum display the UI on iOS, even if certain features show "not available on iOS" states.

### In Native Modules (`modules/`)

- **Every native module should have an iOS stub** (even a minimal `expo-module.config.json` + empty Swift/ObjC file) so `pod install` doesn't fail. This keeps the iOS build compiling without implementing the feature.
- **Module interfaces should be platform-agnostic** — the JS API exported by a module (`index.ts`) should not assume Android. If the module can only work on Android, export a function that gracefully returns `null` or throws a descriptive error on iOS, rather than requiring the caller to `Platform.OS`-guard every import.
- **Use static imports for platform-specific modules** — keep imports at module scope and guard Android-only calls with `Platform.OS`. The module's JavaScript entry point must remain safe to import on unsupported platforms and provide a no-op or descriptive fallback.

### When Adding Android-Specific Features

- Before adding a new Android-only native module or config plugin, ask: "What would the iOS equivalent look like?" If the answer is "it doesn't apply to iOS," make sure the JS layer handles absence gracefully.
- New permissions, manifest entries, or Gradle dependencies added in config plugins should be scoped with an Android platform check (the Expo plugin API provides `withAndroidManifest`, `withAndroidBuildGradle`, etc.) — use those rather than modifying shared config.

**In short: implement Android fully, but never paint yourself into an Android-only corner.**

See `docs/bug-fix-workflow.md` for the TDD-style bug fix process:

1. Reproduce & locate root cause
2. Extract buggy logic into a testable pure function in `src/utils/` with dependency injection
3. Write a failing test in `src/__tests__/` that asserts the **correct** behavior
4. Fix the extracted function so the test passes
5. Update callers to use the fixed function
6. Run lint + type-check
7. Commit

### Dependency Injection Pattern for Testability

```typescript
// src/utils/xxxLogic.ts
export interface XxxDeps {
  getSomeState: () => SomeType;
  queryStorage: (key: string) => Promise<Result | null>;
}
export async function xxxLogic(input: InputType, deps: XxxDeps): Promise<OutputType> {
  // pure logic here
}
```

## Code Style and Conventions

- **Linter**: ESLint v9 flat config (`eslint.config.mjs`) with TypeScript, React, React Hooks, React Native, and Prettier plugins
- **Import aliases**: Path aliases defined in both `tsconfig.json` and `babel.config.js`: `@/` → `src/`, `@components/`, `@services/`, etc. Module aliases: `native-util`, `shortcut`, `signalr-client`, etc. point to their `src/` directories.
- **React Native style**: `react-native-no-inline-styles: warn`, `react-native-no-color-literals: warn`
- **Unused vars**: Warn level (`_` prefix ignores)
- **Explicit any**: Warn level — discouraged but not banned
- **Module aliases**: Must be kept in sync between `tsconfig.json` paths and `babel.config.js` aliases
- **File naming**: PascalCase for components/screens, camelCase for stores/services/utils
- **临时 import 禁止**: 严禁使用临时 import（即在函数体内或代码块中使用 `require()` 或 `await import()` 动态导入模块）。所有 import 必须放在文件顶部、模块作用域中。临时 import 会导致模块加载不可预测、破坏 tree-shaking、增加运行时开销，并且通常是调试遗留代码。如需条件加载，应使用模块顶层的静态 import 配合 `Platform.OS` 守卫或依赖注入模式。
- **Comments**: JSDoc block comments used on classes, interfaces, and exported functions; comments written in Chinese on architecture-level files
