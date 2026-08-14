import { startDaemon } from './index.js';

void startDaemon()
  .then(({ port, databasePath }) => {
    console.log(`Agent-Dev daemon listening at http://localhost:${port}`);
    console.log(`Agent-Dev state database: ${databasePath}`);
  })
  .catch(error => {
    console.error(`Agent-Dev daemon failed to start: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
