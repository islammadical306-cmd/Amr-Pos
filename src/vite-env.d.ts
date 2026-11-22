/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module '@tailwindcss/vite' {
  import type { PluginOption } from 'vite';
  export default function tailwindcss(): PluginOption;
}

declare module '@vitejs/plugin-react' {
  import type { PluginOption } from 'vite';
  export interface Options {
    jsxImportSource?: string;
    tsDecorators?: boolean;
    plugins?: any[];
    babel?: any;
  }
  export default function react(options?: Options): PluginOption;
}
