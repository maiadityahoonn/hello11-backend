
import fs from 'fs';
import path from 'path';

const logFile = path.resolve('server_debug.log');

export const serverLog = (msg) => {
    const timestamp = new Date().toISOString();
    const formattedMsg = `[${timestamp}] ${msg}\n`;
    console.log(msg); // Still keep console log for nodemon visibility
    fs.appendFileSync(logFile, formattedMsg);
};

export const clearLog = () => {
    fs.writeFileSync(logFile, '');
};
