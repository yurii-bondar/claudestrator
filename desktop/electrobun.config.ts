import type { ElectrobunConfig } from "electrobun";
import pkg from "./package.json";

const env = process.env;
const signing = Boolean(env["ELECTROBUN_DEVELOPER_ID"] && env["ELECTROBUN_TEAMID"]);
const notarizing = Boolean((env["ELECTROBUN_APPLEID"] && env["ELECTROBUN_APPLEIDPASS"]) || env["ELECTROBUN_APPLEAPIKEY"]);

export default {
	app: {
		name: "Claudestrator",
		identifier: "io.github.yuriibondar.claudestrator",
		version: pkg.version,
		description: pkg.description,
	},
	build: {
		bun: { entrypoint: "src/bun/index.ts" },
		views: {
			// The bridge between the page and the app; the page itself is copied in below.
			dashboard: { entrypoint: "src/view/index.ts" },
		},
		// .gen/ is made by scripts/prepare.ts: the engine's thread (with the sandbox runtime) and the page.
		copy: {
			"src/view/index.html": "views/dashboard/index.html",
			"src/view/theme.css": "views/dashboard/theme.css",
			".gen/page": "views/dashboard/page",
			".gen/engine": "engine",
		},
		watch: ["../core/src", "../core/page", "../vscode/src"],
		// The system's webview (WKWebView, WebView2, WebKitGTK): no Chromium in the bundle.
		mac: {
			bundleCEF: false,
			icons: "assets/icon.iconset",
			// Signed with a Developer ID and notarized when the build has them (README.md, "Signing and notarizing"):
			// ELECTROBUN_DEVELOPER_ID and ELECTROBUN_TEAMID, then ELECTROBUN_APPLEID and ELECTROBUN_APPLEIDPASS (or an
			// App Store Connect API key). Without them the app is signed ad hoc: it runs on the Mac that built it.
			codesign: signing,
			notarize: signing && notarizing,
			// The hardened runtime that notarizing needs, with what Bun's JavaScriptCore and its dylibs need of it. No
			// App Sandbox: the engine runs git, gh, claude and the checks wherever your repos are.
			entitlements: {
				"com.apple.security.cs.allow-jit": true,
				"com.apple.security.cs.allow-unsigned-executable-memory": true,
				"com.apple.security.cs.disable-library-validation": true,
			},
		},
		linux: { bundleCEF: false, icon: "assets/icon.png" },
		win: { bundleCEF: false },
	},
	scripts: {
		// The version Finder shows, and an ad-hoc signature over the bundle when there is no Developer ID.
		postWrap: "scripts/post-wrap.ts",
	},
	runtime: {
		// On macOS the app outlives its window, as its agents do; elsewhere closing the window quits (src/bun/index.ts).
		exitOnLastWindowClosed: false,
	},
} satisfies ElectrobunConfig;
