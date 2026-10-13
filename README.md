# BRNotation

An Obsidian plugin for rendering and working with custom notation in your notes.

See [HELP.md](HELP.md) for the full user guide.

## Development

When you change a feature, DSL keyword, command, or setting, update the matching section of [HELP.md](HELP.md) in the same change. Every example in HELP.md should be a fenced `brnotation` code block that still parses.

```bash
# Install dependencies
npm install

# Run build watch mode
npm run dev

# Production build
npm run build
```

## Testing in Obsidian

This plugin is configured to be tested directly inside the native Obsidian application using the companion test vault at `~/Developer/BRNotation-TestVault`.
