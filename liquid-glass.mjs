// ES module entry: loads the classic bundle (which defines globalThis.LiquidGlass) and re-exports it.
//   import LiquidGlass, { init, register } from './liquid-glass.mjs';
import './liquid-glass.js';

const LG = globalThis.LiquidGlass;
export default LG;
export const {
  version, init, register, attach, get, update, refresh, destroy,
  setPreferences, spring, stats, capabilities, defaults, events, extend,
} = LG;
