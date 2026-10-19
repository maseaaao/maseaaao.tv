// ESLint's TypeScript service does not compile SFC imports. vue-tsc checks their actual props.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent;
  export default component;
}
