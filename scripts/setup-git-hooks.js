const fs = require('fs');
const path = require('path');

const gitDir = path.join(process.cwd(), '.git');
const hooksDir = path.join(gitDir, 'hooks');
const hookPath = path.join(hooksDir, 'pre-commit');

if (!fs.existsSync(gitDir)) {
  console.error('No se encontró la carpeta .git. Ejecuta este comando dentro del repositorio ya inicializado.');
  process.exit(1);
}

fs.mkdirSync(hooksDir, { recursive: true });
fs.writeFileSync(hookPath, `#!/bin/sh\nnpm run check:sensitive\n`, { mode: 0o755 });
console.log('Hook pre-commit instalado correctamente.');
console.log('Ahora Git bloqueará commits que intenten versionar node_modules, .env, data/db.json, logs o builds.');
