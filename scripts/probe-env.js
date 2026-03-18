console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_PORT:', process.env.DB_PORT);
console.log('DB_USER:', process.env.DB_USER);
console.log('DB_PASSWORD:', process.env.DB_PASSWORD ? `set (${process.env.DB_PASSWORD.length} chars)` : 'UNSET');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? `set (${process.env.DATABASE_URL.length} chars)` : 'UNSET');
