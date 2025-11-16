const mineflayer = require('mineflayer');
const { Movements, pathfinder, goals: { GoalBlock } } = require('mineflayer-pathfinder');
const config = require('./settings.json');
const express = require('express');

const app = express();

app.get('/', (req, res) => {
  res.send('Bot has arrived');
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server started on port 5000');
});

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
      console.log(`[Auth] Sent /register command.`);

      bot.once('message', (msg) => {
        const message = msg.toString();
        console.log(`[AuthLog] ${message}`);

        if (message.includes('successfully registered')) {
          console.log('[INFO] Registration confirmed.');
          resolve();
        } else if (message.includes('already registered')) {
          console.log('[INFO] Bot was already registered.');
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
      console.log(`[Auth] Sent /login command.`);

      bot.once('message', (msg) => {
        const message = msg.toString();
        console.log(`[AuthLog] ${message}`);

        if (message.includes('successfully logged in')) {
          console.log('[INFO] Login successful.');
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
    console.log('\x1b[33m[AfkBot] Bot joined the server\x1b[0m');

    // Auto Auth
    if (config.utils['auto-auth'].enabled) {
      console.log('[INFO] Started auto-auth module');
      const password = config.utils['auto-auth'].password;

      pendingPromise = pendingPromise
        .then(() => sendRegister(password))
        .then(() => sendLogin(password))
        .catch(error => console.error('[ERROR]', error));
    }

    // Move to position
    if (config.position.enabled) {
      const pos = config.position;
      console.log(
        `\x1b[32m[AfkBot] Moving to target location (${pos.x}, ${pos.y}, ${pos.z})\x1b[0m`
      );
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(new GoalBlock(pos.x, pos.y, pos.z));
    }

    // Anti-AFK (periodic jump/sneak)
    if (config.utils['anti-afk'].enabled) {
      console.log('[INFO] Started anti-afk module');
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
      `\x1b[32m[AfkBot] Bot arrived at the target location. ${bot.entity.position}\x1b[0m`
    );
  });

  bot.on('death', () => {
    console.log(
      `\x1b[33m[AfkBot] Bot has died and was respawned at ${bot.entity.position}\x1b[0m`
    );
  });

  // Auto Reconnect
  if (config.utils['auto-reconnect']) {
    bot.on('end', () => {
      console.log('[INFO] Disconnected. Reconnecting...');
      setTimeout(() => createBot(), config.utils['auto-reconnect-delay']);
    });
  }

  bot.on('kicked', (reason) =>
    console.log(
      '\x1b[33m',
      `[AfkBot] Bot was kicked from the server. Reason: \n${reason}`,
      '\x1b[0m'
    )
  );

  bot.on('error', (err) =>
    console.log(`\x1b[31m[ERROR] ${err.message}\x1b[0m`)
  );
}

createBot();
