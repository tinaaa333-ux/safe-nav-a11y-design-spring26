# SafeNav iPad Demo Build

This is a temporary class/demo build path for installing SafeNav on a physical iPad with Xcode.

## Backend URL

Set the frontend API URL in `.env.local`:

```env
VITE_API_BASE_URL=http://34.41.85.77:8000
```

Restart Vite after changing `.env.local`. Rebuild and sync before opening Xcode.

## Build And Sync

```bash
npm run build
npx cap sync ios
npx cap open ios
```

This project uses Capacitor's Swift Package Manager iOS setup, so the iOS project is `ios/App/App.xcodeproj`.

## Install On Physical iPad

1. Connect the iPad by USB and unlock it.
2. Trust the computer if iPadOS prompts you.
3. In Xcode, select the physical iPad from the run destination menu.
4. In the `App` target signing settings, choose your Apple development team.
5. Press Run to build and install.

## Demo HTTP Exception

The hosted backend currently uses HTTP. `ios/App/App/Info.plist` includes a demo-only App Transport Security exception for `34.41.85.77`.

Remove this exception before production, or move the backend to HTTPS and set `VITE_API_BASE_URL` to the HTTPS URL.

## Hosted Backend CORS

The hosted backend must allow the Capacitor iOS WebView origin. If the backend is using this repo's environment-based CORS setting, set:

```env
CORS_ALLOWED_ORIGINS=http://localhost,http://localhost:5173,http://localhost:4173,http://127.0.0.1:5173,http://127.0.0.1:4173,capacitor://localhost,ionic://localhost,https://localhost
```

Then restart the hosted backend process.
