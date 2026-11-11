// @hutch cli=0.28.2 cottontail=0.7.3
// `hutch <script>` runs these (README.md). `prepare` builds the engine's thread and the page into .gen/, which the
// app bundle copies in; the other scripts run it first.
export default {
	scripts: {
		install: ["hutch", "install", "--frozen-lockfile"],
		prepare: ["bun", "scripts/prepare.ts"],
		start: "bun scripts/prepare.ts && hutch electrobun dev",
		dev: "bun scripts/prepare.ts && hutch electrobun dev --watch",
		build: "bun scripts/prepare.ts && hutch electrobun build --env=stable",
		test: ["bun", "test", "test"],
		typecheck: "bun ../core/node_modules/typescript/bin/tsc -p tsconfig.json && bun ../core/node_modules/typescript/bin/tsc -p tsconfig.app.json",
	},
	electrobun: {
		version: "2.0.5",
	},
};
