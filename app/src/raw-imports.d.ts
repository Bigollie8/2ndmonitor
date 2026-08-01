/** Vite `?raw` imports resolve to the file's text. Declared manually — this
 *  project has no vite-env.d.ts / vite/client reference. */
declare module '*?raw' {
  const src: string;
  export default src;
}
