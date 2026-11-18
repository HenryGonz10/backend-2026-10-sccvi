const fs = require('node:fs');
const path = require('node:path');

const source = path.join(process.cwd(), 'src', 'data', 'who', 'who-cgs-2006-lms.json');
const destination = path.join(process.cwd(), 'dist', 'data', 'who', 'who-cgs-2006-lms.json');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.copyFileSync(source, destination);
