# SafeNav Mobile

SafeNav is packaged with Vite and Capacitor so the same frontend can run in the browser, iOS, and Android.

## Setup

```bash
npm install
cp .env.example .env.local
```

Set `VITE_API_BASE_URL` in `.env.local` to the HTTPS routing backend, for example:

```env
VITE_API_BASE_URL=https://your-routing-backend.example.com
VITE_VEST_BASE_URL=
```

`VITE_VEST_BASE_URL` is optional. Leave it blank when the ESP32 vest is not connected.

Restart the dev server after changing `.env.local`. Rebuild and sync the native projects after changing these values for installed app builds.

## Run

```bash
npm run dev
npm run build
npm run cap:sync
npm run ios
npm run android
```

The iOS and Android commands require Xcode and Android Studio tooling on the host machine.
