const visibleNames = Object.keys(process.env).sort();
const sensitiveNames = visibleNames.filter(name =>
  /(?:token|secret|password|private[_-]?key|api[_-]?key|database[_-]?url)/i.test(name),
);

process.stdout.write(`${JSON.stringify({ visibleNames, sensitiveNames })}\n`);
