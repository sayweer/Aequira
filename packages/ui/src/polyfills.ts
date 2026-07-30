import { Buffer } from 'buffer';
import process from 'process';

Object.assign(globalThis, {
  Buffer,
  global: globalThis,
  process,
});
