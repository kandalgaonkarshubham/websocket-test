import fs from 'fs';
import path from 'path';

const serverDir = path.resolve('.output/server');
const indexFile = path.join(serverDir, 'index.mjs');
const mainFile = path.join(serverDir, 'main.mjs');
const websocketsPath = path.relative(
  serverDir,
  path.resolve('websockets/index.ts')
);

// Rename index.mjs -> main.mjs
if (fs.existsSync(indexFile)) {
  fs.renameSync(indexFile, mainFile);
}

// Create new index.mjs as wrapper
const wrapperContent = `import app from './main.mjs';
import { WebSockets } from './${websocketsPath.replace(/\\/g, '/')}';

export { WebSockets };
export default app;
`;

fs.writeFileSync(indexFile, wrapperContent, { encoding: 'utf8' });
console.log('✅ Worker wrapper created successfully!');
