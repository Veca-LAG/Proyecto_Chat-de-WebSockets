require('dotenv').config();
require('./src/app').start().catch((error) => {
    console.error('No se pudo iniciar el servidor:', error);
    process.exit(1);
});
