import typescript from 'rollup-plugin-typescript2';
import cleanup from 'rollup-plugin-cleanup';
import { getBabelOutputPlugin } from '@rollup/plugin-babel';
import { nodeResolve } from '@rollup/plugin-node-resolve';

const extensions = ['.ts', '.js'];

export default {
  input: 'src/index.ts',
  output: {
    dir: 'dist',
    format: 'es',
  },
  plugins: [
    cleanup({ comments: 'none', extensions: ['.ts'] }),
    typescript(),
    nodeResolve({ extensions }),
    getBabelOutputPlugin({
      presets: ['@babel/preset-env'],
    }),
  ],
  context: 'this',
};
