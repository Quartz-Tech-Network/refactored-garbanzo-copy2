const mineflayer = require('mineflayer');
const { Movements, pathfinder, goals: { GoalBlock } } = require('mineflayer-pathfinder');
// Note: This file assumes './settings.json' is available.
const config = require('./settings.json'); 
const express = require('express');

const app = express();
const port = 5000; // Using the user-defined port

// =======================================================
// 1. Custom Logging Setup (Intercepts all console.log and console.error calls)
// =======================================================
const serverLogs = [];
const originalConsoleLog = console.log;
// Store the original console.error function to preserve its functionality
const originalConsoleError = console.error; 

// Function to process, store, and format the message
const captureLog = (...args) => {
    // Convert arguments (strings, objects) into a single log message
    // Using JSON.stringify(..., null, 2) for cleaner object/error output
    const message = args
        .map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg))
        .join(' ')
        .replace(/\x1b\[\d+m/g, ''); // Regex to strip terminal color codes
        
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp} - ${message}`;
    
    // Store the message to be sent to the client
    serverLogs.push(logEntry);
};

// Override console.log
console.log = function(...args) {
    captureLog(...args);
    // Call the original console.log function to ensure it still prints on the server terminal
    originalConsoleLog.apply(console, args);
};

// Override console.error (Crucial for capturing errors from promises and mineflayer)
console.error = function(...args) {
    // Prepend a clear indicator that this was logged via console.error
    captureLog('CRITICAL ERROR:', ...args);
    // Then call the original console.error function
    originalConsoleError.apply(console, args);
};

// =======================================================
// 2. Route Configuration
// =======================================================

// --- Root Endpoint for Status Check and Log Display ---
app.get('/', (req, res) => {
    // This log message is captured and added to the serverLogs array
    console.log('Incoming request received at the root route. Displaying captured logs.'); 
    
    // Format the captured logs into an HTML list
    const logList = serverLogs.map(log => `<li>${log}</li>`).join('');
    
    // Crucially, we use ONE res.send() call to return the fixed status message 
    // AND the entire history of captured logs.
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>AfkBot Server Status</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <style>
                body { font-family: 'Inter', sans-serif; }
            </style>
        </head>
        <body class="bg-gray-800 text-gray-200 p-6 md:p-10 rounded-lg">
            <div class="max-w-4xl mx-auto bg-gray-900 p-6 rounded-xl shadow-2xl">
                <h1 class="text-3xl font-bold mb-4 text-blue-400 border-b pb-2 border-gray-700">Minecraft Bot Status & Logs</h1>
                
                <div class="bg-green-700/30 p-4 rounded-lg border border-green-600 mb-6">
                    <p class="text-xl font-mono text-green-300">Bot has arrived</p>
                </div>

                <h2 class="text-xl font-semibold mb-3 text-gray-300">Captured Bot Console Output</h2>
                <div class="bg-gray-800 p-4 rounded-lg shadow-inner">
                    <ul class="space-y-1 text-sm h-96 overflow-y-auto" id="log-list">
                        ${logList || '<li class="text-gray-500">Waiting for bot activity...</li>'}
                    </ul>
                </div>
            </div>
        </body>
        </html>
    `);
});

app.listen(port, '0.0.0.0', () => {
    // This log message is captured and displayed on the website
    console.log(`Web Server started on port ${port} (0.0.0.0)`);
});

// =======================================================
// 3. Minecraft Bot Logic (Original code preserved)
// =======================================================

function createBot() {
  const bot = mineflayer.createBot({
    username: config['bot-account']['username'],
    password: config['bot-account']['password'],
    auth: config['bot-account']['type'],
    host: config.server.ip,
    port: config.server.port,
    version: config.server.version,
  });

  bot.loadPlugin(pathfinder);
  const mcData = require('minecraft-data')(bot.version);
  const defaultMove = new Movements(bot, mcData);
  bot.settings.colorsEnabled = false;

  let pendingPromise = Promise.resolve();

  function sendRegister(password) {
    return new Promise((resolve, reject) => {
      bot.chat(`/register ${password} ${password}`);
      console.log(`[Auth] Sent /register command.`); // CAPTURED

      bot.once('message', (msg) => {
        const message = msg.toString();
        console.log(`[AuthLog] ${message}`); // CAPTURED

        if (message.includes('successfully registered')) {
          console.log('[INFO] Registration confirmed.'); // CAPTURED
          resolve();
        } else if (message.includes('already registered')) {
          console.log('[INFO] Bot was already registered.'); // CAPTURED
          resolve();
        } else {
          reject(`[Register ERROR] Message: "${message}"`);
        }
      });
    });
  }

  function sendLogin(password) {
    return new Promise((resolve, reject) => {
      bot.chat(`/login ${password}`);
      console.log(`[Auth] Sent /login command.`); // CAPTURED

      bot.once('message', (msg) => {
        const message = msg.toString();
        console.log(`[AuthLog] ${message}`); // CAPTURED

        if (message.includes('successfully logged in')) {
          console.log('[INFO] Login successful.'); // CAPTURED
          resolve();
        } else if (message.includes('Invalid password')) {
          reject(`[Login ERROR] Invalid password. Message: "${message}"`);
        } else if (message.includes('not registered')) {
          reject(`[Login ERROR] Not registered. Message: "${message}"`);
        } else {
          reject(`[Login ERROR] Unexpected message: "${message}"`);
        }
      });
    });
  }

  bot.once('spawn', () => {
    // Color codes are stripped by the custom console.log function
    console.log('[AfkBot] Bot joined the server'); // CAPTURED

    // Auto Auth
    if (config.utils['auto-auth'].enabled) {
      console.log('[INFO] Started auto-auth module'); // CAPTURED
      const password = config.utils['auto-auth'].password;

      pendingPromise = pendingPromise
        .then(() => sendRegister(password))
        .then(() => sendLogin(password))
        .catch(error => console.error('[ERROR]', error)); // CAPTURED (uses console.error)
    }

    // Move to position
    if (config.position.enabled) {
      const pos = config.position;
      console.log(
        `[AfkBot] Moving to target location (${pos.x}, ${pos.y}, ${pos.z})` // CAPTURED
      );
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(new GoalBlock(pos.x, pos.y, pos.z));
    }

    // Anti-AFK (periodic jump/sneak)
    if (config.utils['anti-afk'].enabled) {
      console.log('[INFO] Started anti-afk module'); // CAPTURED
      setInterval(() => {
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 500);

        if (config.utils['anti-afk'].sneak) {
          bot.setControlState('sneak', true);
          setTimeout(() => bot.setControlState('sneak', false), 500);
        }
      }, 10000); // every 10s
    }
  });

  bot.on('goal_reached', () => {
    console.log(
      `[AfkBot] Bot arrived at the target location. ${bot.entity.position}` // CAPTURED
    );
  });

  bot.on('death', () => {
    console.log(
      `[AfkBot] Bot has died and was respawned at ${bot.entity.position}` // CAPTURED
    );
  });

  // Auto Reconnect
  if (config.utils['auto-reconnect']) {
    bot.on('end', () => {
      console.log('[INFO] Disconnected. Reconnecting...'); // CAPTURED
      setTimeout(() => createBot(), config.utils['auto-reconnect-delay']);
    });
  }

  bot.on('kicked', (reason) =>
    console.log(
      `[AfkBot] Bot was kicked from the server. Reason: \n${reason}` // CAPTURED
    )
  );

  bot.on('error', (err) =>
    console.log(`[ERROR] ${err.message}`) // CAPTURED
  );
}

createBot();
