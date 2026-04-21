import * as esbuild from 'esbuild';

esbuild.build({
  entryPoints: ['server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: 'dist/server.cjs',
  external: [
    'express', 
    'vite', 
    'dotenv',
    'nodemailer'
  ],
  format: 'cjs'
}).catch(() => process.exit(1));
