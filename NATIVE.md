# The native apps (iOS and Android)

The game already installs on any phone as a web app — open it in the browser,
then **Add to Home Screen** (iPhone: Safari's Share button) or accept the
**Install** prompt (Android). That needs nothing below.

This page is for putting it **in the App Store and Google Play**. The same
code runs inside a native shell built with [Capacitor](https://capacitorjs.com)
8: `android/` and `ios/` are real Android Studio and Xcode projects, and
`npm run cap:sync` copies the built web app into both.

| | Where it runs | What it needs |
| --- | --- | --- |
| Web app (PWA) | any phone browser, installable | nothing — it is live on GitHub Pages |
| Android APK | your own Android phones | nothing — GitHub builds it (below) |
| Google Play | everyone on Android | a Google Play developer account ($25 once) |
| iPhone app | your own iPhone | a Mac with Xcode, a free Apple ID |
| App Store | everyone on iOS | a Mac with Xcode, Apple Developer Program ($99/yr) |

## Android: an APK without installing anything

Every push that touches the app runs **Actions → Android app**, which builds
`app-debug.apk` on GitHub's machines. Open the run, download
**chess-lab-android-debug** from *Artifacts*, unzip it, and open the `.apk` on
the phone (Android asks you to allow installing from that source once).

A debug build is fine for you and friends. For Google Play you need a signed
release build — next section.

## Android: Google Play

```sh
npm install
npm run android          # builds the web app, syncs, opens Android Studio
```

1. **Signing key.** Android Studio → *Build → Generate Signed App Bundle*
   creates a keystore. Keep it and its passwords safe and **out of this
   repository** — losing it means you can never update the app.
2. **Build** the release `.aab` from the same dialog.
3. **Play Console** — create the app, upload the bundle to *Internal testing*
   first, and fill in the store listing, content rating and *Data safety*
   form (see the privacy note below).

The app ID is `io.github.nigamcodes.chesslab` (in `capacitor.config.json`).
Change it **before** the first upload if you want something else; it can
never change afterwards.

## iPhone

Needs a Mac with a current Xcode — Apple's tools only run on macOS, which is
why nothing iOS-specific could be built or tested where this was written.

```sh
npm install
npm run ios              # builds the web app, syncs, opens Xcode
```

1. In Xcode select the **App** target → *Signing & Capabilities* → choose
   your **Team** (a free Apple ID works for your own phone; installs from a
   free account expire after 7 days).
2. Plug in the iPhone, pick it as the run destination, press ▶.
3. For the App Store: join the Apple Developer Program, then
   *Product → Archive* → *Distribute App* → App Store Connect, and submit
   through TestFlight first. App Store Connect asks about encryption export
   compliance; online play uses only standard encryption (HTTPS and WebRTC's
   built-in DTLS) — answer that question yourself, it is a legal declaration.

The project uses Swift Package Manager, so there is no CocoaPods step.

## Icons and splash screens

All of them — web, Android (including the adaptive icon's layers) and iOS —
come from one design in `scripts/make-icons.mjs`:

```sh
npm run icons
```

It writes over Capacitor's placeholders at whatever sizes the templates use,
and refuses to produce an iOS icon with an alpha channel, which App Store
Connect rejects.

## Why game links open in the browser, not the app

A link like `https://nigam-codes.github.io/ChessEngine/#join=k7m2-qx9p` opens
in the browser — where the game works fully — rather than in the installed
native app. Making phones hand such links to the app (*Universal Links* on
iOS, *App Links* on Android) requires two small files at the **root** of the
domain: `/.well-known/apple-app-site-association` and
`/.well-known/assetlinks.json`. A GitHub Pages *project* site lives at
`nigam-codes.github.io/ChessEngine/`, so it cannot serve that root.

To enable it later, serve the site from a custom domain or from a
`Nigam-Codes.github.io` user-site repository, publish those two files, and add
the associated-domain entitlement (iOS) and an intent filter (Android). The app
already listens for opened links and will join the game automatically once the
operating system starts handing them over.

Until then, inside the native app: **Online → paste a link or code → Join**.

## After changing the web code

```sh
npm run cap:sync         # rebuild and copy into both native projects
```

## Privacy note for store listings

Online games connect the two players' devices directly (WebRTC). That means
each player's device learns the other's IP address, and the free PeerJS
matchmaking server sees both while introducing them. On networks that block
direct connections, PeerJS's free relay server carries the game instead —
still encrypted end to end by WebRTC, so the relay cannot read it. Nothing else is
collected: there are no accounts, and saved games and settings stay on the
device. Both stores ask about this in their privacy forms.
