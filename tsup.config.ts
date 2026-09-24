import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    index: 'src/index.ts',
  },
  format: ['esm'],
  clean: true,
  dts: true,
  sourcemap: true,
  target: 'node18',
  banner: ({ entry }) => {
    if (entry === 'cli') {
      return {
        js: '#!/usr/bin/env node',
      };
    }
    return {};
  },
  splitting: false,
  treeshake: true,
  minify: false,
});
