import createApp from './app.js';

const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
const app = createApp();
app.server.on('error', (error) => { console.error(error.message); app.close(); process.exitCode = 1; });
app.server.listen(port, '127.0.0.1', () => console.log(`AgentDex server: http://127.0.0.1:${port}`));
process.once('SIGINT', app.close);
process.once('SIGTERM', app.close);
