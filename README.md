# Frakiry

This repository contains an example Obsidian plugin written in TypeScript. The plugin adds a simple command that displays a notice when executed.

## Development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Build the plugin:
   ```bash
   npm run build
   ```
3. Copy the files `manifest.json`, `dist/main.js`, and `styles.css` (if any) into your vault's `.obsidian/plugins/frakiry-plugin` directory and enable it from Obsidian's settings.

Use `npm run dev` during development to automatically rebuild on changes.
