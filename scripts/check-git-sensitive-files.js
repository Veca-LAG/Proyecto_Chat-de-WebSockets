const { execSync } = require('child_process');

const forbiddenPatterns = [
  /^node_modules\//,
  /^\.env$/,
  /^\.env\.(?!.*example$).+$/,  // permite .env.example y .env.*.example
  /^data\/db\.json$/,
  /^npm-debug\.log/,
  /^yarn-debug\.log/,
  /^yarn-error\.log/,
  /^logs\//,
  /\.log$/,
  /^dist\//,
  /^build\//,
  /^coverage\//
];

function getTrackedFiles() {
  try {
    return execSync('git ls-files', { encoding: 'utf8' })
      .split(/\r?\n/)
      .map((file) => file.trim())
      .filter(Boolean);
  } catch (error) {
    console.warn('No se pudo ejecutar git ls-files. Si aún no inicializas Git, puedes ignorar este aviso.');
    return [];
  }
}

const tracked = getTrackedFiles();
const blocked = tracked.filter((file) => forbiddenPatterns.some((pattern) => pattern.test(file)));

if (blocked.length) {
  console.error('No se puede continuar: hay archivos sensibles o innecesarios versionados:');
  blocked.forEach((file) => console.error(`- ${file}`));
  console.error('\nSolución sugerida:');
  console.error('git rm -r --cached node_modules  # si aparece node_modules');
  console.error('git rm --cached .env data/db.json  # si aparecen archivos locales');
  console.error('git add .gitignore && git commit -m "Limpiar archivos sensibles"');
  process.exit(1);
}

console.log('Revisión correcta: no hay archivos sensibles versionados.');
