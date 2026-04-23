import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const routeToName = (route) => {
  if (route === '/') return 'index';
  return route.replace(/^\//, '').replace(/\/$/, '').replace(/\//g, '-') || 'index';
};

const extractComponentTemplate = (componentSource) => {
  const frontmatterMatch = componentSource.match(/^---\n([\s\S]*?)\n---\n/);
  const template = frontmatterMatch ? componentSource.slice(frontmatterMatch[0].length) : componentSource;
  return template.replace(/<style[\s\S]*?<\/style>/gi, '').trim();
};

const compileComponentTemplate = (template) => {
  return template.replace(/\{\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\}/g, (_, name) => `\${props.${name}}`);
};

const preserveRenderedAttributes = (renderedHtml, compiledTemplate) => {
  const renderedOpenTag = renderedHtml.match(/^<[^>]+>/);
  if (!renderedOpenTag) return compiledTemplate;
  return compiledTemplate.replace(/^<[^>]+>/, renderedOpenTag[0]);
};

const renderSquizModule = (html, componentSource) => {
  // Remove DOCTYPE and html/body tags if present
  let cleanHtml = html.replace(/^<!DOCTYPE[^>]*>/i, '').trim();
  if (cleanHtml.startsWith('<html')) {
    const bodyMatch = cleanHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch) {
      cleanHtml = bodyMatch[1];
    }
  }
  cleanHtml = cleanHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  cleanHtml = cleanHtml.replace(/<link[^>]*rel=["']?stylesheet["']?[^>]*>/gi, '');

  if (componentSource) {
    const template = extractComponentTemplate(componentSource);
    const compiled = compileComponentTemplate(template);
    const finalHtml = preserveRenderedAttributes(cleanHtml, compiled);
    return `export default function render(props) {
  return \`${finalHtml}\`;
}`;
  }

  return `export default function render(props) {
  return \`${cleanHtml}\`;
}`;
};

const collectAssetFiles = (manifest) => {
  const collected = new Set();

  for (const entry of Object.values(manifest)) {
    if (!entry || typeof entry !== 'object') continue;

    if (entry.file && typeof entry.file === 'string') {
      if (entry.file.endsWith('.js') && !entry.file.startsWith('_astro/')) {
        collected.add(entry.file);
      }
    }

    if (Array.isArray(entry.css)) {
      for (const css of entry.css) {
        if (typeof css === 'string' && !css.startsWith('_astro/')) {
          collected.add(css);
        }
      }
    }

    if (Array.isArray(entry.assets)) {
      for (const asset of entry.assets) {
        if (typeof asset === 'string' && /\.(js|css)$/.test(asset) && !asset.startsWith('_astro/')) {
          collected.add(asset);
        }
      }
    }
  }

  return [...collected];
};

export default function squizAstroAdapter(options = {}) {
  return {
    name: 'squiz-astro-adapter',
    hooks: {
      'astro:config:setup'({ updateConfig }) {
        updateConfig({ output: 'static' });
      },

      async 'astro:build:done'({ dir, pages }) {
        const outputDir = fileURLToPath(dir);

        for (const page of pages) {
          const route = page.pathname || '/';
          if (route !== '/') continue; // only process the index page for now
          const filePath = path.join(outputDir, page.pathname || 'index.html');
          const htmlFile = filePath;
          let html;
          try {
            html = await fs.readFile(htmlFile, 'utf8');
          } catch (error) {
            continue;
          }

          const componentName = 'hello-world'; // hardcoded for now
          const componentPath = path.join(path.dirname(outputDir), 'src', 'hello-world', 'hello-world.astro');
          let componentSource = null;
          try {
            componentSource = await fs.readFile(componentPath, 'utf8');
          } catch (error) {
            componentSource = null;
          }

          const targetDir = path.join(outputDir, componentName);
          await fs.mkdir(targetDir, { recursive: true });
          await fs.writeFile(path.join(targetDir, 'main.js'), renderSquizModule(html, componentSource), 'utf8');
        }

        const manifestPath = path.join(outputDir, '_astro', 'manifest.json');
        let manifest;

        try {
          manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
        } catch (error) {
          manifest = null;
        }

        const assetFiles = manifest ? collectAssetFiles(manifest) : [];
        if (!assetFiles.length) {
          // Fallback: collect all CSS files in _astro
          const astroDir = path.join(outputDir, '_astro');
          try {
            const files = await fs.readdir(astroDir);
            const cssFiles = files.filter(file => file.endsWith('.css'));
            if (cssFiles.length) {
              assetFiles.push(...cssFiles.map(file => file));
            }
          } catch (error) {
            // no _astro
          }
        }

        if (assetFiles.length) {
          const assetsDir = path.join(outputDir, '_assets');
          await fs.mkdir(assetsDir, { recursive: true });

          const jsFiles = assetFiles.filter((file) => file.endsWith('.js'));
          const cssFiles = assetFiles.filter((file) => file.endsWith('.css'));

          if (jsFiles.length) {
            const bundleJs = await Promise.all(
              jsFiles.map(async (file) => {
                const source = await fs.readFile(path.join(outputDir, file.startsWith('_astro/') ? file : path.join('_astro', file)), 'utf8');
                return `/* ${file} */\n${source}`;
              })
            );
            await fs.writeFile(path.join(assetsDir, 'bundle.js'), bundleJs.join('\n\n'), 'utf8');
          }

          if (cssFiles.length) {
            const bundleCss = await Promise.all(
              cssFiles.map(async (file) => {
                const source = await fs.readFile(path.join(outputDir, file.startsWith('_astro/') ? file : path.join('_astro', file)), 'utf8');
                return `/* ${file} */\n${source}`;
              })
            );
            await fs.writeFile(path.join(assetsDir, 'bundle.css'), bundleCss.join('\n\n'), 'utf8');
          }
        }
      },
    },
  };
}
