import { defineConfig } from 'astro/config';
import squizAstroAdapter from '@squiz-astro-adapter';

export default defineConfig({
  output: 'static',
  build: {
    inlineStylesheets: 'never'
  },
  integrations: [squizAstroAdapter()],
});
