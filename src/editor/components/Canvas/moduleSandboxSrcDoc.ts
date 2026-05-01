import type { createModuleImportMap } from '../../../core/module-engine/runtimeResolver'

export const SANDBOX_MESSAGE_SOURCE = 'page-builder-module-sandbox'
export const HOST_MESSAGE_SOURCE = 'page-builder-module-host'

export interface SandboxContext {
  props: Record<string, unknown>
  nodeId: string
  isSelected: boolean
  className: string
  dependencies: Record<string, string>
  apiVersion: 1
}

interface SandboxSrcDocInput {
  title: string
  source: string
  importMap: ReturnType<typeof createModuleImportMap>
  context: SandboxContext
  classCSS: string
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeStyleContent(css: string): string {
  return css.replace(/<\/style/gi, '<\\/style')
}

function base64EncodeUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

export function createSandboxSrcDoc({
  title,
  source,
  importMap,
  context,
  classCSS,
}: SandboxSrcDocInput): string {
  const moduleUrl = `data:text/javascript;base64,${base64EncodeUtf8(source)}`

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtmlText(title)}</title>
    <script type="importmap">${safeJson(importMap)}</script>
    <style>
      html,
      body,
      #root {
        width: 100%;
        min-height: 100%;
        margin: 0;
      }

      body {
        overflow: hidden;
        background: transparent;
        color: #f8fafc;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }

      #root {
        height: 100%;
      }

      .pb-runtime-error {
        display: grid;
        min-height: 240px;
        place-items: center;
        padding: 16px;
        color: #fecaca;
        background: #1f0f13;
        font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        white-space: pre-wrap;
      }
    </style>
    <style id="pb-class-styles">${escapeStyleContent(classCSS)}</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">
      let context = ${safeJson(context)};
      const moduleUrl = ${safeJson(moduleUrl)};
      const root = document.getElementById('root');
      const classStyleEl = document.getElementById('pb-class-styles');
      root.className = context.className || '';
      let runtime = null;
      let cleanup = null;
      let updateRuntime = null;
      let mounting = null;
      let updateChain = Promise.resolve();

      function emit(type) {
        try {
          window.parent.postMessage({
            source: ${safeJson(SANDBOX_MESSAGE_SOURCE)},
            type,
            nodeId: context.nodeId,
          }, '*');
        } catch (_) {}
      }

      function showError(error) {
        const message = error instanceof Error ? error.stack || error.message : String(error);
        root.textContent = '';
        const pre = document.createElement('pre');
        pre.className = 'pb-runtime-error';
        pre.textContent = message;
        root.appendChild(pre);
      }

      document.addEventListener('pointerdown', () => emit('pointerdown'), true);
      document.addEventListener('dblclick', () => emit('dblclick'), true);

      function mountRuntime() {
        if (mounting) return mounting;

        const mountPromise = (async () => {
          if (cleanup) cleanup();
          cleanup = null;
          updateRuntime = null;
          root.textContent = '';

          if (typeof runtime.mount !== 'function') {
            throw new Error('Sandbox runtime must export mount(root, context).');
          }
          const result = await runtime.mount(root, context);

          if (typeof result === 'function') {
            cleanup = result;
          } else if (result && typeof result === 'object') {
            cleanup = typeof result.cleanup === 'function' ? result.cleanup : null;
            updateRuntime = typeof result.update === 'function' ? result.update : null;
          }

          if (!updateRuntime && typeof runtime.update === 'function') {
            updateRuntime = runtime.update;
          }
        })();

        mounting = mountPromise;
        mountPromise.then(
          () => {
            if (mounting === mountPromise) mounting = null;
          },
          () => {
            if (mounting === mountPromise) mounting = null;
          },
        );
        return mountPromise;
      }

      async function applyUpdate(nextContext, nextClassCSS) {
        context = nextContext;
        root.className = context.className || '';
        if (typeof nextClassCSS === 'string' && classStyleEl.textContent !== nextClassCSS) {
          classStyleEl.textContent = nextClassCSS;
        }

        if (!runtime) return;
        if (mounting) await mounting;

        if (updateRuntime) {
          await updateRuntime(root, context);
        } else {
          await mountRuntime();
        }
      }

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (
          !message ||
          message.source !== ${safeJson(HOST_MESSAGE_SOURCE)} ||
          message.type !== 'update' ||
          !message.context ||
          message.context.nodeId !== context.nodeId
        ) {
          return;
        }

        updateChain = updateChain.then(() => applyUpdate(message.context, message.classCSS)).catch((error) => {
          console.error('[module sandbox update]', error);
          showError(error);
        });
      });

      try {
        runtime = await import(moduleUrl);
        await mountRuntime();
      } catch (error) {
        console.error('[module sandbox]', error);
        showError(error);
      }

      window.addEventListener('pagehide', () => {
        if (cleanup) cleanup();
      });
    </script>
  </body>
</html>`
}
