import { startDaemon } from './index.js';

void startDaemon().then(({ port }) => {
  console.log(`Agent-Dev daemon listening at http://localhost:${port}`);
});
