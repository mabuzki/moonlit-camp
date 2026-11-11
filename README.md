# Moonlit Camp · 月下营地

Moonlit Camp is a tiny animated pixel-art campsite for your Windows desktop. Watch the light change through the day, the campfire flicker, and the tents open and close on their own schedules.

## Download

Get `MoonlitCamp.exe` from [GitHub Releases](https://github.com/mabuzki/moonlit-camp/releases). The portable build runs on 64-bit Windows with Microsoft Edge WebView2 Runtime. Run the executable and use the system tray icon to show or quit the camp.

## Run from source

Use Node.js 24 and pnpm. A native Windows build also needs Rust with the MSVC toolchain, the C++ build tools, and WebView2. See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

Download Devkidd’s [Pixel Art Fire Asset Pack v1.2](https://devkidd.itch.io/pixel-fire-asset-pack) and extract the `Pixel fire asset pack v1.2` folder under `assets/third-party/devkidd-pixel-fire/`. The asset preparation script reads the pack’s `Thank you.txt` and the eight original PNGs from `Pixel Fire Asset Pack Colored/fire asset red/Group 6 - 1/`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Run `pnpm tauri dev` for the native window or `pnpm tauri build --no-bundle` to compile the portable executable.
